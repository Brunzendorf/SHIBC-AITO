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
  streams,
  setAgentStatus,
  redis,
  claimTasks,
  acknowledgeTasks,
  recoverOrphanedTasks,
  getTaskCount,
  createConsumerGroup,
  readFromStream,
  acknowledgeMessages,
} from '../lib/redis.js';
import { agentRepo, historyRepo, eventRepo, decisionRepo, settingsRepo, auditRepo, brandConfigRepo, projectRepo } from '../lib/db.js';
import { rag } from '../lib/rag.js';
import { workspaceConfig } from '../lib/config.js';
import { workspace } from './workspace.js';
import { projects } from './projects.js';
import { loadProfile, generateSystemPrompt, type AgentProfile } from './profile.js';
import { createStateManager, StateKeys, type StateManager } from './state.js';
import {
  executeOllamaFallback,
  buildLoopPrompt,
  parseClaudeOutput,
  getKanbanIssuesForAgent,
  executeClaudeAgent,
  type PendingDecision,
  type BrandConfigContext,
} from './claude.js';
import {
  executeWithSessionAndRetry,
  buildSessionLoopPrompt,
  shutdownExecutor,
  getSessionPoolStats,
} from './session-executor.js';
import { llmRouter, type TaskContext } from '../lib/llm/index.js';
import type { AgentType, AgentMessage, EventType } from '../lib/types.js';
import type { StateTaskMessage, StateAckMessage } from '../services/state-machine/types.js';
import { spawnWorkerAsync, spawnWorker } from '../workers/spawner.js';
import { queueForArchive } from '../workers/archive-worker.js';
import { getTraceId, withTraceAsync } from '../lib/tracing.js';
import {
  runInitiativePhase,
  canRunInitiative,
  getInitiativePromptContext,
  createInitiativeFromProposal,
  buildInitiativeGenerationPrompt,
  type AgentType as InitiativeAgentType
} from './initiative.js';

const logger = createLogger('daemon');

// Status Service URL (TASK-108)
const STATUS_SERVICE_URL = process.env.STATUS_SERVICE_URL || 'http://aito-status:3002';

/**
 * Post agent status to Status Service (TASK-108)
 * Non-blocking - errors are logged but don't affect loop execution
 */
async function postAgentStatus(
  agentType: string,
  loopNumber: number,
  status: 'working' | 'idle' | 'blocked' | 'completed',
  activity: string,
  issueNumber?: number
): Promise<void> {
  try {
    const response = await fetch(`${STATUS_SERVICE_URL}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: agentType,
        loop: loopNumber,
        status,
        activity,
        issue: issueNumber,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      logger.warn({ agentType, status, error: errText }, 'Failed to post agent status');
    }
  } catch (error) {
    // Non-blocking - just log and continue
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.debug({ agentType, status, error: errMsg }, 'Status service unreachable (non-critical)');
  }
}

/**
 * Priority-based queue delays (in milliseconds)
 * Higher priority tasks are processed faster
 * Defaults used until DB settings are loaded
 */
let QUEUE_DELAYS: Record<string, number> = {
  critical: 0,           // Immediate
  urgent: 5_000,         // 5 seconds
  high: 30_000,          // 30 seconds
  normal: 120_000,       // 2 minutes
  low: 300_000,          // 5 minutes
  operational: 600_000,  // 10 minutes (batch operational tasks)
};

/**
 * Task limits - loaded from database
 */
let MAX_CONCURRENT_TASKS = 2;

/**
 * Load settings from database
 */
async function loadSettingsFromDB(): Promise<void> {
  try {
    // Load queue delays
    const queueDelays = await settingsRepo.getQueueDelays();
    if (Object.keys(queueDelays).length > 0) {
      QUEUE_DELAYS = { ...QUEUE_DELAYS, ...queueDelays };
      logger.info({ delays: QUEUE_DELAYS }, 'Loaded queue delays from database');
    }

    // Load task settings
    const taskSettings = await settingsRepo.getTaskSettings();
    MAX_CONCURRENT_TASKS = taskSettings.maxConcurrentPerAgent;
    logger.info({ maxConcurrent: MAX_CONCURRENT_TASKS }, 'Loaded task settings from database');
  } catch (error) {
    logger.warn({ error }, 'Failed to load settings from DB, using defaults');
  }
}

/**
 * Get delay based on highest priority task in queue
 */
function getQueueDelay(tasks: Array<{ priority?: string }>): number {
  if (tasks.length === 0) return QUEUE_DELAYS.normal;

  const priorities = ['critical', 'urgent', 'high', 'normal', 'low', 'operational'];
  for (const priority of priorities) {
    if (tasks.some(t => t.priority === priority)) {
      return QUEUE_DELAYS[priority] || QUEUE_DELAYS.normal;
    }
  }
  return QUEUE_DELAYS.normal;
}

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
  // TASK-002: Message queue for messages received during loop execution
  private pendingMessages: Array<{ message: AgentMessage; channel: string }> = [];
  private processingMessages = false; // Prevents concurrent message processing
  // TASK-109: Current state machine task context (set when triggered by state_task)
  private currentStateTask: StateTaskMessage | null = null;

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

      // 2.5. Load settings from database (queue delays, task limits, etc.)
      await loadSettingsFromDB();

      // 2.55. Recover orphaned tasks from previous crash (atomic queue pattern)
      const recoveredTasks = await recoverOrphanedTasks(this.config.agentType);
      if (recoveredTasks > 0) {
        logger.info({ recoveredTasks, agentType: this.config.agentType },
          'Recovered orphaned tasks from previous run - tasks requeued');
      }

      // 2.6. Initialize workspace (git clone)
      const workspaceInitialized = await workspace.initialize(this.config.agentType);
      logger.info({ success: workspaceInitialized }, 'Workspace initialized');

      // 2.7. Initialize projects directory (CTO only)
      if (this.config.agentType === 'cto') {
        const projectsInitialized = await projects.initialize();
        logger.info({ success: projectsInitialized }, 'Projects directory initialized');
      }

      // 3. Check LLM provider availability
      const availability = await llmRouter.checkAvailability();
      this.claudeAvailable = availability.claude || availability.gemini; // Keep old flag for backward compat
      logger.info({ availability }, 'LLM provider availability checked');

      // 4. Subscribe to Redis events
      await this.subscribeToEvents();
      logger.info('Event subscriptions active');

      // 4.5 TASK-016 Phase 2: Initialize Redis Streams consumer group for guaranteed delivery
      await this.initializeStreamConsumer();

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

      // Shutdown session pool if enabled
      if (process.env.SESSION_POOL_ENABLED === 'true') {
        logger.info('Shutting down session pool...');
        await shutdownExecutor();
      }

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
   * TASK-016 Phase 2: Initialize Redis Streams consumer for guaranteed message delivery
   * Creates consumer group and recovers any pending messages from previous crashes
   */
  private async initializeStreamConsumer(): Promise<void> {
    const streamKey = streams.agent(this.config.agentId);
    const groupName = `agent-${this.config.agentType}`;
    const consumerName = `${this.config.agentType}-${process.pid}`;

    try {
      // 1. Create consumer group (or reuse existing)
      await createConsumerGroup(streamKey, groupName, '$');
      logger.info({ streamKey, groupName }, 'Stream consumer group initialized');

      // 2. Check for pending messages (from previous crash)
      const pendingMessages = await this.recoverPendingStreamMessages(streamKey, groupName, consumerName);
      if (pendingMessages > 0) {
        logger.info({ pendingMessages, agentType: this.config.agentType },
          'Recovered pending stream messages from previous run');
      }

      // 3. Start background stream consumer loop
      this.startStreamConsumerLoop(streamKey, groupName, consumerName);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ error: errMsg }, 'Failed to initialize stream consumer, continuing with Pub/Sub only');
      // Non-fatal - Pub/Sub still works as fallback
    }
  }

  /**
   * Recover pending messages from previous crash
   * Claims messages that were delivered but not acknowledged
   */
  private async recoverPendingStreamMessages(
    streamKey: string,
    groupName: string,
    consumerName: string
  ): Promise<number> {
    const { getPendingMessages, claimPendingMessages } = await import('../lib/redis.js');

    // Get pending messages older than 30 seconds (likely from crashed consumer)
    const pending = await getPendingMessages(streamKey, groupName);
    if (pending.length === 0) return 0;

    // Filter for messages idle > 30 seconds (crashed consumer)
    const staleMessages = pending.filter(m => m.idleMs > 30000);
    if (staleMessages.length === 0) return 0;

    // Claim and process stale messages
    const messageIds = staleMessages.map(m => m.id);
    const claimed = await claimPendingMessages(streamKey, groupName, consumerName, 30000, messageIds);

    // Process recovered messages
    for (const { id, message } of claimed) {
      try {
        logger.info({ id, messageType: message.type }, 'Processing recovered stream message');
        await this.handleMessage(message, streamKey);
        // Acknowledge after successful processing
        await acknowledgeMessages(streamKey, groupName, [id]);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({ error: errMsg, id }, 'Failed to process recovered message');
        // Message stays pending for retry
      }
    }

    return claimed.length;
  }

  /**
   * Background loop to read from stream with guaranteed delivery
   * Runs continuously, processing messages as they arrive
   */
  private startStreamConsumerLoop(
    streamKey: string,
    groupName: string,
    consumerName: string
  ): void {
    const processLoop = async () => {
      while (this.isRunning) {
        try {
          // Read new messages (blocks for 5 seconds if none available)
          const messages = await readFromStream(streamKey, groupName, consumerName, 10, 5000);

          for (const { id, message } of messages) {
            try {
              // Process the message
              await this.handleMessage(message, streamKey);
              // Acknowledge on success
              await acknowledgeMessages(streamKey, groupName, [id]);
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              logger.error({ error: errMsg, id, messageType: message.type },
                'Failed to process stream message - will retry');
              // Don't acknowledge - message will be redelivered
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn({ error: errMsg }, 'Stream consumer loop error, retrying...');
          // Wait a bit before retrying to avoid tight error loops
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      logger.info('Stream consumer loop stopped');
    };

    // Start the loop in background (don't await)
    processLoop().catch(err => {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ error: errMsg }, 'Stream consumer loop crashed');
    });

    logger.info({ streamKey, consumerName }, 'Started stream consumer loop');
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
    // TASK-033: Wrap in trace context for distributed tracing
    subscriber.on('message', async (channel: string, message: string) => {
      try {
        const parsed = JSON.parse(message) as AgentMessage;
        // Use incoming correlationId as trace ID or generate new one
        await withTraceAsync(
          () => this.handleMessage(parsed, channel),
          {
            traceId: parsed.correlationId,
            metadata: {
              messageType: parsed.type,
              from: parsed.from,
              channel,
            },
          }
        );
      } catch (error) {
        logger.error({ channel, error }, 'Failed to handle message');
      }
    });
  }

  /**
   * Handle incoming message
   * TASK-002: Queue messages when loop is in progress to prevent state conflicts
   */
  private async handleMessage(message: AgentMessage, channel: string): Promise<void> {
    logger.debug({ type: message.type, from: message.from, channel }, 'Received message');

    // Auto-extract state from worker_result to keep volatile state fresh
    // This is safe to do even during loop - it only sets volatile state keys
    if (message.type === 'worker_result' && message.payload) {
      await this.extractAndSaveWorkerState(message.payload as Record<string, unknown>);
    }

    // TASK-002: Queue messages that need AI processing if loop is in progress
    if (this.loopInProgress || this.processingMessages) {
      const needsAI = this.shouldTriggerAI(message);
      if (needsAI) {
        logger.debug({ type: message.type, queueLength: this.pendingMessages.length + 1 },
          'Loop in progress, queueing message for later processing');
        this.pendingMessages.push({ message, channel });
        return;
      }
      // Simple messages that don't need AI can still be handled immediately
    }

    // Determine if we need to trigger AI
    const needsAI = this.shouldTriggerAI(message);

    if (needsAI) {
      logger.info({ type: message.type }, 'Triggering AI for message');

      // TASK-109: Extract and store state task context for state_task messages
      if (message.type === 'state_task' && message.payload) {
        this.currentStateTask = message.payload as StateTaskMessage;
        logger.info({
          machineId: this.currentStateTask.machineId,
          state: this.currentStateTask.state,
          workflowType: this.currentStateTask.workflowType,
          attemptNumber: this.currentStateTask.attemptNumber,
        }, 'State machine task received');
      }

      await this.runLoop('message', message);
    } else {
      // Handle simple events without AI
      await this.handleSimpleMessage(message);
    }
  }

  /**
   * TASK-002: Process queued messages after loop completes
   * Called at the end of runLoop to handle messages that arrived during execution
   */
  private async processQueuedMessages(): Promise<void> {
    if (this.pendingMessages.length === 0) return;

    this.processingMessages = true;
    const messagesToProcess = [...this.pendingMessages];
    this.pendingMessages = []; // Clear queue before processing

    logger.info({ count: messagesToProcess.length }, 'Processing queued messages');

    for (const { message, channel } of messagesToProcess) {
      try {
        // Re-check if message still needs AI (state may have changed)
        const needsAI = this.shouldTriggerAI(message);

        if (needsAI) {
          logger.info({ type: message.type }, 'Processing queued message with AI');
          await this.runLoop('queued_message', message);
        } else {
          await this.handleSimpleMessage(message);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({ error: errMsg, messageType: message.type, channel }, 'Error processing queued message');
      }
    }

    this.processingMessages = false;
  }

  /**
   * TASK-109: Build prompt for state machine tasks
   * Uses the state machine's prompt and injects context for agent to work on
   */
  private buildStateMachinePrompt(
    stateTask: StateTaskMessage,
    agentState: Record<string, unknown>,
    ragContext: string
  ): string {
    const sections: string[] = [];

    // Header with workflow info
    sections.push(`## STATE MACHINE TASK

You are executing state **${stateTask.state}** in workflow **${stateTask.workflowType}**.
Machine ID: ${stateTask.machineId}
Attempt: ${stateTask.attemptNumber}/${stateTask.timeout / 60000} min timeout

---`);

    // State Machine Context (project info, previous state results)
    sections.push(`## WORKFLOW CONTEXT

\`\`\`json
${JSON.stringify(stateTask.context, null, 2)}
\`\`\`

---`);

    // The actual task prompt from the state definition
    sections.push(`## YOUR TASK

${stateTask.prompt}

---`);

    // Required output fields
    sections.push(`## REQUIRED OUTPUT

Your response MUST include JSON with these fields in your output:

\`\`\`json
{
${stateTask.requiredOutput.map(field => `  "${field}": "<your value here>"`).join(',\n')}
}
\`\`\`

Mark the JSON block clearly so it can be parsed. Example:

**STATE_OUTPUT:**
\`\`\`json
{
${stateTask.requiredOutput.map(field => `  "${field}": "..."`).join(',\n')}
}
\`\`\`

---`);

    // RAG context if available
    if (ragContext) {
      sections.push(`## RELEVANT CONTEXT FROM MEMORY

${ragContext}

---`);
    }

    // Current agent state (subset)
    const relevantState: Record<string, unknown> = {};
    const stateKeys = ['last_loop_at', 'project_path', 'current_task', 'loop_count'];
    for (const key of stateKeys) {
      if (agentState[key] !== undefined) {
        relevantState[key] = agentState[key];
      }
    }
    if (Object.keys(relevantState).length > 0) {
      sections.push(`## AGENT STATE

\`\`\`json
${JSON.stringify(relevantState, null, 2)}
\`\`\`

---`);
    }

    // Instructions for completion
    sections.push(`## COMPLETION

When you complete this state:
1. Execute the required work
2. Output the STATE_OUTPUT JSON block with all required fields
3. Include any errors in the JSON if something failed

The state machine will automatically advance to the next state based on your output.`);

    return sections.join('\n\n');
  }

  /**
   * TASK-109: Send state acknowledgment to state machine service
   */
  private async sendStateAck(
    stateTask: StateTaskMessage,
    success: boolean,
    output: Record<string, unknown>,
    error?: string
  ): Promise<void> {
    const ack: StateAckMessage = {
      type: 'state_ack',
      machineId: stateTask.machineId,
      state: stateTask.state,
      success,
      output,
      error,
    };

    // Publish to state machine service channel
    const channel = 'channel:state-machine';
    try {
      await publisher.publish(channel, JSON.stringify(ack));
      logger.info({
        machineId: stateTask.machineId,
        state: stateTask.state,
        success,
        hasError: !!error,
      }, 'State acknowledgment sent');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ error: errMsg, machineId: stateTask.machineId }, 'Failed to send state acknowledgment');
    }
  }

  /**
   * TASK-109: Parse state output from agent's response
   * Looks for STATE_OUTPUT JSON block in the response
   */
  private parseStateOutput(claudeOutput: string, requiredFields: string[]): {
    success: boolean;
    output: Record<string, unknown>;
    error?: string;
  } {
    try {
      // Look for STATE_OUTPUT JSON block
      const stateOutputMatch = claudeOutput.match(/\*\*STATE_OUTPUT:\*\*\s*```json\s*([\s\S]*?)```/);
      if (stateOutputMatch) {
        const parsed = JSON.parse(stateOutputMatch[1].trim());

        // Check if all required fields are present
        const missingFields = requiredFields.filter(field => !(field in parsed));
        if (missingFields.length > 0) {
          return {
            success: false,
            output: parsed,
            error: `Missing required fields: ${missingFields.join(', ')}`,
          };
        }

        // Check if agent reported an error
        if (parsed.error || parsed.success === false) {
          return {
            success: false,
            output: parsed,
            error: parsed.error || 'Agent reported failure',
          };
        }

        return { success: true, output: parsed };
      }

      // Fallback: Try to find any JSON block with required fields
      const jsonMatches = claudeOutput.match(/```json\s*([\s\S]*?)```/g);
      if (jsonMatches) {
        for (const match of jsonMatches) {
          try {
            const jsonContent = match.replace(/```json\s*/, '').replace(/```$/, '').trim();
            const parsed = JSON.parse(jsonContent);

            // Check if this JSON has any required fields
            const hasRequiredField = requiredFields.some(field => field in parsed);
            if (hasRequiredField) {
              const missingFields = requiredFields.filter(field => !(field in parsed));
              if (missingFields.length === 0) {
                return { success: true, output: parsed };
              }
            }
          } catch {
            // Continue to next JSON block
          }
        }
      }

      // No valid state output found
      return {
        success: false,
        output: {},
        error: 'No STATE_OUTPUT JSON block found in response',
      };
    } catch (err) {
      return {
        success: false,
        output: {},
        error: `Failed to parse state output: ${err instanceof Error ? err.message : String(err)}`,
      };
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
      'state_task',           // State Machine task (TASK-109)
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

      // TASK-108: Post "working" status at loop start
      postAgentStatus(this.config.agentType, loopCount + 1, 'working', `Processing ${trigger} trigger`);

      // TASK-006: Get essential state only (performance optimization)
      // Loads only 6 keys instead of potentially 1000+ keys
      const currentState = await this.state.getEssential();

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

      // Fetch pending tasks from queue using atomic claim pattern
      // Tasks are moved to a processing list, preventing race conditions
      let pendingTasks: Array<{ title: string; description: string; priority: string; from: string }> = [];
      let claimedTasks: Array<{ raw: string; parsed: Record<string, unknown> }> = [];
      try {
        claimedTasks = await claimTasks(this.config.agentType, 10);
        if (claimedTasks.length > 0) {
          pendingTasks = claimedTasks.map(t => {
            // Support both formats: direct fields OR nested in payload
            const payload = t.parsed.payload as Record<string, unknown> | undefined;
            return {
              title: (t.parsed.title as string) || (payload?.title as string) || 'Untitled Task',
              description: (t.parsed.description as string) || (payload?.description as string) || '',
              priority: (t.parsed.priority as string) || 'normal',
              from: (t.parsed.from as string) || 'unknown',
            };
          });
          logger.info({ count: pendingTasks.length, agentType: this.config.agentType }, 'Claimed pending tasks atomically');
        }
      } catch (taskError) {
        const errMsg = taskError instanceof Error ? taskError.message : String(taskError);
        logger.warn({ error: errMsg }, 'Failed to claim pending tasks');
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

      // Fetch brand configuration (white-label CI from database)
      let brandConfig: BrandConfigContext | null = null;
      try {
        brandConfig = await brandConfigRepo.getForAgent();
        if (brandConfig) {
          logger.debug({ projectName: brandConfig.name }, 'Brand config loaded from database');
        }
      } catch (brandErr) {
        const errMsg = brandErr instanceof Error ? brandErr.message : String(brandErr);
        logger.warn({ error: errMsg }, 'Failed to fetch brand config, continuing without');
      }

      // TASK LIMIT: Max concurrent in-progress tasks per agent (loaded from DB)
      const currentInProgress = kanbanIssues?.inProgress?.length || 0;
      if (currentInProgress >= MAX_CONCURRENT_TASKS) {
        logger.info({
          agentType: this.config.agentType,
          currentInProgress,
          maxAllowed: MAX_CONCURRENT_TASKS,
        }, 'Agent at max capacity - clearing pending tasks to focus on current work');
        // Clear pending tasks - agent should focus on completing current work
        pendingTasks = [];
      }

      // PRIORITY SORTING: Sort pending tasks by priority (critical first)
      const priorityOrder: Record<string, number> = { critical: 0, urgent: 1, high: 2, normal: 3, low: 4, operational: 5 };
      pendingTasks.sort((a, b) => {
        const pa = priorityOrder[a.priority] ?? 3;
        const pb = priorityOrder[b.priority] ?? 3;
        return pa - pb;
      });

      // Build prompt
      const systemPrompt = generateSystemPrompt(this.profile);
      let loopPrompt: string;

      // TASK-109: Build special prompt for state machine tasks
      if (this.currentStateTask) {
        loopPrompt = this.buildStateMachinePrompt(this.currentStateTask, currentState, ragContext);
        logger.info({
          machineId: this.currentStateTask.machineId,
          state: this.currentStateTask.state,
          promptLength: loopPrompt.length,
        }, 'Built state machine prompt');
      } else {
        // Standard loop prompt
        loopPrompt = buildLoopPrompt(this.profile, currentState, { type: trigger, data }, pendingDecisions, ragContext, pendingTasks, kanbanIssues, brandConfig);

        // Add initiative context so agents can propose their own initiatives
        try {
          const initiativeContext = await getInitiativePromptContext(this.config.agentType as InitiativeAgentType);
          if (initiativeContext) {
            loopPrompt += '\n' + initiativeContext;
          }
        } catch (initCtxErr) {
          logger.debug({ error: initCtxErr }, 'Failed to get initiative context');
        }
      }

      logger.debug({ systemPromptLength: systemPrompt.length, loopPromptLength: loopPrompt.length }, 'Prompt lengths');

      // Execute AI with intelligent routing (Claude vs Gemini) or Session Pool
      let result;
      const sessionPoolEnabled = process.env.SESSION_POOL_ENABLED === 'true';

      if (sessionPoolEnabled && this.claudeAvailable && this.profile) {
        // SESSION POOL MODE: Use persistent Claude sessions
        // This dramatically reduces token usage by keeping context between loops
        logger.info({ agentType: this.config.agentType }, 'Using session pool mode');

        // Build optimized prompt for session mode (no full profile needed)
        const sessionPrompt = buildSessionLoopPrompt(
          { type: trigger, data },
          currentState,
          {
            pendingDecisions: pendingDecisions.map(d => ({
              id: d.id,
              title: d.title,
              tier: d.tier,
            })),
            pendingTasks: pendingTasks.map(t => ({
              title: t.title,
              priority: t.priority,
              from: t.from,
            })),
            ragContext: ragContext || undefined,
            kanbanIssues: kanbanIssues ? {
              inProgress: kanbanIssues.inProgress,
              ready: kanbanIssues.ready,
            } : undefined,
            brandConfig: brandConfig ? {
              name: brandConfig.name,
              shortName: brandConfig.shortName,
              colors: brandConfig.colors,
              socials: { twitter: brandConfig.socials.twitter, website: brandConfig.socials.website },
              imageStyle: { aesthetic: brandConfig.imageStyle.aesthetic, defaultBranding: brandConfig.imageStyle.defaultBranding },
            } : null,
          }
        );

        result = await executeWithSessionAndRetry(
          {
            agentType: this.config.agentType,
            profile: this.profile,
            mcpConfigPath: process.env.MCP_CONFIG_PATH || '/app/.claude/mcp_servers.json',
          },
          sessionPrompt,
          systemPrompt,
          300000, // 5 minutes
          3 // maxRetries
        );

        logger.info({
          sessionPoolEnabled: true,
          promptLength: sessionPrompt.length,
          savedTokens: loopPrompt.length - sessionPrompt.length,
        }, 'Session execution completed');

      } else if (this.claudeAvailable) {
        // SINGLE-SHOT MODE: Use LLM router (Claude or Gemini)
        // Build task context for routing decision
        const taskContext: TaskContext = {
          taskType: 'loop',
          agentType: this.config.agentType,
          estimatedComplexity: pendingDecisions && pendingDecisions.length > 0 ? 'complex' : 'medium',
          priority: pendingTasks && pendingTasks.some(t => t.priority === 'critical') ? 'critical' : 'normal',
        };

        // Get MCP servers for this agent type
        const mcpServersForAgent = {
          ceo: ['filesystem', 'fetch'],
          dao: ['filesystem', 'etherscan'],
          cmo: ['telegram', 'fetch', 'filesystem'],
          cto: ['directus', 'filesystem', 'fetch'],
          cfo: ['etherscan', 'filesystem'],
          coo: ['telegram', 'filesystem'],
          cco: ['filesystem', 'fetch'],
        };

        result = await llmRouter.execute({
          prompt: loopPrompt,
          systemPrompt,
          timeout: 300000, // 5 minutes
          maxRetries: 3,
          mcpConfigPath: process.env.MCP_CONFIG_PATH || '/app/.claude/mcp_servers.json', // For Claude
          mcpServers: mcpServersForAgent[this.config.agentType as keyof typeof mcpServersForAgent] || [], // For Gemini
        }, taskContext);
      } else {
        logger.warn('No LLM providers available, using Ollama fallback');
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

          // Process actions with retry logic (TASK-004)
          if (parsed.actions) {
            for (const action of parsed.actions) {
              await this.executeActionWithRetry(action);
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

          // Commit workspace changes to git
          if (await workspace.hasUncommittedChanges()) {
            // Check if PR workflow is bypassed (WORKSPACE_SKIP_PR=true)
            if (workspaceConfig.skipPR) {
              // Direct push mode - bypass PR workflow entirely
              const directResult = await workspace.commitAndPushDirect(
                this.config.agentType,
                parsed.summary || `Loop ${loopCount + 1} completed`
              );
              if (directResult.success && directResult.filesChanged) {
                logger.info({
                  filesChanged: directResult.filesChanged,
                  commitHash: directResult.commitHash,
                  mode: 'direct_push_bypass',
                }, 'Workspace changes pushed directly (PR bypassed)');

                // Publish workspace update event for dashboard (no RAG review)
                await publisher.publish(channels.orchestrator, JSON.stringify({
                  id: crypto.randomUUID(),
                  type: 'workspace_update',
                  from: this.config.agentId,
                  to: 'orchestrator',
                  payload: {
                    agentType: this.config.agentType,
                    commitHash: directResult.commitHash,
                    filesChanged: directResult.filesChanged,
                    summary: parsed.summary,
                    mode: 'direct_push',
                  },
                }));
              }
            } else {
              // Standard PR workflow with quality gate
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
        }

        // TASK-109: Send state acknowledgment for state machine tasks
        if (this.currentStateTask) {
          try {
            const stateResult = this.parseStateOutput(result.output, this.currentStateTask.requiredOutput);
            await this.sendStateAck(
              this.currentStateTask,
              stateResult.success,
              stateResult.output,
              stateResult.error
            );
            logger.info({
              machineId: this.currentStateTask.machineId,
              state: this.currentStateTask.state,
              success: stateResult.success,
              outputFields: Object.keys(stateResult.output),
            }, 'State task completed and acknowledged');
          } catch (stateAckErr) {
            const errMsg = stateAckErr instanceof Error ? stateAckErr.message : String(stateAckErr);
            logger.error({ error: errMsg }, 'Failed to send state acknowledgment');
          } finally {
            // Clear the state task context
            this.currentStateTask = null;
          }
        }

        // Update success count
        const successCount = (await this.state.get<number>(StateKeys.SUCCESS_COUNT)) || 0;
        await this.state.set(StateKeys.SUCCESS_COUNT, successCount + 1);

        // ACKNOWLEDGE PROCESSED TASKS: Remove them from processing list
        // Uses atomic pattern - tasks were already moved to processing list during claim
        if (claimedTasks.length > 0) {
          try {
            await acknowledgeTasks(this.config.agentType, claimedTasks);
            logger.info({
              acknowledged: claimedTasks.length,
              agentType: this.config.agentType
            }, 'Acknowledged and removed processed tasks from processing list');
          } catch (ackError) {
            const errMsg = ackError instanceof Error ? ackError.message : String(ackError);
            logger.warn({ error: errMsg }, 'Failed to acknowledge tasks - will be recovered on restart');
          }
        }

      } else {
        logger.error({ error: result.error }, 'Loop execution failed');

        // TASK-109: Send failure acknowledgment for state machine tasks
        if (this.currentStateTask) {
          try {
            await this.sendStateAck(
              this.currentStateTask,
              false,
              {},
              result.error || 'Loop execution failed'
            );
            logger.info({
              machineId: this.currentStateTask.machineId,
              state: this.currentStateTask.state,
              error: result.error,
            }, 'State task failed and acknowledged');
          } catch (stateAckErr) {
            const errMsg = stateAckErr instanceof Error ? stateAckErr.message : String(stateAckErr);
            logger.error({ error: errMsg }, 'Failed to send state failure acknowledgment');
          } finally {
            // Clear the state task context
            this.currentStateTask = null;
          }
        }

        // Update error count
        const errorCount = (await this.state.get<number>(StateKeys.ERROR_COUNT)) || 0;
        await this.state.set(StateKeys.ERROR_COUNT, errorCount + 1);

        // On failure, tasks remain in processing list
        // They will be recovered on next agent startup via recoverOrphanedTasks()
        if (claimedTasks.length > 0) {
          logger.warn({
            orphanedTasks: claimedTasks.length,
            agentType: this.config.agentType
          }, 'Tasks left in processing list - will be recovered on restart');
        }
      }

      // Update last loop timestamp
      await this.state.set(StateKeys.LAST_LOOP_AT, new Date().toISOString());

      const duration = Date.now() - loopStart;
      logger.info({ trigger, duration, success: result.success }, 'Loop completed');

      // TASK-108: Post "idle" status at loop end
      const completedLoopCount = (await this.state.get<number>(StateKeys.LOOP_COUNT)) || 0;
      postAgentStatus(
        this.config.agentType,
        completedLoopCount,
        result.success ? 'idle' : 'blocked',
        result.success ? `Completed ${trigger} loop` : `Loop failed: ${trigger}`
      );

      // EVENT-DRIVEN: Check if more tasks in queue
      // Note: This is a read-only peek to decide if we need another loop.
      // Actual task claiming happens atomically in the next runLoop call.
      if (result.success) {
        const remainingCount = await getTaskCount(this.config.agentType);

        if (remainingCount > 0) {
          // Peek at first few tasks for priority-based delay calculation
          const taskQueueKey = `queue:tasks:${this.config.agentType}`;
          const rawTasks = await redis.lrange(taskQueueKey, 0, 4);
          // Parse tasks to get priority
          const parsedTasks = rawTasks.map(t => {
            try { return JSON.parse(t); } catch { return { priority: 'normal' }; }
          });

          // Calculate delay based on highest priority task
          const delay = getQueueDelay(parsedTasks);
          const highestPriority = parsedTasks[0]?.priority || 'normal';

          logger.info({
            remainingTasks: remainingCount,
            highestPriority,
            delayMs: delay,
            agentType: this.config.agentType
          }, 'More tasks in queue, scheduling continuation with priority-based delay');

          // Priority-based delay before next loop
          setTimeout(() => this.runLoop('queue_continuation'), delay);
        } else {
          // Queue empty - check if we should run initiative phase
          logger.info({
            agentType: this.config.agentType,
            trigger,
          }, 'Task queue empty');

          // TASK-005: Run initiative phase if:
          // 1. Scheduled loop (always)
          // 2. After task processing (message trigger) if cooldown has passed
          // Excludes queue_continuation to prevent excessive API calls
          const shouldRunInitiative = trigger === 'scheduled' ||
            (trigger !== 'queue_continuation' && await canRunInitiative(this.config.agentType as InitiativeAgentType));

          if (shouldRunInitiative) {
            try {
              logger.debug({ trigger }, 'Running initiative phase');
              const initiativeResult = await runInitiativePhase(this.config.agentType as InitiativeAgentType);
              if (initiativeResult.created && initiativeResult.initiative) {
                logger.info({
                  title: initiativeResult.initiative.title,
                  issueUrl: initiativeResult.issueUrl,
                  revenueImpact: initiativeResult.initiative.revenueImpact,
                  trigger,
                }, 'Initiative created');

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
                logger.info({ agentType: this.config.agentType }, 'Running AI-driven initiative generation');
                await this.runAIInitiativeGeneration();
              }
            } catch (initError) {
              const errMsg = initError instanceof Error ? initError.message : String(initError);
              logger.warn({ error: errMsg }, 'Initiative phase failed');
            }
          } else {
            logger.debug({ trigger }, 'Skipping initiative phase (cooldown active or queue continuation)');
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

      // TASK-002: Process any messages that arrived during the loop
      // This happens after lock is released to allow proper re-entry
      if (this.pendingMessages.length > 0) {
        // Use setImmediate to allow current call stack to complete
        setImmediate(() => {
          this.processQueuedMessages().catch((err) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error({ error: errMsg }, 'Error processing queued messages');
          });
        });
      }
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

      // Check if any LLM provider is available
      const availability = await llmRouter.checkAvailability();
      if (!availability.claude && !availability.gemini) {
        logger.warn('No LLM providers available for AI initiative generation');
        return;
      }

      // Generate system prompt
      const systemPrompt = await generateSystemPrompt(this.profile);

      // Execute with LLM routing (initiative generation uses reasoning, so Claude preferred)
      logger.info({ agentType: this.config.agentType }, 'Calling LLM for initiative generation');
      const taskContext: TaskContext = {
        taskType: 'loop',
        agentType: this.config.agentType,
        requiresReasoning: true, // Force Claude for initiative generation
        priority: 'high',
      };
      // Get MCP servers for this agent type
      const mcpServersForAgent = {
        ceo: ['filesystem', 'fetch'],
        dao: ['filesystem', 'etherscan'],
        cmo: ['telegram', 'fetch', 'filesystem'],
        cto: ['directus', 'filesystem', 'fetch'],
        cfo: ['etherscan', 'filesystem'],
        coo: ['telegram', 'filesystem'],
        cco: ['filesystem', 'fetch'],
      };

      const result = await llmRouter.execute({
        prompt: initiativePrompt,
        systemPrompt,
        timeout: 60000,
        mcpConfigPath: process.env.MCP_CONFIG_PATH || '/app/.claude/mcp_servers.json', // For Claude
        mcpServers: mcpServersForAgent[this.config.agentType as keyof typeof mcpServersForAgent] || [], // For Gemini
      }, taskContext);

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

      // Process any propose_initiative actions with retry logic (TASK-004)
      for (const action of parsed.actions) {
        if (action.type === 'propose_initiative') {
          await this.executeActionWithRetry(action);
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
   * TASK-033: Includes trace ID as correlationId for distributed tracing
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
      correlationId: getTraceId(), // TASK-033: Propagate trace ID
    };

    const channel = to === 'all' ? channels.broadcast :
                   to === 'head' ? channels.head :
                   to === 'clevel' ? channels.clevel :
                   channels.agent(to);

    await publisher.publish(channel, JSON.stringify(message));
    logger.debug({ to, channel }, 'Message sent');
  }

  /**
   * TASK-004: Execute action with retry logic
   * Retries up to 3 times with exponential backoff
   * Failed actions are logged to dead-letter queue
   */
  private async executeActionWithRetry(action: { type: string; data?: unknown }): Promise<void> {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.processAction(action);
        return; // Success
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn({
          actionType: action.type,
          attempt,
          maxRetries,
          error: errMsg,
        }, 'Action failed, will retry');

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          // Max retries exhausted - log to dead-letter queue
          logger.error({
            actionType: action.type,
            attempts: maxRetries,
            error: errMsg,
          }, 'Action failed after max retries, adding to dead-letter queue');

          await this.logFailedAction(action, errMsg);
        }
      }
    }
  }

  /**
   * TASK-004: Log failed action to Redis dead-letter queue for later analysis
   */
  private async logFailedAction(action: { type: string; data?: unknown }, error: string): Promise<void> {
    const failedAction = {
      action,
      error,
      agentType: this.config.agentType,
      agentId: this.config.agentId,
      timestamp: new Date().toISOString(),
    };

    const deadLetterKey = `queue:failed:${this.config.agentType}`;
    await redis.lpush(deadLetterKey, JSON.stringify(failedAction));

    // Keep only last 100 failed actions per agent
    await redis.ltrim(deadLetterKey, 0, 99);
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

        // TASK-007: Audit log for sensitive action
        await auditRepo.log({
          agentId: this.config.agentId,
          agentType: this.config.agentType,
          actionType: 'vote',
          actionData: {
            decisionId: actionData?.decisionId,
            vote: actionData?.vote || 'abstain',
            reason: actionData?.reason,
          },
        }).catch(err => logger.warn({ err }, 'Failed to log audit entry for vote'));

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

        // TASK-007: Audit log for sensitive action
        await auditRepo.log({
          agentId: this.config.agentId,
          agentType: this.config.agentType,
          actionType: 'spawn_worker',
          actionData: {
            task: task.slice(0, 200), // Truncate for storage
            servers,
            timeout: timeout || 'default',
          },
        }).catch(err => logger.warn({ err }, 'Failed to log audit entry for spawn_worker'));

        break;
      }

      case 'commit_to_main':
      case 'create_pr': {
        // Commit and push directly to main (no PRs - main-only workflow)
        const message = (actionData?.message as string) || (actionData?.summary as string) || `Update from ${this.config.agentType.toUpperCase()}`;

        logger.info({ message, agentType: this.config.agentType }, 'Committing to main');

        try {
          const result = await workspace.commitAndPush(this.config.agentType, message);

          if (result.success) {
            if (result.filesChanged && result.filesChanged > 0) {
              logger.info({
                commitHash: result.commitHash,
                filesChanged: result.filesChanged,
              }, 'Committed and pushed to main');

              // Store commit info in state
              await this.state?.set('last_commit_hash', result.commitHash);

              // Log as event
              await eventRepo.log({
                eventType: 'workspace_commit' as EventType,
                sourceAgent: this.config.agentId,
                payload: {
                  commitHash: result.commitHash,
                  filesChanged: result.filesChanged,
                  message,
                },
              });
            } else {
              logger.info('No changes to commit');
            }
          } else {
            logger.warn('Commit/push failed');
          }
        } catch (commitError) {
          const errMsg = commitError instanceof Error ? commitError.message : String(commitError);
          logger.error({ error: errMsg }, 'Failed to commit to main');
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

            // TASK-007: Audit log for sensitive action (success)
            await auditRepo.log({
              agentId: this.config.agentId,
              agentType: this.config.agentType,
              actionType: 'merge_pr',
              actionData: { prNumber, category, summary },
              success: true,
            }).catch(err => logger.warn({ err }, 'Failed to log audit entry for merge_pr'));

            logger.info({ prNumber, category }, 'pr_merged event emitted to orchestrator');
          } else {
            logger.warn({ prNumber }, 'Failed to merge PR');

            // TASK-007: Audit log for sensitive action (failure)
            await auditRepo.log({
              agentId: this.config.agentId,
              agentType: this.config.agentType,
              actionType: 'merge_pr',
              actionData: { prNumber, category },
              success: false,
              errorMessage: 'Merge returned false',
            }).catch(err => logger.warn({ err }, 'Failed to log audit entry for merge_pr'));
          }
        } catch (mergeError) {
          const errMsg = mergeError instanceof Error ? mergeError.message : String(mergeError);
          logger.error({ error: errMsg, prNumber }, 'Error merging PR');

          // TASK-007: Audit log for sensitive action (error)
          await auditRepo.log({
            agentId: this.config.agentId,
            agentType: this.config.agentType,
            actionType: 'merge_pr',
            actionData: { prNumber, category },
            success: false,
            errorMessage: errMsg,
          }).catch(err => logger.warn({ err }, 'Failed to log audit entry for merge_pr'));
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

      case 'claim_issue': {
        // Agent claims a GitHub issue - sets status to in-progress
        const claim = actionData as {
          issueNumber?: number;
        };

        if (!claim?.issueNumber) {
          logger.warn({ claim }, 'Invalid claim_issue: missing issueNumber');
          break;
        }

        try {
          const { claimIssue } = await import('./initiative.js');
          const success = await claimIssue(claim.issueNumber, this.config.agentType);

          if (success) {
            logger.info({ issueNumber: claim.issueNumber }, 'Agent claimed issue');

            // Log as event
            await eventRepo.log({
              eventType: 'issue_claimed' as EventType,
              sourceAgent: this.config.agentId,
              payload: {
                issueNumber: claim.issueNumber,
                agentType: this.config.agentType,
              },
            });
          }
        } catch (claimErr) {
          logger.warn({ error: claimErr, issueNumber: claim.issueNumber }, 'Failed to claim issue');
        }
        break;
      }

      case 'complete_issue': {
        // Agent completes a GitHub issue - sets status to done or review
        const complete = actionData as {
          issueNumber?: number;
          setToReview?: boolean;
          comment?: string;
        };

        if (!complete?.issueNumber) {
          logger.warn({ complete }, 'Invalid complete_issue: missing issueNumber');
          break;
        }

        try {
          const { completeIssue } = await import('./initiative.js');
          const success = await completeIssue(
            complete.issueNumber,
            this.config.agentType,
            complete.setToReview || false,
            complete.comment
          );

          if (success) {
            logger.info({
              issueNumber: complete.issueNumber,
              setToReview: complete.setToReview,
            }, 'Agent completed issue');

            // Log as event
            await eventRepo.log({
              eventType: 'issue_completed' as EventType,
              sourceAgent: this.config.agentId,
              payload: {
                issueNumber: complete.issueNumber,
                agentType: this.config.agentType,
                setToReview: complete.setToReview,
              },
            });
          }
        } catch (completeErr) {
          logger.warn({ error: completeErr, issueNumber: complete.issueNumber }, 'Failed to complete issue');
        }
        break;
      }

      case 'propose_initiative': {
        // Agent proposes a new initiative - create GitHub issue
        // ENFORCEMENT: Block if agent has ready issues they should work on first!
        const currentKanban = await getKanbanIssuesForAgent(this.config.agentType);
        const inProgressCount = currentKanban?.inProgress?.length || 0;
        const readyCount = currentKanban?.ready?.length || 0;

        // Logic:
        // - If in-progress > 0: Should be working, not creating (but allow if also completing)
        // - If in-progress = 0 AND ready > 0: MUST claim first, BLOCK creation
        // - If in-progress = 0 AND ready = 0: OK to propose new initiatives
        if (inProgressCount === 0 && readyCount > 0) {
          logger.warn({
            agentType: this.config.agentType,
            inProgressCount,
            readyCount,
          }, 'BLOCKED: propose_initiative rejected - agent has ready issues to claim first!');

          // Log the blocked attempt
          await eventRepo.log({
            eventType: 'initiative_blocked' as EventType,
            sourceAgent: this.config.agentId,
            payload: {
              reason: `Has ${readyCount} ready issues - must claim and work before creating new`,
              attemptedTitle: (actionData as { title?: string })?.title || 'unknown',
            },
          }).catch(() => {}); // Ignore logging errors

          break; // Skip this action
        }

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

      case 'schedule_event': {
        // Agent schedules an event (post, announcement, meeting, etc.)
        const event = actionData as {
          title?: string;
          description?: string;
          eventType?: 'post' | 'ama' | 'release' | 'milestone' | 'meeting' | 'deadline' | 'other';
          scheduledAt?: string;
          platform?: 'twitter' | 'telegram' | 'discord' | 'website' | null;
          content?: string;
          projectId?: string;
        };

        if (!event?.title || !event?.scheduledAt) {
          logger.warn({ event }, 'Invalid schedule_event: missing title or scheduledAt');
          break;
        }

        try {
          const createdEvent = await projectRepo.createEvent({
            title: event.title,
            description: event.description ?? null,
            eventType: event.eventType || 'other',
            scheduledAt: new Date(event.scheduledAt),
            platform: event.platform || null,
            content: event.content ?? null,
            projectId: event.projectId ?? null,
            agent: this.config.agentType,
            createdBy: this.config.agentId,
          });

          logger.info({
            eventId: createdEvent.id,
            title: createdEvent.title,
            scheduledAt: createdEvent.scheduledAt,
            eventType: createdEvent.eventType,
            platform: createdEvent.platform,
          }, 'Agent scheduled event in calendar');

          // Log as event
          await eventRepo.log({
            eventType: 'event_scheduled' as EventType,
            sourceAgent: this.config.agentId,
            payload: {
              eventId: createdEvent.id,
              title: createdEvent.title,
              scheduledAt: createdEvent.scheduledAt,
              eventType: createdEvent.eventType,
              platform: createdEvent.platform,
            },
          });
        } catch (scheduleErr) {
          logger.warn({ error: scheduleErr, event }, 'Failed to schedule event');
        }
        break;
      }

      case 'create_project': {
        // Create a new project in the database with tracking
        const projectData = actionData as {
          title?: string;
          description?: string;
          priority?: 'critical' | 'high' | 'medium' | 'low';
          tokenBudget?: number;
          tags?: string[];
          githubIssueNumber?: number;
          githubIssueUrl?: string;
        };

        if (!projectData?.title) {
          logger.warn({ projectData }, 'Invalid create_project: missing title');
          break;
        }

        try {
          const project = await projectRepo.create({
            title: projectData.title,
            description: projectData.description || '',
            owner: this.config.agentType,
            priority: projectData.priority || 'medium',
            tokenBudget: projectData.tokenBudget || 50000,
            tags: projectData.tags || [],
            createdBy: this.config.agentId,
          });

          // Link GitHub issue if provided
          if (projectData.githubIssueNumber) {
            await projectRepo.update(project.id, {
              githubIssueNumber: projectData.githubIssueNumber,
              githubIssueUrl: projectData.githubIssueUrl,
            });
          }

          logger.info({
            projectId: project.id,
            title: project.title,
            owner: project.owner,
            priority: project.priority,
          }, 'Project created in database');

          // Log as event
          await eventRepo.log({
            eventType: 'project_created' as EventType,
            sourceAgent: this.config.agentId,
            payload: {
              projectId: project.id,
              title: project.title,
              owner: project.owner,
            },
          });
        } catch (projectErr) {
          logger.warn({ error: projectErr, projectData }, 'Failed to create project');
        }
        break;
      }

      case 'create_project_task': {
        // Create a task within a project (with story points tracking)
        const taskData = actionData as {
          projectId?: string;
          projectTitle?: string; // Alternative: find/create project by title
          title?: string;
          description?: string;
          assignee?: string;
          storyPoints?: 1 | 2 | 3 | 5 | 8;
          githubIssueNumber?: number;
          githubIssueUrl?: string;
          dependencies?: string[];
        };

        if (!taskData?.title) {
          logger.warn({ taskData }, 'Invalid create_project_task: missing title');
          break;
        }

        try {
          let projectId = taskData.projectId;

          // If no projectId but projectTitle provided, find or create project
          if (!projectId && taskData.projectTitle) {
            const existingProjects = await projectRepo.findAll();
            const existing = existingProjects.find((p: { title: string }) => p.title === taskData.projectTitle);
            if (existing) {
              projectId = existing.id;
            } else {
              // Create new project
              const newProject = await projectRepo.create({
                title: taskData.projectTitle,
                description: `Project for ${taskData.projectTitle}`,
                owner: this.config.agentType,
                priority: 'medium',
                tokenBudget: 50000,
                tags: [],
                createdBy: this.config.agentId,
              });
              projectId = newProject.id;
              logger.info({ projectId, title: taskData.projectTitle }, 'Auto-created project for task');
            }
          }

          if (!projectId) {
            logger.warn({ taskData }, 'create_project_task: no projectId or projectTitle');
            break;
          }

          const task = await projectRepo.createTask({
            projectId,
            title: taskData.title,
            description: taskData.description || '',
            assignee: taskData.assignee || this.config.agentType,
            storyPoints: taskData.storyPoints || 2,
            dependencies: taskData.dependencies || [],
          });

          logger.info({
            taskId: task.id,
            projectId,
            title: task.title,
            storyPoints: task.storyPoints,
            assignee: task.assignee,
          }, 'Project task created with story points');

          // Log as event
          await eventRepo.log({
            eventType: 'task_created' as EventType,
            sourceAgent: this.config.agentId,
            payload: {
              taskId: task.id,
              projectId,
              title: task.title,
              storyPoints: task.storyPoints,
            },
          });
        } catch (taskErr) {
          logger.warn({ error: taskErr, taskData }, 'Failed to create project task');
        }
        break;
      }

      case 'update_project_task': {
        // Update task status (todo -> in_progress -> review -> done)
        const updateData = actionData as {
          taskId?: string;
          status?: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
          tokensUsed?: number;
        };

        if (!updateData?.taskId || !updateData?.status) {
          logger.warn({ updateData }, 'Invalid update_project_task: missing taskId or status');
          break;
        }

        try {
          const task = await projectRepo.updateTaskStatus(
            updateData.taskId,
            updateData.status,
            updateData.tokensUsed
          );

          if (task) {
            logger.info({
              taskId: task.id,
              title: task.title,
              status: task.status,
              completedAt: task.completedAt,
            }, 'Project task status updated');

            // Log as event
            await eventRepo.log({
              eventType: 'task_updated' as EventType,
              sourceAgent: this.config.agentId,
              payload: {
                taskId: task.id,
                status: task.status,
                completedAt: task.completedAt,
              },
            });
          }
        } catch (updateErr) {
          logger.warn({ error: updateErr, updateData }, 'Failed to update project task');
        }
        break;
      }

      case 'spawn_subagent': {
        // Spawn a specialized sub-agent (QA, Developer, DevOps, etc.)
        const subagentData = actionData as {
          subagentType?: 'qa' | 'developer' | 'devops' | 'architect' | 'frontend' | 'security' | 'sre' | 'release';
          task?: string;
          context?: Record<string, unknown>;
          timeout?: number;
        };

        if (!subagentData?.subagentType || !subagentData?.task) {
          logger.warn({ subagentData }, 'Invalid spawn_subagent: missing subagentType or task');
          break;
        }

        try {
          // Build sub-agent profile path
          const subagentProfile = `cto-${subagentData.subagentType}`;

          // Spawn as worker with the sub-agent profile context
          const workerId = crypto.randomUUID();
          const traceId = getTraceId() || crypto.randomUUID();

          // Build enhanced task with sub-agent context
          const enhancedTask = `[SUB-AGENT: ${subagentData.subagentType.toUpperCase()}]\n\n` +
            `Profile: profiles/${subagentProfile}.md\n` +
            `Parent: ${this.config.agentType}\n\n` +
            `Task: ${subagentData.task}\n\n` +
            (subagentData.context ? `Context: ${JSON.stringify(subagentData.context, null, 2)}` : '');

          logger.info({
            subagentType: subagentData.subagentType,
            workerId,
            task: subagentData.task.substring(0, 100),
          }, 'Spawning sub-agent via worker');

          // Use spawn_worker mechanism with sub-agent context
          const result = await spawnWorker(
            this.config.agentId,
            this.config.agentType,
            enhancedTask,
            ['shell', 'filesystem', 'git'], // Sub-agents get full dev access
            subagentData.context,
            subagentData.timeout || 180000 // 3 min default
          );

          logger.info({
            subagentType: subagentData.subagentType,
            workerId,
            success: result.success,
            duration: result.duration,
          }, 'Sub-agent worker completed');

          // Log as event
          await eventRepo.log({
            eventType: 'subagent_spawned' as EventType,
            sourceAgent: this.config.agentId,
            payload: {
              subagentType: subagentData.subagentType,
              workerId,
              success: result.success,
              duration: result.duration,
            },
          });

          // Publish result to dashboard
          await publisher.publish('channel:worker:logs', JSON.stringify({
            type: 'subagent_result',
            agentType: this.config.agentType,
            subagentType: subagentData.subagentType,
            workerId,
            success: result.success,
            duration: result.duration,
            output: result.result?.substring(0, 500),
            timestamp: new Date().toISOString(),
          }));
        } catch (subagentErr) {
          logger.warn({ error: subagentErr, subagentData }, 'Failed to spawn sub-agent');
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
    sessionPool?: {
      enabled: boolean;
      totalSessions?: number;
      sessionState?: string;
    };
  }> {
    const currentState = await this.state?.getAll() || {};

    // Get session pool stats if enabled
    const sessionPoolStats = getSessionPoolStats();

    return {
      healthy: this.isRunning,
      agentType: this.config.agentType,
      status: this.isRunning ? 'active' : 'inactive',
      loopCount: (currentState[StateKeys.LOOP_COUNT] as number) || 0,
      lastLoopAt: (currentState[StateKeys.LAST_LOOP_AT] as string) || null,
      claudeAvailable: this.claudeAvailable,
      sessionPool: {
        enabled: sessionPoolStats.enabled,
        totalSessions: sessionPoolStats.stats?.totalSessions,
        sessionState: sessionPoolStats.stats?.sessionDetails?.find(
          s => s.agentType === this.config.agentType
        )?.state,
      },
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
