/**
 * Agent Daemon
 * Lightweight 24/7 process that triggers AI only when needed
 */

import cron from 'node-cron';
import { createLogger } from '../lib/logger.js';
import {
  subscriber,
  publisher,
  channels,
  setAgentStatus,
  redis,
} from '../lib/redis.js';
import { agentRepo, historyRepo, eventRepo, decisionRepo } from '../lib/db.js';
import { rag } from '../lib/rag.js';
import { workspace } from './workspace.js';
import { loadProfile, generateSystemPrompt, type AgentProfile } from './profile.js';
import { createStateManager, StateKeys, type StateManager } from './state.js';
import {
  executeClaudeCodeWithRetry,
  executeOllamaFallback,
  isClaudeAvailable,
  buildLoopPrompt,
  parseClaudeOutput,
  type PendingDecision,
} from './claude.js';
import type { AgentType, AgentMessage, EventType } from '../lib/types.js';
import { spawnWorkerAsync } from '../workers/spawner.js';
import { queueForArchive } from '../workers/archive-worker.js';
import { runInitiativePhase, type AgentType as InitiativeAgentType } from './initiative.js';

const logger = createLogger('daemon');

export interface DaemonConfig {
  agentType: AgentType;
  agentId: string;
  profilePath: string;
  loopInterval: number;
  loopEnabled: boolean;
  orchestratorUrl: string;
}

export class AgentDaemon {
  private config: DaemonConfig;
  private profile: AgentProfile | null = null;
  private state: StateManager | null = null;
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning = false;
  private claudeAvailable = false;
  private loopInProgress = false; // Prevents concurrent loops

  constructor(daemonConfig: DaemonConfig) {
    this.config = daemonConfig;
    logger.info({ agentType: daemonConfig.agentType, agentId: daemonConfig.agentId }, 'Daemon created');
  }

  /**
   * Start the daemon
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Daemon already running');
      return;
    }

    logger.info({ agentType: this.config.agentType }, 'Starting agent daemon');

    try {
      // 1. Load profile
      this.profile = await loadProfile(this.config.profilePath, this.config.agentType);
      logger.info({ profileName: this.profile.name }, 'Profile loaded');

      // 1.5. Load agent from DB and use DB-assigned ID
      const dbAgent = await agentRepo.findByType(this.config.agentType);
      if (!dbAgent) {
        throw new Error(`Agent type ${this.config.agentType} not found in database. Run init-db.sql first.`);
      }
      this.config.agentId = dbAgent.id;
      logger.info({ dbAgentId: dbAgent.id, agentType: this.config.agentType }, 'Using DB agent ID');

      // 2. Initialize state manager
      this.state = createStateManager(this.config.agentId, this.config.agentType);
      logger.info('State manager initialized');

      // 2.5. Initialize workspace (git clone)
      const workspaceInitialized = await workspace.initialize(this.config.agentType);
      logger.info({ success: workspaceInitialized }, 'Workspace initialized');

      // 3. Check Claude availability
      this.claudeAvailable = await isClaudeAvailable();
      logger.info({ claudeAvailable: this.claudeAvailable }, 'Claude availability checked');

      // 4. Subscribe to Redis events
      await this.subscribeToEvents();
      logger.info('Event subscriptions active');

      // 5. Schedule loop (if enabled)
      if (this.config.loopEnabled) {
        this.scheduleLoop();
        logger.info({ interval: this.config.loopInterval }, 'Loop scheduled');
      }

      // 6. Update status
      await this.updateStatus('active');
      this.isRunning = true;

      // 7. Log startup event
      await this.logEvent('agent_started', { agentType: this.config.agentType });

      logger.info({ agentType: this.config.agentType }, 'Agent daemon started successfully');

      // 8. Run startup prompt (optional first loop)
      if (this.profile.startupPrompt && this.claudeAvailable) {
        logger.info('Running startup sequence');
        await this.runLoop('startup');
      }

      // 9. Check for pending tasks on startup - process immediately if any
      const pendingTaskCount = await redis.llen(`queue:tasks:${this.config.agentType}`);
      if (pendingTaskCount > 0) {
        logger.info({ pendingTaskCount }, 'Found pending tasks on startup, processing immediately');
        // Small delay to let startup complete, then process queue
        setTimeout(() => this.runLoop('startup_queue'), 3000);
      }

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      logger.error({ error: errMsg, stack: errStack }, 'Failed to start daemon');
      await this.updateStatus('error');
      throw error;
    }
  }

  /**
   * Stop the daemon gracefully
   */
  async stop(): Promise<void> {
    logger.info({ agentType: this.config.agentType }, 'Stopping agent daemon');

    try {
      // Stop cron job
      if (this.cronJob) {
        this.cronJob.stop();
        this.cronJob = null;
      }

      // Unsubscribe from Redis
      await subscriber.unsubscribe();

      // NOTE: We intentionally do NOT set status to 'inactive' on shutdown.
      // The 'active' status means the agent SHOULD be running, not that it IS running.
      // The orchestrator will restart the container based on status='active'.

      // Log event
      await this.logEvent('agent_stopped', { reason: 'graceful_shutdown' });

      this.isRunning = false;
      logger.info('Agent daemon stopped');

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errMsg }, 'Error during shutdown');
    }
  }

  /**
   * Subscribe to Redis pub/sub channels
   */
  private async subscribeToEvents(): Promise<void> {
    // Subscribe to agent-specific channel
    const agentChannel = channels.agent(this.config.agentId);
    await subscriber.subscribe(agentChannel);

    // Subscribe to tier channel (head or clevel)
    const tier = this.getTier();
    if (tier === 'head') {
      await subscriber.subscribe(channels.head);
    } else {
      await subscriber.subscribe(channels.clevel);
    }

    // Subscribe to broadcast channel
    await subscriber.subscribe(channels.broadcast);

    // Handle incoming messages
    subscriber.on('message', async (channel: string, message: string) => {
      try {
        const parsed = JSON.parse(message) as AgentMessage;
        await this.handleMessage(parsed, channel);
      } catch (error) {
        logger.error({ channel, error }, 'Failed to handle message');
      }
    });
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(message: AgentMessage, channel: string): Promise<void> {
    logger.debug({ type: message.type, from: message.from, channel }, 'Received message');

    // Determine if we need to trigger AI
    const needsAI = this.shouldTriggerAI(message);

    if (needsAI) {
      logger.info({ type: message.type }, 'Triggering AI for message');
      await this.runLoop('message', message);
    } else {
      // Handle simple events without AI
      await this.handleSimpleMessage(message);
    }
  }

  /**
   * Determine if message requires AI processing
   */
  private shouldTriggerAI(message: AgentMessage): boolean {
    // Always trigger AI for these types
    const aiRequired: AgentMessage['type'][] = ['task', 'decision', 'alert', 'vote', 'worker_result'];
    if (aiRequired.includes(message.type)) {
      return true;
    }

    // Status requests from CEO always get AI response
    if (message.type === 'status_request' && message.from === 'ceo') {
      return true;
    }

    // High/urgent priority messages
    if (message.priority === 'high' || message.priority === 'urgent') {
      return true;
    }

    return false;
  }

  /**
   * Handle simple messages without AI
   */
  private async handleSimpleMessage(message: AgentMessage): Promise<void> {
    switch (message.type) {
      case 'status_request':
        // Send basic status without AI
        await this.sendStatusResponse(message.from);
        break;

      case 'broadcast':
        // Log broadcast, no response needed
        logger.info({ from: message.from, payload: message.payload }, 'Broadcast received');
        break;

      case 'task_queued':
        // New task in queue - wake up and process immediately
        logger.info({ agentType: this.config.agentType }, 'Task queued notification received, processing queue');
        // Use setTimeout to avoid blocking the message handler
        setTimeout(() => this.runLoop('task_notification'), 100);
        break;

      default:
        logger.debug({ type: message.type }, 'Message handled without AI');
    }
  }

  /**
   * Send status response
   */
  private async sendStatusResponse(to: string): Promise<void> {
    const currentState = await this.state?.getAll() || {};

    const response: AgentMessage = {
      id: crypto.randomUUID(),
      type: 'status_response',
      from: this.config.agentId,
      to,
      payload: {
        agent: this.config.agentType.toUpperCase(),
        status: 'active',
        timestamp: new Date().toISOString(),
        loopCount: currentState[StateKeys.LOOP_COUNT] || 0,
        lastLoopAt: currentState[StateKeys.LAST_LOOP_AT] || null,
        currentFocus: currentState[StateKeys.CURRENT_FOCUS] || null,
      },
      priority: 'normal',
      timestamp: new Date(),
      requiresResponse: false,
    };

    await publisher.publish(channels.agent(to), JSON.stringify(response));
    logger.debug({ to }, 'Status response sent');
  }

  /**
   * Schedule the main loop
   */
  private scheduleLoop(): void {
    const intervalSeconds = this.config.loopInterval;
    const cronExpression = this.intervalToCron(intervalSeconds);

    logger.info({ cronExpression, intervalSeconds }, 'Scheduling loop');

    this.cronJob = cron.schedule(cronExpression, async () => {
      try {
        await this.runLoop('scheduled');
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error({ error: errMsg }, 'Scheduled loop failed');
      }
    });
  }

  /**
   * Convert interval in seconds to cron expression
   */
  private intervalToCron(seconds: number): string {
    if (seconds <= 60) {
      return '* * * * *'; // Every minute
    } else if (seconds <= 3600) {
      const minutes = Math.floor(seconds / 60);
      return '*/' + minutes + ' * * * *';
    } else if (seconds <= 86400) {
      const hours = Math.floor(seconds / 3600);
      return '0 */' + hours + ' * * *';
    } else {
      return '0 0 * * *'; // Daily
    }
  }

  /**
   * Run the agent loop with AI
   */
  private async runLoop(trigger: string, data?: unknown): Promise<void> {
    if (!this.profile || !this.state) {
      logger.error('Profile or state not initialized');
      return;
    }

    // Prevent concurrent loops
    if (this.loopInProgress) {
      logger.debug({ trigger }, 'Loop already in progress, skipping');
      return;
    }
    this.loopInProgress = true;

    const loopStart = Date.now();
    logger.info({ trigger }, 'Running agent loop');

    try {
      // Increment loop counter
      const loopCount = (await this.state.get<number>(StateKeys.LOOP_COUNT)) || 0;
      await this.state.set(StateKeys.LOOP_COUNT, loopCount + 1);

      // Get current state
      const currentState = await this.state.getAll();

      // Fetch pending decisions for HEAD agents (CEO/DAO)
      let pendingDecisions: PendingDecision[] = [];
      if (this.profile.codename === 'ceo' || this.profile.codename === 'dao') {
        const rawDecisions = await decisionRepo.findPending();
        pendingDecisions = rawDecisions.map(d => ({
          id: d.id,
          title: d.title,
          description: d.description ?? undefined,
          tier: d.decisionType,
          proposedBy: d.proposedBy ?? undefined,
          createdAt: d.createdAt,
        }));
        if (pendingDecisions.length > 0) {
          logger.info({ count: pendingDecisions.length }, 'Found pending decisions for HEAD agent');
        }
      }

      // Fetch pending tasks from queue (NEW: Actually read the task queue!)
      let pendingTasks: Array<{ title: string; description: string; priority: string; from: string }> = [];
      try {
        const taskQueueKey = `queue:tasks:${this.config.agentType}`;
        const rawTasks = await redis.lrange(taskQueueKey, 0, 9); // Get up to 10 pending tasks
        if (rawTasks.length > 0) {
          pendingTasks = rawTasks.map(t => {
            try {
              const parsed = JSON.parse(t);
              return {
                title: parsed.title || 'Untitled Task',
                description: parsed.description || '',
                priority: parsed.priority || 'normal',
                from: parsed.from || 'unknown',
              };
            } catch {
              return null;
            }
          }).filter((t): t is NonNullable<typeof t> => t !== null);
          logger.info({ count: pendingTasks.length, agentType: this.config.agentType }, 'Found pending tasks in queue');
        }
      } catch (taskError) {
        const errMsg = taskError instanceof Error ? taskError.message : String(taskError);
        logger.warn({ error: errMsg }, 'Failed to fetch pending tasks');
      }

      // RAG: Build query from agent type + trigger + data
      let ragContext = '';
      try {
        const queryParts = [this.profile.codename, trigger];
        if (data && typeof data === 'object' && 'message' in data) {
          queryParts.push(String((data as { message?: string }).message || ''));
        }
        const ragQuery = queryParts.join(' ');
        const ragResults = await rag.search(ragQuery, 5);
        if (ragResults.length > 0) {
          ragContext = rag.buildContext(ragResults, 1500);
          logger.debug({ query: ragQuery, resultsCount: ragResults.length }, 'RAG context retrieved');
        }
      } catch (ragError) {
        const errMsg = ragError instanceof Error ? ragError.message : String(ragError);
        logger.warn({ error: errMsg }, 'RAG search failed, continuing without context');
      }

      // Build prompt
      const systemPrompt = generateSystemPrompt(this.profile);
      const loopPrompt = buildLoopPrompt(this.profile, currentState, { type: trigger, data }, pendingDecisions, ragContext, pendingTasks);
      logger.info({ systemPromptLength: systemPrompt.length, loopPromptLength: loopPrompt.length }, 'Prompt lengths');

      // FULL PROMPT LOGGING - to debug why agents don't use spawn_worker
      logger.info({ fullSystemPrompt: systemPrompt }, '=== FULL SYSTEM PROMPT ===');
      logger.info({ fullLoopPrompt: loopPrompt }, '=== FULL LOOP PROMPT ===');

      // Execute AI with retry on transient errors (overload, rate limit)
      let result;
      if (this.claudeAvailable) {
        result = await executeClaudeCodeWithRetry({
          prompt: loopPrompt,
          systemPrompt,
          timeout: 300000, // 5 minutes
          maxRetries: 3,
        });
      } else {
        logger.warn('Claude unavailable, using Ollama fallback');
        result = await executeOllamaFallback(systemPrompt + '\n\n' + loopPrompt);
      }

      if (result.success) {
        // FULL OUTPUT LOGGING - to debug what Claude returns
        logger.info('=== FULL CLAUDE OUTPUT START ===');
        console.log(result.output);
        logger.info('=== FULL CLAUDE OUTPUT END ===');

        // Parse and process result
        const parsed = parseClaudeOutput(result.output);

        // Debug: Log parsed result
        logger.info({
          hasParsed: !!parsed,
          hasActions: parsed?.actions?.length || 0,
          actionTypes: parsed?.actions?.map(a => a.type) || [],
          summary: parsed?.summary?.slice(0, 100)
        }, 'Parsed Claude output');

        if (parsed) {
          // Apply state updates
          if (parsed.stateUpdates) {
            for (const [key, value] of Object.entries(parsed.stateUpdates)) {
              await this.state.set(key, value);
            }
          }

          // Send messages
          if (parsed.messages) {
            for (const msg of parsed.messages) {
              await this.sendMessage(msg.to, msg.content);
            }
          }

          // Process actions
          if (parsed.actions) {
            for (const action of parsed.actions) {
              await this.processAction(action);
            }
          }

          // Log to history
          await this.logHistory('decision', parsed.summary || 'Loop completed', parsed);

          // Queue summary for intelligent archiving (Archive Worker will decide what to keep)
          if (parsed.summary && parsed.summary.length >= 50) {
            try {
              await queueForArchive({
                id: crypto.randomUUID(),
                agentType: this.config.agentType,
                agentId: this.config.agentId,
                summary: parsed.summary,
                timestamp: new Date().toISOString(),
                loopCount: loopCount + 1,
                actions: parsed.actions?.map(a => a.type),
              });
            } catch (archiveError) {
              logger.warn({ error: archiveError }, 'Failed to queue for archive');
            }
          }

          // Commit workspace changes to git (with PR if enabled)
          if (await workspace.hasUncommittedChanges()) {
            const commitResult = await workspace.commitAndCreatePR(
              this.config.agentType,
              parsed.summary || `Loop ${loopCount + 1} completed`,
              loopCount + 1
            );
            if (commitResult.success && commitResult.filesChanged) {
              logger.info({
                filesChanged: commitResult.filesChanged,
                commitHash: commitResult.commitHash,
                prNumber: commitResult.prNumber,
                prUrl: commitResult.prUrl,
              }, 'Workspace changes committed');

              // If PR was created, request RAG quality review
              if (commitResult.prNumber) {
                await publisher.publish(channels.orchestrator, JSON.stringify({
                  id: crypto.randomUUID(),
                  type: 'pr_review_requested',
                  from: this.config.agentId,
                  to: 'orchestrator',
                  payload: {
                    agentType: this.config.agentType,
                    prNumber: commitResult.prNumber,
                    prUrl: commitResult.prUrl,
                    branchName: commitResult.branchName,
                    commitHash: commitResult.commitHash,
                    filesChanged: await workspace.getChangedFiles(),
                    summary: parsed.summary,
                  },
                }));
                logger.info({ prNumber: commitResult.prNumber }, 'PR review requested');
              } else {
                // No PR (direct push) - just index the files
                const changedFiles = await workspace.getChangedFiles();
                if (changedFiles.length > 0) {
                  await publisher.publish(channels.orchestrator, JSON.stringify({
                    id: crypto.randomUUID(),
                    type: 'workspace_update',
                    from: this.config.agentId,
                    to: 'orchestrator',
                    payload: {
                      agentType: this.config.agentType,
                      commitHash: commitResult.commitHash,
                      filesChanged: changedFiles,
                      summary: parsed.summary,
                    },
                  }));
                }
              }
            }
          }
        }

        // Update success count
        const successCount = (await this.state.get<number>(StateKeys.SUCCESS_COUNT)) || 0;
        await this.state.set(StateKeys.SUCCESS_COUNT, successCount + 1);

        // ACKNOWLEDGE PROCESSED TASKS: Remove them from queue so they don't repeat
        if (pendingTasks.length > 0) {
          try {
            const taskQueueKey = `queue:tasks:${this.config.agentType}`;
            // Remove the tasks we just processed (first N items)
            await redis.ltrim(taskQueueKey, pendingTasks.length, -1);
            logger.info({
              removed: pendingTasks.length,
              agentType: this.config.agentType
            }, 'Acknowledged and removed processed tasks from queue');
          } catch (ackError) {
            const errMsg = ackError instanceof Error ? ackError.message : String(ackError);
            logger.warn({ error: errMsg }, 'Failed to acknowledge tasks');
          }
        }

      } else {
        logger.error({ error: result.error }, 'Loop execution failed');

        // Update error count
        const errorCount = (await this.state.get<number>(StateKeys.ERROR_COUNT)) || 0;
        await this.state.set(StateKeys.ERROR_COUNT, errorCount + 1);
      }

      // Update last loop timestamp
      await this.state.set(StateKeys.LAST_LOOP_AT, new Date().toISOString());

      const duration = Date.now() - loopStart;
      logger.info({ trigger, duration, success: result.success }, 'Loop completed');

      // EVENT-DRIVEN: Check if more tasks in queue → continue immediately
      if (result.success) {
        const remainingTasks = await redis.llen(`queue:tasks:${this.config.agentType}`);
        if (remainingTasks > 0) {
          logger.info({ remainingTasks, agentType: this.config.agentType }, 'More tasks in queue, continuing immediately');
          // Small delay to prevent tight loop, then continue
          setTimeout(() => this.runLoop('queue_continuation'), 2000);
        } else {
          // INITIATIVE PHASE: No tasks in queue, be proactive!
          logger.info({ agentType: this.config.agentType }, 'Task queue empty, running initiative phase');
          try {
            const initiativeResult = await runInitiativePhase(this.config.agentType as InitiativeAgentType);
            if (initiativeResult.created && initiativeResult.initiative) {
              logger.info({
                title: initiativeResult.initiative.title,
                issueUrl: initiativeResult.issueUrl,
                revenueImpact: initiativeResult.initiative.revenueImpact,
              }, 'Initiative created - agent generated own work!');

              // Log initiative as event
              await eventRepo.log({
                eventType: 'initiative_created' as EventType,
                sourceAgent: this.config.agentId,
                payload: {
                  title: initiativeResult.initiative.title,
                  priority: initiativeResult.initiative.priority,
                  issueUrl: initiativeResult.issueUrl,
                },
              });
            } else {
              logger.debug({ agentType: this.config.agentType }, 'No new initiatives to create (all done or cooldown)');
            }
          } catch (initError) {
            const errMsg = initError instanceof Error ? initError.message : String(initError);
            logger.warn({ error: errMsg }, 'Initiative phase failed, continuing normally');
          }
        }
      }

    } catch (error) {
      logger.error({ error, trigger }, 'Loop execution error');

      // Update error count
      const errorCount = (await this.state?.get<number>(StateKeys.ERROR_COUNT)) || 0;
      await this.state?.set(StateKeys.ERROR_COUNT, errorCount + 1);
    } finally {
      // Always release the lock
      this.loopInProgress = false;
    }
  }

  /**
   * Send a message to another agent
   */
  private async sendMessage(to: string, content: string): Promise<void> {
    const message: AgentMessage = {
      id: crypto.randomUUID(),
      type: 'direct',
      from: this.config.agentId,
      to,
      payload: { content },
      priority: 'normal',
      timestamp: new Date(),
      requiresResponse: false,
    };

    const channel = to === 'all' ? channels.broadcast :
                   to === 'head' ? channels.head :
                   to === 'clevel' ? channels.clevel :
                   channels.agent(to);

    await publisher.publish(channel, JSON.stringify(message));
    logger.debug({ to, channel }, 'Message sent');
  }

  /**
   * Process an action from AI output
   */
  private async processAction(action: { type: string; data?: unknown }): Promise<void> {
    logger.debug({ actionType: action.type }, 'Processing action');
    const actionData = action.data as Record<string, unknown> | undefined;

    switch (action.type) {
      case 'create_task': {
        // Create task for another agent
        const taskMessage: AgentMessage = {
          id: crypto.randomUUID(),
          type: 'task',
          from: this.config.agentId,
          to: (actionData?.assignTo as string) || 'clevel',
          payload: {
            task_id: crypto.randomUUID(),
            title: actionData?.title || 'Untitled Task',
            description: actionData?.description || '',
            deadline: actionData?.deadline,
          },
          priority: (actionData?.priority as 'low' | 'normal' | 'high' | 'urgent') || 'normal',
          timestamp: new Date(),
          requiresResponse: false,
        };
        await publisher.publish('channel:orchestrator', JSON.stringify(taskMessage));
        logger.info({ taskTitle: actionData?.title, assignTo: actionData?.assignTo }, 'Task created');
        break;
      }

      case 'propose_decision': {
        // Propose a decision with tier classification
        // Tier can be: operational, minor, major, critical
        const tier = (actionData?.tier as string) || 'major';

        const decisionMessage: AgentMessage = {
          id: crypto.randomUUID(),
          type: 'decision',
          from: this.config.agentId,
          to: 'orchestrator',
          payload: {
            title: actionData?.title || 'Untitled Decision',
            description: actionData?.description || '',
            type: tier, // This is the DecisionType tier
            context: actionData?.context,
            options: actionData?.options,
          },
          priority: tier === 'critical' ? 'urgent' : tier === 'major' ? 'high' : 'normal',
          timestamp: new Date(),
          requiresResponse: tier !== 'operational',
        };
        await publisher.publish('channel:orchestrator', JSON.stringify(decisionMessage));
        logger.info({ decisionTitle: actionData?.title, tier }, 'Decision proposed');
        break;
      }

      case 'operational': {
        // Execute operational task immediately (no approval needed)
        // This is a shorthand for propose_decision with tier=operational
        const opMessage: AgentMessage = {
          id: crypto.randomUUID(),
          type: 'decision',
          from: this.config.agentId,
          to: 'orchestrator',
          payload: {
            title: actionData?.title || 'Operational Task',
            description: actionData?.description || '',
            type: 'operational',
            executedAction: actionData?.action,
          },
          priority: 'low',
          timestamp: new Date(),
          requiresResponse: false,
        };
        await publisher.publish('channel:orchestrator', JSON.stringify(opMessage));
        logger.info({ title: actionData?.title }, 'Operational task executed');
        break;
      }

      case 'vote': {
        // Cast a vote on a pending decision (for CEO/DAO)
        const voteMessage: AgentMessage = {
          id: crypto.randomUUID(),
          type: 'vote',
          from: this.config.agentId,
          to: 'orchestrator',
          payload: {
            decisionId: actionData?.decisionId,
            voterType: this.config.agentType, // ceo or dao
            vote: actionData?.vote || 'abstain', // approve, veto, abstain
            reason: actionData?.reason,
          },
          priority: 'high',
          timestamp: new Date(),
          requiresResponse: false,
        };
        await publisher.publish('channel:orchestrator', JSON.stringify(voteMessage));
        logger.info({ decisionId: actionData?.decisionId, vote: actionData?.vote }, 'Vote cast');
        break;
      }

      case 'alert': {
        // Send alert to orchestrator
        const alertMessage: AgentMessage = {
          id: crypto.randomUUID(),
          type: 'alert',
          from: this.config.agentId,
          to: 'orchestrator',
          payload: {
            type: actionData?.alertType || 'general',
            severity: actionData?.severity || 'low',
            message: actionData?.message || '',
            relatedDecisionId: actionData?.decisionId,
          },
          priority: (actionData?.severity === 'critical') ? 'urgent' : 'high',
          timestamp: new Date(),
          requiresResponse: false,
        };
        await publisher.publish('channel:orchestrator', JSON.stringify(alertMessage));
        logger.info({ alertType: actionData?.alertType, severity: actionData?.severity }, 'Alert sent');
        break;
      }

      case 'spawn_worker': {
        // Spawn MCP worker for external tool access
        // Support both formats: action.data.task OR action.task (profile format)
        const actionAny = action as Record<string, unknown>;
        const task = (actionData?.task as string) || (actionAny.task as string) || '';
        const servers = (actionData?.servers as string[]) || (actionAny.servers as string[]) || [];
        const context = (actionData?.context || actionAny.context) as Record<string, unknown> | undefined;
        const timeout = (actionData?.timeout || actionAny.timeout) as number | undefined;

        if (!task || servers.length === 0) {
          logger.warn({ actionData, actionAny }, 'Invalid spawn_worker action: missing task or servers');
          break;
        }

        await spawnWorkerAsync(
          this.config.agentId,
          this.config.agentType,
          task,
          servers,
          context,
          timeout
        );
        logger.info({ task: task.slice(0, 50), servers }, 'Worker spawned');
        break;
      }


      default:
        logger.debug({ actionType: action.type }, 'Unknown action type');
    }
  }

  /**
   * Update agent status in Redis and DB
   */
  private async updateStatus(status: 'active' | 'inactive' | 'error'): Promise<void> {
    // Update Redis
    const healthStatus = status === 'active' ? 'healthy' :
                        status === 'error' ? 'unhealthy' : 'unknown';
    await setAgentStatus(this.config.agentId, {
      agentId: this.config.agentId,
      status: healthStatus as 'healthy' | 'unhealthy' | 'unknown',
      lastCheck: new Date(),
    });

    // Update DB
    const dbStatus = status === 'active' ? 'active' :
                     status === 'error' ? 'error' : 'inactive';
    await agentRepo.updateStatus(this.config.agentId, dbStatus);
  }

  /**
   * Log event to database
   */
  private async logEvent(eventType: EventType, payload: unknown): Promise<void> {
    await eventRepo.log({
      eventType,
      sourceAgent: this.config.agentId,
      payload,
    });
  }

  /**
   * Log to agent history (for RAG)
   */
  private async logHistory(
    actionType: 'decision' | 'task' | 'communication' | 'error' | 'idea',
    summary: string,
    details: unknown
  ): Promise<void> {
    await historyRepo.add({
      agentId: this.config.agentId,
      actionType,
      summary,
      details,
    });
  }

  /**
   * Get agent tier based on type
   */
  private getTier(): 'head' | 'clevel' {
    return this.config.agentType === 'ceo' || this.config.agentType === 'dao'
      ? 'head'
      : 'clevel';
  }

  /**
   * Health check endpoint data
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    agentType: string;
    status: string;
    loopCount: number;
    lastLoopAt: string | null;
    claudeAvailable: boolean;
  }> {
    const currentState = await this.state?.getAll() || {};

    return {
      healthy: this.isRunning,
      agentType: this.config.agentType,
      status: this.isRunning ? 'active' : 'inactive',
      loopCount: (currentState[StateKeys.LOOP_COUNT] as number) || 0,
      lastLoopAt: (currentState[StateKeys.LAST_LOOP_AT] as string) || null,
      claudeAvailable: this.claudeAvailable,
    };
  }
}

/**
 * Create daemon config from environment variables
 */
export function createDaemonConfigFromEnv(): DaemonConfig {
  const agentType = (process.env.AGENT_TYPE || 'ceo') as AgentType;

  return {
    agentType,
    agentId: process.env.AGENT_ID || crypto.randomUUID(),
    profilePath: process.env.PROFILE_PATH || '/app/profiles/' + agentType + '.md',
    loopInterval: parseInt(process.env.LOOP_INTERVAL || '3600', 10),
    loopEnabled: process.env.LOOP_ENABLED !== 'false',
    orchestratorUrl: process.env.ORCHESTRATOR_URL || 'http://orchestrator:8080',
  };
}
