/**
 * Agent Daemon
 * Lightweight 24/7 process that triggers AI only when needed
 */

import cron from 'node-cron';
import { createLogger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import {
  redis,
  subscriber,
  publisher,
  channels,
  keys,
  setAgentStatus,
} from '../lib/redis.js';
import { agentRepo, historyRepo, eventRepo } from '../lib/db.js';
import { loadProfile, generateSystemPrompt, type AgentProfile } from './profile.js';
import { createStateManager, StateKeys, type StateManager } from './state.js';
import {
  executeClaudeCode,
  executeOllamaFallback,
  isClaudeAvailable,
  buildLoopPrompt,
  parseClaudeOutput,
} from './claude.js';
import type { AgentType, AgentMessage, EventType } from '../lib/types.js';

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

    } catch (error) {
      logger.error({ error }, 'Failed to start daemon');
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

      // Update status
      await this.updateStatus('inactive');

      // Log event
      await this.logEvent('agent_stopped', { reason: 'graceful_shutdown' });

      this.isRunning = false;
      logger.info('Agent daemon stopped');

    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
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
    const aiRequired: AgentMessage['type'][] = ['task', 'decision', 'alert'];
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
        logger.error({ error }, 'Scheduled loop failed');
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

    const loopStart = Date.now();
    logger.info({ trigger }, 'Running agent loop');

    try {
      // Increment loop counter
      const loopCount = (await this.state.get<number>(StateKeys.LOOP_COUNT)) || 0;
      await this.state.set(StateKeys.LOOP_COUNT, loopCount + 1);

      // Get current state
      const currentState = await this.state.getAll();

      // Build prompt
      const systemPrompt = generateSystemPrompt(this.profile);
      const loopPrompt = buildLoopPrompt(this.profile, currentState, { type: trigger, data });

      // Execute AI
      let result;
      if (this.claudeAvailable) {
        result = await executeClaudeCode({
          prompt: loopPrompt,
          systemPrompt,
          timeout: 120000, // 2 minutes
        });
      } else {
        logger.warn('Claude unavailable, using Ollama fallback');
        result = await executeOllamaFallback(systemPrompt + '\n\n' + loopPrompt);
      }

      if (result.success) {
        // Parse and process result
        const parsed = parseClaudeOutput(result.output);

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
        }

        // Update success count
        const successCount = (await this.state.get<number>(StateKeys.SUCCESS_COUNT)) || 0;
        await this.state.set(StateKeys.SUCCESS_COUNT, successCount + 1);

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

    } catch (error) {
      logger.error({ error, trigger }, 'Loop execution error');

      // Update error count
      const errorCount = (await this.state?.get<number>(StateKeys.ERROR_COUNT)) || 0;
      await this.state?.set(StateKeys.ERROR_COUNT, errorCount + 1);
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

    switch (action.type) {
      case 'create_task':
        // TODO: Implement task creation
        break;

      case 'propose_decision':
        // TODO: Implement decision proposal
        break;

      case 'alert':
        // TODO: Implement alert sending
        break;

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
