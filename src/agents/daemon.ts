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
  getKanbanIssuesForAgent,
  executeClaudeAgent,
  type PendingDecision,
} from './claude.js';
import type { AgentType, AgentMessage, EventType } from '../lib/types.js';
import { spawnWorkerAsync } from '../workers/spawner.js';
import { queueForArchive } from '../workers/archive-worker.js';
import {
  runInitiativePhase,
  getInitiativePromptContext,
  createInitiativeFromProposal,
  buildInitiativeGenerationPrompt,
  type AgentType as InitiativeAgentType
} from './initiative.js';

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

    // Auto-extract state from worker_result to keep volatile state fresh
    if (message.type === 'worker_result' && message.payload) {
      await this.extractAndSaveWorkerState(message.payload as Record<string, unknown>);
    }

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
   * Auto-extract volatile state from worker results
   * This keeps market data, treasury balances, etc. fresh without relying on AI
   */
  private async extractAndSaveWorkerState(payload: Record<string, unknown>): Promise<void> {
    const result = payload.result as string | undefined;
    const task = payload.task as string | undefined;
    const success = payload.success as boolean | undefined;

    if (!success || !result) return;

    const taskLower = (task || '').toLowerCase();
    // Store reference to avoid TypeScript null check issues in nested async blocks
    const state = this.state;
    if (!state) return; // Guard against null state

    try {
      // Market data extraction
      if (taskLower.includes('price') || taskLower.includes('market') || taskLower.includes('coingecko')) {
        // Extract price if present (e.g., "$0.00001234" or "0.00001234 USD")
        const priceMatch = result.match(/\$?([\d.]+(?:e[+-]?\d+)?)\s*(?:usd|USD|\$)?/i);
        const priceStr = priceMatch?.[1];
        if (priceStr) {
          const price = parseFloat(priceStr);
          if (!isNaN(price) && price > 0) {
            await state.set('last_shibc_price', price);
            await state.set('market_data_timestamp', new Date().toISOString());
            logger.info({ price }, 'Auto-extracted SHIBC price from worker result');
          }
        }

        // Mark market data as fresh
        await state.set('market_data_verified', true);
        await state.set('market_data_fresh', true);
      }

      // Fear & Greed index extraction
      if (taskLower.includes('fear') && taskLower.includes('greed')) {
        const fgMatch = result.match(/(?:index|score)[:\s]*(\d+)/i);
        const fgStr = fgMatch?.[1];
        if (fgStr) {
          const fgIndex = parseInt(fgStr, 10);
          if (!isNaN(fgIndex) && fgIndex >= 0 && fgIndex <= 100) {
            await state.set('fear_greed_index', fgIndex);
            await state.set('market_sentiment', fgIndex < 25 ? 'extreme_fear' : fgIndex < 45 ? 'fear' : fgIndex < 55 ? 'neutral' : fgIndex < 75 ? 'greed' : 'extreme_greed');
            logger.info({ fgIndex }, 'Auto-extracted Fear & Greed index from worker result');
          }
        }
      }

      // Treasury/balance extraction
      if (taskLower.includes('balance') || taskLower.includes('treasury') || taskLower.includes('etherscan')) {
        // Extract ETH balance (e.g., "1.5 ETH" or "1,500 ETH")
        const ethMatch = result.match(/([\d,.]+)\s*ETH/i);
        const ethStr = ethMatch?.[1];
        if (ethStr) {
          const ethBalance = parseFloat(ethStr.replace(/,/g, ''));
          if (!isNaN(ethBalance)) {
            await state.set('treasury_eth_balance', ethBalance);
            await state.set('treasury_status', 'verified');
            logger.info({ ethBalance }, 'Auto-extracted ETH balance from worker result');
          }
        }

        // Extract USD value if present
        const usdMatch = result.match(/\$([\d,.]+)/);
        const usdStr = usdMatch?.[1];
        if (usdStr) {
          const usdValue = parseFloat(usdStr.replace(/,/g, ''));
          if (!isNaN(usdValue)) {
            await state.set('treasury_total_usd', usdValue);
          }
        }
      }

      // Holder count extraction
      if (taskLower.includes('holder') || (taskLower.includes('token') && taskLower.includes('info'))) {
        const holderMatch = result.match(/([\d,]+)\s*(?:holder|address)/i);
        const holderStr = holderMatch?.[1];
        if (holderStr) {
          const holderCount = parseInt(holderStr.replace(/,/g, ''), 10);
          if (!isNaN(holderCount) && holderCount > 0) {
            await state.set('holder_count_known', holderCount);
            await state.set('holder_count_timestamp', new Date().toISOString());
            logger.info({ holderCount }, 'Auto-extracted holder count from worker result');
          }
        }
      }

      // Telegram member count extraction
      if (taskLower.includes('telegram') && (taskLower.includes('member') || taskLower.includes('count'))) {
        const memberMatch = result.match(/([\d,]+)\s*(?:member|subscriber)/i);
        const memberStr = memberMatch?.[1];
        if (memberStr) {
          const memberCount = parseInt(memberStr.replace(/,/g, ''), 10);
          if (!isNaN(memberCount) && memberCount > 0) {
            await state.set('telegram_members', memberCount);
            logger.info({ memberCount }, 'Auto-extracted Telegram member count from worker result');
          }
        }
      }

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: errMsg }, 'Failed to extract state from worker result');
    }
  }

  /**
   * Determine if message requires AI processing
   */
  private shouldTriggerAI(message: AgentMessage): boolean {
    // Always trigger AI for these types
    const aiRequired: AgentMessage['type'][] = [
      'task',
      'decision',
      'alert',
      'vote',
      'worker_result',
      'pr_approved_by_rag',   // RAG-approved PR needs review
      'pr_review_assigned',   // Agent claimed a PR and needs to review it
    ];
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

      // Fetch Kanban issues for this agent (Scrumban workflow)
      let kanbanIssues;
      try {
        kanbanIssues = await getKanbanIssuesForAgent(this.config.agentType);
        if (kanbanIssues.inProgress.length > 0 || kanbanIssues.ready.length > 0) {
          logger.info({
            agentType: this.config.agentType,
            inProgress: kanbanIssues.inProgress.length,
            ready: kanbanIssues.ready.length,
            review: kanbanIssues.review.length,
          }, 'Kanban issues loaded for agent');
        }
      } catch (kanbanErr) {
        const errMsg = kanbanErr instanceof Error ? kanbanErr.message : String(kanbanErr);
        logger.warn({ error: errMsg }, 'Failed to fetch Kanban issues, continuing without');
      }

      // Build prompt
      const systemPrompt = generateSystemPrompt(this.profile);
      let loopPrompt = buildLoopPrompt(this.profile, currentState, { type: trigger, data }, pendingDecisions, ragContext, pendingTasks, kanbanIssues);

      // Add initiative context so agents can propose their own initiatives
      try {
        const initiativeContext = await getInitiativePromptContext(this.config.agentType as InitiativeAgentType);
        if (initiativeContext) {
          loopPrompt += '\n' + initiativeContext;
        }
      } catch (initCtxErr) {
        logger.debug({ error: initCtxErr }, 'Failed to get initiative context');
      }

      logger.debug({ systemPromptLength: systemPrompt.length, loopPromptLength: loopPrompt.length }, 'Prompt lengths');

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
            // Detect PR category based on summary content
            // Status updates (routine reports, metrics) → auto-merge, no RAG
            // Content (marketing, community content) → clevel review
            // Strategic (partnerships, major changes) → CEO review
            const summaryLower = (parsed.summary || '').toLowerCase();
            let prCategory: 'status' | 'content' | 'strategic' = 'content';
            if (summaryLower.includes('status update') ||
                summaryLower.includes('routine') ||
                summaryLower.includes('metrics') ||
                summaryLower.includes('loop') ||
                summaryLower.includes('daily report')) {
              prCategory = 'status';
            } else if (summaryLower.includes('strategy') ||
                       summaryLower.includes('partnership') ||
                       summaryLower.includes('major') ||
                       summaryLower.includes('critical')) {
              prCategory = 'strategic';
            }

            const commitResult = await workspace.commitAndCreatePR(
              this.config.agentType,
              parsed.summary || `Loop ${loopCount + 1} completed`,
              loopCount + 1,
              prCategory
            );
            if (commitResult.success && commitResult.filesChanged) {
              logger.info({
                filesChanged: commitResult.filesChanged,
                commitHash: commitResult.commitHash,
                prNumber: commitResult.prNumber,
                prUrl: commitResult.prUrl,
                category: prCategory,
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
                    category: prCategory,
                  },
                }));
                logger.info({ prNumber: commitResult.prNumber, category: prCategory }, 'PR review requested');
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

              // Log initiative as event (include all fields for dashboard)
              await eventRepo.log({
                eventType: 'initiative_created' as EventType,
                sourceAgent: this.config.agentId,
                payload: {
                  title: initiativeResult.initiative.title,
                  description: initiativeResult.initiative.description,
                  priority: initiativeResult.initiative.priority,
                  revenueImpact: initiativeResult.initiative.revenueImpact,
                  effort: initiativeResult.initiative.effort,
                  tags: initiativeResult.initiative.tags,
                  suggestedAssignee: initiativeResult.initiative.suggestedAssignee,
                  issueUrl: initiativeResult.issueUrl,
                },
              });
            } else if (initiativeResult.needsAIGeneration) {
              // No bootstrap initiatives left - run Claude Code to generate new ideas
              logger.info({ agentType: this.config.agentType }, 'Running AI-driven initiative generation');
              await this.runAIInitiativeGeneration();
            } else {
              logger.debug({ agentType: this.config.agentType }, 'No new initiatives to create (cooldown active)');
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
   * Run AI-driven initiative generation using Claude Code CLI
   * Called when no bootstrap initiatives are available
   */
  private async runAIInitiativeGeneration(): Promise<void> {
    if (!this.profile) {
      logger.warn('No profile loaded, skipping AI initiative generation');
      return;
    }

    try {
      // Build the initiative generation prompt with rich context (news, market, focus)
      const initiativePrompt = await buildInitiativeGenerationPrompt(
        this.config.agentType as InitiativeAgentType
      );

      if (!initiativePrompt) {
        logger.warn('Failed to build initiative prompt');
        return;
      }

      // Check if Claude is available
      if (!await isClaudeAvailable()) {
        logger.warn('Claude not available for AI initiative generation');
        return;
      }

      // Generate system prompt
      const systemPrompt = await generateSystemPrompt(this.profile);

      // Execute Claude Code to generate initiative
      logger.info({ agentType: this.config.agentType }, 'Calling Claude Code for initiative generation');
      const result = await executeClaudeCodeWithRetry({
        prompt: initiativePrompt,
        systemPrompt,
        timeout: 60000,
      });

      if (!result.success || !result.output) {
        logger.warn({ error: result.error }, 'Claude initiative generation failed');
        return;
      }

      // Parse the output for actions (specifically propose_initiative)
      const parsed = parseClaudeOutput(result.output);
      if (!parsed || !parsed.actions || parsed.actions.length === 0) {
        logger.info('No actions returned from AI initiative generation');
        return;
      }

      // Process any propose_initiative actions
      for (const action of parsed.actions) {
        if (action.type === 'propose_initiative') {
          await this.processAction(action);
        }
      }

      logger.info({ agentType: this.config.agentType }, 'AI initiative generation completed');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: errMsg }, 'AI initiative generation failed');
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
        const agentName = (actionData?.agent as string) || (actionAny.agent as string) || '';

        // If agent is specified, use Claude Agent instead of MCP worker
        if (agentName && task) {
          logger.info({ agent: agentName, task: task.slice(0, 50) }, 'Spawning Claude Agent for task');

          // Run Claude Agent asynchronously
          executeClaudeAgent({
            agent: agentName,
            prompt: task,
            timeout: timeout || 120000,
          }).then(async (result) => {
            // Send result back to parent agent
            const message: AgentMessage = {
              id: crypto.randomUUID(),
              type: 'direct',
              from: `agent:${agentName}`,
              to: this.config.agentId,
              payload: {
                type: 'worker_result',
                taskId: crypto.randomUUID(),
                success: result.success,
                result: result.output,
                error: result.error,
                duration: result.durationMs,
              },
              priority: 'normal',
              timestamp: new Date(),
              requiresResponse: false,
            };
            await publisher.publish(channels.agent(this.config.agentId), JSON.stringify(message));
            logger.info({ agent: agentName, success: result.success }, 'Agent result sent back');
          }).catch((error) => {
            logger.error({ error, agentName }, 'Claude Agent execution failed');
          });
          break;
        }

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

      case 'create_pr': {
        // Create a Pull Request for workspace changes
        // This handles all git operations: branch, commit, push, PR creation
        const folder = (actionData?.folder as string) || `/app/workspace/${this.profile?.codename || `SHIBC-${this.config.agentType.toUpperCase()}-001`}/`;
        const summary = (actionData?.summary as string) || `Workspace update from ${this.config.agentType.toUpperCase()}`;
        const loopNumber = (await this.state?.get(StateKeys.LOOP_COUNT)) || 0;
        // PR category: 'status' (auto-merge, no RAG), 'content' (clevel review), 'strategic' (CEO review)
        const rawCategory = (actionData?.category as string) || 'content';
        const category = (['status', 'content', 'strategic'].includes(rawCategory) ? rawCategory : 'content') as 'status' | 'content' | 'strategic';

        logger.info({ folder, summary, category, agentType: this.config.agentType }, 'Creating PR for workspace changes');

        try {
          const prResult = await workspace.commitAndCreatePR(
            this.config.agentType,
            summary,
            loopNumber as number,
            category
          );

          if (prResult.success) {
            if (prResult.prUrl) {
              logger.info({
                prUrl: prResult.prUrl,
                prNumber: prResult.prNumber,
                branch: prResult.branchName,
                filesChanged: prResult.filesChanged,
              }, 'PR created successfully');

              // Store PR info in state for agent feedback
              await this.state?.set('last_pr_url', prResult.prUrl);
              await this.state?.set('last_pr_number', prResult.prNumber);

              // Log as event
              await eventRepo.log({
                eventType: 'pr_created' as EventType,
                sourceAgent: this.config.agentId,
                payload: {
                  prUrl: prResult.prUrl,
                  prNumber: prResult.prNumber,
                  branch: prResult.branchName,
                  filesChanged: prResult.filesChanged,
                  summary,
                },
              });

              // Notify CTO for review (if not CTO creating the PR)
              if (this.config.agentType !== 'cto') {
                const reviewMessage: AgentMessage = {
                  id: crypto.randomUUID(),
                  type: 'task',
                  from: this.config.agentId,
                  to: 'cto',
                  payload: {
                    task_id: `pr-review-${prResult.prNumber}`,
                    title: `Review PR #${prResult.prNumber}: ${summary}`,
                    description: `Please review and merge/close PR: ${prResult.prUrl}`,
                    prUrl: prResult.prUrl,
                    prNumber: prResult.prNumber,
                    branch: prResult.branchName,
                  },
                  priority: 'normal',
                  timestamp: new Date(),
                  requiresResponse: false,
                };
                await publisher.publish(`channel:agent:cto`, JSON.stringify(reviewMessage));
                logger.info({ prNumber: prResult.prNumber }, 'Sent PR review request to CTO');
              }
            } else if (prResult.filesChanged === 0) {
              logger.info('No changes to commit');
            } else {
              logger.info({ commitHash: prResult.commitHash }, 'Changes committed locally (push/PR may have failed)');
            }
          } else {
            logger.warn('PR creation failed');
          }
        } catch (prError) {
          const errMsg = prError instanceof Error ? prError.message : String(prError);
          logger.error({ error: errMsg, folder }, 'Failed to create PR');
        }
        break;
      }

      case 'merge_pr': {
        // Merge a Pull Request (used after review approval)
        const prNumber = actionData?.prNumber as number;
        const category = (actionData?.category as string) || 'content';
        const agentType = (actionData?.agentType as string) || this.config.agentType;
        const summary = (actionData?.summary as string) || `PR #${prNumber} merged`;

        if (!prNumber) {
          logger.warn('merge_pr action missing prNumber');
          break;
        }

        try {
          const merged = await workspace.mergePullRequest(prNumber);
          if (merged) {
            logger.info({ prNumber, category }, 'PR merged successfully');

            // Emit pr_merged event for RAG indexing (handled by orchestrator)
            await publisher.publish(channels.orchestrator, JSON.stringify({
              id: crypto.randomUUID(),
              type: 'pr_merged',
              from: this.config.agentId,
              to: 'orchestrator',
              payload: {
                prNumber,
                category,
                agentType,
                summary,
                mergedBy: this.config.agentType,
              },
            }));

            // Log event
            await eventRepo.log({
              eventType: 'pr_merged' as EventType,
              sourceAgent: this.config.agentId,
              payload: { prNumber, mergedBy: this.config.agentType, category },
            });

            logger.info({ prNumber, category }, 'pr_merged event emitted to orchestrator');
          } else {
            logger.warn({ prNumber }, 'Failed to merge PR');
          }
        } catch (mergeError) {
          const errMsg = mergeError instanceof Error ? mergeError.message : String(mergeError);
          logger.error({ error: errMsg, prNumber }, 'Error merging PR');
        }
        break;
      }

      case 'claim_pr': {
        // Claim a PR for review (C-Level first-come-first-served)
        const prNumber = actionData?.prNumber as number;
        const prUrl = actionData?.prUrl as string;

        if (!prNumber) {
          logger.warn('claim_pr action missing prNumber');
          break;
        }

        try {
          // Send claim request to orchestrator
          await publisher.publish(channels.orchestrator, JSON.stringify({
            id: crypto.randomUUID(),
            type: 'claim_pr',
            from: this.config.agentId,
            to: 'orchestrator',
            payload: {
              prNumber,
              prUrl,
              agentType: actionData?.agentType,
              summary: actionData?.summary,
              category: actionData?.category,
              ragScore: actionData?.ragScore,
              ragFeedback: actionData?.ragFeedback,
            },
          }));

          logger.info({ prNumber, agentType: this.config.agentType }, 'PR claim request sent');
        } catch (claimError) {
          const errMsg = claimError instanceof Error ? claimError.message : String(claimError);
          logger.error({ error: errMsg, prNumber }, 'Error claiming PR');
        }
        break;
      }

      case 'close_pr': {
        // Close a Pull Request with feedback (reject)
        const prNumber = actionData?.prNumber as number;
        const reason = (actionData?.reason as string) || 'Closed by reviewer';

        if (!prNumber) {
          logger.warn('close_pr action missing prNumber');
          break;
        }

        try {
          const closed = await workspace.closePullRequest(prNumber, reason);
          if (closed) {
            logger.info({ prNumber, reason }, 'PR closed with feedback');

            // Log event
            await eventRepo.log({
              eventType: 'pr_rejected' as EventType,
              sourceAgent: this.config.agentId,
              payload: { prNumber, closedBy: this.config.agentType, reason },
            });

            // TODO: Notify original PR author with feedback
          } else {
            logger.warn({ prNumber }, 'Failed to close PR');
          }
        } catch (closeError) {
          const errMsg = closeError instanceof Error ? closeError.message : String(closeError);
          logger.error({ error: errMsg, prNumber }, 'Error closing PR');
        }
        break;
      }

      case 'request_human_action': {
        // Agent requests human to do something - creates GitHub issue assigned to human
        const request = actionData as {
          title?: string;
          description?: string;
          urgency?: 'low' | 'medium' | 'high' | 'critical';
          blockedInitiatives?: string[];
          category?: string;
        };

        if (!request?.title || !request?.description) {
          logger.warn({ request }, 'Invalid request_human_action: missing title or description');
          break;
        }

        try {
          const { createHumanActionRequest } = await import('./initiative.js');
          const result = await createHumanActionRequest({
            title: request.title,
            description: request.description,
            urgency: request.urgency || 'medium',
            requestedBy: this.config.agentType,
            blockedInitiatives: request.blockedInitiatives,
            category: request.category,
          });

          if (result.issueUrl) {
            logger.info({
              issueUrl: result.issueUrl,
              issueNumber: result.issueNumber,
              title: request.title,
            }, 'Human action request created - issue assigned to human');

            // Log as event
            await eventRepo.log({
              eventType: 'human_action_requested' as EventType,
              sourceAgent: this.config.agentId,
              payload: {
                title: request.title,
                description: request.description,
                urgency: request.urgency,
                issueUrl: result.issueUrl,
                issueNumber: result.issueNumber,
              },
            });
          }
        } catch (reqErr) {
          logger.warn({ error: reqErr, title: request.title }, 'Failed to create human action request');
        }
        break;
      }

      case 'update_issue': {
        // Agent updates a GitHub issue with progress comment
        const update = actionData as {
          issueNumber?: number;
          comment?: string;
        };

        if (!update?.issueNumber || !update?.comment) {
          logger.warn({ update }, 'Invalid update_issue: missing issueNumber or comment');
          break;
        }

        try {
          const { addIssueComment } = await import('./initiative.js');
          const success = await addIssueComment(
            update.issueNumber,
            update.comment,
            this.config.agentType
          );

          if (success) {
            logger.info({ issueNumber: update.issueNumber }, 'Issue updated with agent comment');
          }
        } catch (updateErr) {
          logger.warn({ error: updateErr, issueNumber: update.issueNumber }, 'Failed to update issue');
        }
        break;
      }

      case 'propose_initiative': {
        // Agent proposes a new initiative - create GitHub issue
        const proposal = actionData as {
          title?: string;
          description?: string;
          priority?: string;
          revenueImpact?: number;
          effort?: number;
          tags?: string[];
        };

        if (!proposal?.title) {
          logger.warn({ proposal }, 'Invalid propose_initiative: missing title');
          break;
        }

        try {
          const result = await createInitiativeFromProposal(
            this.config.agentType as InitiativeAgentType,
            {
              title: proposal.title,
              description: proposal.description || '',
              priority: proposal.priority || 'medium',
              revenueImpact: proposal.revenueImpact || 5,
              effort: proposal.effort || 5,
              tags: proposal.tags || [],
            }
          );

          if (result.issueUrl) {
            logger.info({
              title: result.initiative.title,
              issueUrl: result.issueUrl,
              revenueImpact: result.initiative.revenueImpact,
              effort: result.initiative.effort,
            }, 'Agent proposed initiative - GitHub issue created!');

            // Log as event
            await eventRepo.log({
              eventType: 'initiative_created' as EventType,
              sourceAgent: this.config.agentId,
              payload: {
                title: result.initiative.title,
                description: result.initiative.description,
                priority: result.initiative.priority,
                revenueImpact: result.initiative.revenueImpact,
                effort: result.initiative.effort,
                tags: result.initiative.tags,
                suggestedAssignee: result.initiative.suggestedAssignee,
                issueUrl: result.issueUrl,
                source: 'agent-proposed',
              },
            });
          } else {
            logger.debug({ title: proposal.title }, 'Initiative already exists or creation failed');
          }
        } catch (initErr) {
          logger.warn({ error: initErr, title: proposal.title }, 'Failed to create initiative from proposal');
        }
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
