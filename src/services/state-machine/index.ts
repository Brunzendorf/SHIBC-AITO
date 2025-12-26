/**
 * State Machine Service (TASK-109.3)
 *
 * Manages deterministic agent workflows with:
 * - State machine lifecycle (create, transition, complete)
 * - Redis pub/sub integration for agent communication
 * - Timeout handling and auto-retry
 * - Audit trail of all transitions
 */

import { Pool } from 'pg';
import Redis from 'ioredis';
import { EventEmitter } from 'events';
import {
  AgentType,
  StateMachine,
  StateMachineDefinition,
  StateTransition,
  MachineContext,
  MachineStatus,
  StateTaskMessage,
  StateAckMessage,
  CreateMachineOptions,
  ListMachinesOptions,
  MachineStats,
  StateMachineEvent,
  StateMachineDefinitionRow,
  StateMachineRow,
  StateTransitionRow,
} from './types';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface StateMachineServiceConfig {
  /** PostgreSQL connection pool */
  pool: Pool;

  /** Redis client for pub/sub */
  redis: Redis;

  /** Redis subscriber client */
  redisSub: Redis;

  /** Check for timeouts every N ms (default: 30000) */
  timeoutCheckInterval?: number;

  /** Check for scheduled workflows every N ms (default: 60000) */
  schedulerInterval?: number;

  /** Logger instance */
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

// ============================================================================
// STATE MACHINE SERVICE
// ============================================================================

export class StateMachineService extends EventEmitter {
  private pool: Pool;
  private redis: Redis;
  private redisSub: Redis;
  private logger: StateMachineServiceConfig['logger'];

  private timeoutCheckInterval: number;
  private schedulerInterval: number;

  private timeoutTimer?: NodeJS.Timeout;
  private schedulerTimer?: NodeJS.Timeout;

  private definitionCache: Map<string, StateMachineDefinition> = new Map();
  private isRunning = false;

  constructor(config: StateMachineServiceConfig) {
    super();

    this.pool = config.pool;
    this.redis = config.redis;
    this.redisSub = config.redisSub;
    this.logger = config.logger || console;

    this.timeoutCheckInterval = config.timeoutCheckInterval || 30000;
    this.schedulerInterval = config.schedulerInterval || 60000;
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Start the service (subscribe to Redis, start timers)
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.logger?.info('Starting State Machine Service');

    // Subscribe to agent acknowledgments
    await this.redisSub.subscribe('channel:state:ack');
    this.redisSub.on('message', this.handleRedisMessage.bind(this));

    // Start timeout checker
    this.timeoutTimer = setInterval(
      () => this.checkTimeouts(),
      this.timeoutCheckInterval
    );

    // Start scheduler
    this.schedulerTimer = setInterval(
      () => this.checkScheduledWorkflows(),
      this.schedulerInterval
    );

    // Load definition cache
    await this.loadDefinitions();

    this.isRunning = true;
    this.logger?.info('State Machine Service started');
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.logger?.info('Stopping State Machine Service');

    // Unsubscribe from Redis
    await this.redisSub.unsubscribe('channel:state:ack');

    // Clear timers
    if (this.timeoutTimer) clearInterval(this.timeoutTimer);
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);

    this.isRunning = false;
    this.logger?.info('State Machine Service stopped');
  }

  // ==========================================================================
  // DEFINITION MANAGEMENT
  // ==========================================================================

  /**
   * Load all active definitions into cache
   */
  async loadDefinitions(): Promise<void> {
    const result = await this.pool.query<StateMachineDefinitionRow>(
      `SELECT * FROM state_machine_definitions WHERE is_active = true`
    );

    this.definitionCache.clear();
    for (const row of result.rows) {
      this.definitionCache.set(row.type, this.rowToDefinition(row));
    }

    this.logger?.info('Loaded workflow definitions', {
      count: this.definitionCache.size,
    });
  }

  /**
   * Get a definition by type
   */
  async getDefinition(type: string): Promise<StateMachineDefinition | null> {
    // Check cache first
    if (this.definitionCache.has(type)) {
      return this.definitionCache.get(type)!;
    }

    // Load from DB
    const result = await this.pool.query<StateMachineDefinitionRow>(
      `SELECT * FROM state_machine_definitions WHERE type = $1 AND is_active = true`,
      [type]
    );

    if (result.rows.length === 0) return null;

    const definition = this.rowToDefinition(result.rows[0]);
    this.definitionCache.set(type, definition);
    return definition;
  }

  /**
   * Get definitions for an agent type
   */
  async getDefinitionsForAgent(agentType: AgentType): Promise<StateMachineDefinition[]> {
    const result = await this.pool.query<StateMachineDefinitionRow>(
      `SELECT * FROM state_machine_definitions WHERE agent_type = $1 AND is_active = true`,
      [agentType]
    );

    return result.rows.map((row) => this.rowToDefinition(row));
  }

  // ==========================================================================
  // MACHINE LIFECYCLE
  // ==========================================================================

  /**
   * Create a new state machine instance
   */
  async createMachine(options: CreateMachineOptions): Promise<StateMachine> {
    const definition = await this.getDefinition(options.definitionType);
    if (!definition) {
      throw new Error(`Unknown workflow type: ${options.definitionType}`);
    }

    const initialState = definition.states.find(
      (s) => s.name === definition.initialState
    );
    if (!initialState) {
      throw new Error(`Initial state not found: ${definition.initialState}`);
    }

    // Calculate timeout
    const timeoutAt = new Date(Date.now() + initialState.timeout);

    // Create context with defaults
    const context: MachineContext = {
      retryCount: 0,
      maxRetries: initialState.maxRetries,
      ...options.context,
    };

    const result = await this.pool.query<StateMachineRow>(
      `INSERT INTO state_machines (
        definition_id, definition_type, agent_type,
        current_state, context, status,
        github_issue, github_repo, priority,
        state_timeout_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        definition.id,
        definition.type,
        definition.agentType,
        definition.initialState,
        JSON.stringify(context),
        'pending',
        options.githubIssue || null,
        options.githubRepo || null,
        options.priority ?? 50,
        timeoutAt,
      ]
    );

    const machine = this.rowToMachine(result.rows[0]);

    // Log initial transition
    await this.logTransition(machine.id, null, machine.currentState, true);

    // Emit event
    this.emitEvent({ type: 'machine_created', machine });

    this.logger?.info('Created state machine', {
      id: machine.id,
      type: machine.definitionType,
      agent: machine.agentType,
    });

    return machine;
  }

  /**
   * Start a pending machine (send first task to agent)
   */
  async startMachine(machineId: string): Promise<void> {
    const machine = await this.getMachine(machineId);
    if (!machine) {
      throw new Error(`Machine not found: ${machineId}`);
    }

    if (machine.status !== 'pending') {
      throw new Error(`Machine is not pending: ${machine.status}`);
    }

    // Update status to running
    await this.pool.query(
      `UPDATE state_machines SET status = 'running', started_at = NOW() WHERE id = $1`,
      [machineId]
    );

    // Send task to agent
    await this.sendTaskToAgent(machine);
  }

  /**
   * Get a machine by ID
   */
  async getMachine(id: string): Promise<StateMachine | null> {
    const result = await this.pool.query<StateMachineRow>(
      `SELECT * FROM state_machines WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;
    return this.rowToMachine(result.rows[0]);
  }

  /**
   * List machines with filters
   */
  async listMachines(options: ListMachinesOptions = {}): Promise<StateMachine[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.agentType) {
      conditions.push(`agent_type = $${paramIndex++}`);
      params.push(options.agentType);
    }

    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      conditions.push(`status = ANY($${paramIndex++})`);
      params.push(statuses);
    }

    if (options.definitionType) {
      conditions.push(`definition_type = $${paramIndex++}`);
      params.push(options.definitionType);
    }

    if (options.githubIssue) {
      conditions.push(`github_issue = $${paramIndex++}`);
      params.push(options.githubIssue);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const result = await this.pool.query<StateMachineRow>(
      `SELECT * FROM state_machines ${whereClause}
       ORDER BY priority, started_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return result.rows.map((row) => this.rowToMachine(row));
  }

  /**
   * Get active machines for an agent
   */
  async getActiveMachinesForAgent(agentType: AgentType): Promise<StateMachine[]> {
    return this.listMachines({
      agentType,
      status: ['pending', 'running', 'paused'],
    });
  }

  // ==========================================================================
  // STATE TRANSITIONS
  // ==========================================================================

  /**
   * Handle acknowledgment from agent
   */
  async handleAck(ack: StateAckMessage): Promise<void> {
    const machine = await this.getMachine(ack.machineId);
    if (!machine) {
      this.logger?.warn('Ack for unknown machine', { machineId: ack.machineId });
      return;
    }

    if (machine.currentState !== ack.state) {
      this.logger?.warn('Ack for wrong state', {
        machineId: ack.machineId,
        expected: machine.currentState,
        got: ack.state,
      });
      return;
    }

    // Get current state definition
    const definition = await this.getDefinition(machine.definitionType);
    if (!definition) return;

    const currentState = definition.states.find((s) => s.name === machine.currentState);
    if (!currentState) return;

    // Determine next state
    const nextStateName = ack.success ? currentState.onSuccess : currentState.onFailure;

    // Merge output into context
    const newContext: MachineContext = {
      ...machine.context,
      ...ack.output,
    };

    if (ack.success) {
      // Successful transition
      await this.transitionTo(machine, nextStateName, newContext, true, ack.output);
    } else {
      // Failed - check retry count
      const retryCount = (machine.context.retryCount || 0) + 1;
      newContext.retryCount = retryCount;

      if (retryCount >= currentState.maxRetries) {
        // Max retries exceeded - fail the machine
        await this.failMachine(machine.id, ack.error || 'Max retries exceeded');
      } else {
        // Retry - stay in same state or go to failure state
        await this.transitionTo(machine, nextStateName, newContext, false, ack.output, ack.error);
      }
    }
  }

  /**
   * Transition machine to a new state
   */
  private async transitionTo(
    machine: StateMachine,
    nextStateName: string | null,
    context: MachineContext,
    success: boolean,
    output?: Record<string, unknown>,
    error?: string
  ): Promise<void> {
    const startTime = machine.stateEnteredAt.getTime();
    const durationMs = Date.now() - startTime;

    // Log the transition
    await this.logTransition(
      machine.id,
      machine.currentState,
      nextStateName || 'COMPLETE',
      success,
      output,
      error,
      durationMs
    );

    if (!nextStateName) {
      // Workflow complete
      await this.completeMachine(machine.id, context);
      return;
    }

    // Get next state definition
    const definition = await this.getDefinition(machine.definitionType);
    if (!definition) return;

    const nextState = definition.states.find((s) => s.name === nextStateName);
    if (!nextState) {
      this.logger?.error('Next state not found', { state: nextStateName });
      await this.failMachine(machine.id, `State not found: ${nextStateName}`);
      return;
    }

    // Check skipIf condition
    if (nextState.skipIf) {
      const shouldSkip = this.evaluateCondition(nextState.skipIf, context);
      if (shouldSkip) {
        this.logger?.info('Skipping state', { state: nextStateName, condition: nextState.skipIf });
        // Skip to next state
        await this.transitionTo(
          { ...machine, currentState: nextStateName, context },
          nextState.onSuccess,
          context,
          true
        );
        return;
      }
    }

    // Calculate timeout
    const timeoutAt = new Date(Date.now() + nextState.timeout);

    // Reset retry count for new state
    context.retryCount = 0;
    context.maxRetries = nextState.maxRetries;

    // Update machine
    await this.pool.query(
      `UPDATE state_machines SET
        current_state = $1,
        previous_state = $2,
        context = $3,
        state_entered_at = NOW(),
        state_timeout_at = $4,
        retry_count = 0,
        updated_at = NOW()
      WHERE id = $5`,
      [nextStateName, machine.currentState, JSON.stringify(context), timeoutAt, machine.id]
    );

    // Get updated machine
    const updatedMachine = await this.getMachine(machine.id);
    if (!updatedMachine) return;

    // Emit event
    this.emitEvent({ type: 'state_entered', machine: updatedMachine, state: nextStateName });

    // Send next task to agent
    await this.sendTaskToAgent(updatedMachine);
  }

  /**
   * Complete a machine successfully
   */
  private async completeMachine(machineId: string, context: MachineContext): Promise<void> {
    await this.pool.query(
      `UPDATE state_machines SET
        status = 'completed',
        context = $1,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $2`,
      [JSON.stringify(context), machineId]
    );

    const machine = await this.getMachine(machineId);
    if (machine) {
      this.emitEvent({ type: 'machine_completed', machine });
      this.logger?.info('Machine completed', { id: machineId, type: machine.definitionType });
    }
  }

  /**
   * Fail a machine
   */
  async failMachine(machineId: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE state_machines SET
        status = 'failed',
        error_message = $1,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $2`,
      [error, machineId]
    );

    const machine = await this.getMachine(machineId);
    if (machine) {
      this.emitEvent({ type: 'machine_failed', machine, error });
      this.logger?.error('Machine failed', { id: machineId, error });
    }
  }

  /**
   * Pause a machine
   */
  async pauseMachine(machineId: string): Promise<void> {
    await this.pool.query(
      `UPDATE state_machines SET status = 'paused', updated_at = NOW() WHERE id = $1`,
      [machineId]
    );
  }

  /**
   * Resume a paused machine
   */
  async resumeMachine(machineId: string): Promise<void> {
    const machine = await this.getMachine(machineId);
    if (!machine || machine.status !== 'paused') return;

    await this.pool.query(
      `UPDATE state_machines SET status = 'running', updated_at = NOW() WHERE id = $1`,
      [machineId]
    );

    await this.sendTaskToAgent(machine);
  }

  /**
   * Cancel a machine
   */
  async cancelMachine(machineId: string): Promise<void> {
    await this.pool.query(
      `UPDATE state_machines SET status = 'cancelled', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [machineId]
    );
  }

  // ==========================================================================
  // AGENT COMMUNICATION
  // ==========================================================================

  /**
   * Send task to agent via Redis
   */
  private async sendTaskToAgent(machine: StateMachine): Promise<void> {
    const definition = await this.getDefinition(machine.definitionType);
    if (!definition) return;

    const stateDefinition = definition.states.find((s) => s.name === machine.currentState);
    if (!stateDefinition) return;

    // Interpolate prompt with context
    const prompt = this.interpolatePrompt(stateDefinition.agentPrompt, machine.context);

    const message: StateTaskMessage = {
      type: 'state_task',
      machineId: machine.id,
      state: machine.currentState,
      workflowType: machine.definitionType,
      context: machine.context,
      prompt,
      requiredOutput: stateDefinition.requiredOutput,
      timeout: stateDefinition.timeout,
      attemptNumber: (machine.context.retryCount || 0) + 1,
    };

    // Get agent channel (need to look up agent UUID)
    const agentChannel = await this.getAgentChannel(machine.agentType);
    if (!agentChannel) {
      this.logger?.error('No agent channel found', { agentType: machine.agentType });
      return;
    }

    // Publish to agent channel
    await this.redis.publish(agentChannel, JSON.stringify(message));

    // Add to queue for tracking
    await this.pool.query(
      `INSERT INTO state_machine_queue (machine_id, agent_type, task_payload, status, sent_at, timeout_at)
       VALUES ($1, $2, $3, 'sent', NOW(), $4)`,
      [
        machine.id,
        machine.agentType,
        JSON.stringify(message),
        new Date(Date.now() + stateDefinition.timeout),
      ]
    );

    this.logger?.info('Sent task to agent', {
      machineId: machine.id,
      state: machine.currentState,
      agent: machine.agentType,
    });
  }

  /**
   * Get Redis channel for an agent type
   */
  private async getAgentChannel(agentType: AgentType): Promise<string | null> {
    // Look up agent UUID from database
    const result = await this.pool.query(
      `SELECT id FROM agents WHERE type = $1 AND is_active = true LIMIT 1`,
      [agentType]
    );

    if (result.rows.length === 0) {
      // Fallback: use broadcast channel
      return 'channel:broadcast';
    }

    return `channel:agent:${result.rows[0].id}`;
  }

  /**
   * Handle incoming Redis messages
   */
  private async handleRedisMessage(channel: string, message: string): Promise<void> {
    if (channel !== 'channel:state:ack') return;

    try {
      const ack = JSON.parse(message) as StateAckMessage;
      if (ack.type !== 'state_ack') return;

      await this.handleAck(ack);
    } catch (error) {
      this.logger?.error('Failed to handle Redis message', { error, message });
    }
  }

  // ==========================================================================
  // TIMEOUT HANDLING
  // ==========================================================================

  /**
   * Check for timed out machines
   */
  private async checkTimeouts(): Promise<void> {
    const result = await this.pool.query<StateMachineRow>(
      `SELECT * FROM state_machines
       WHERE status = 'running'
       AND state_timeout_at < NOW()`
    );

    for (const row of result.rows) {
      const machine = this.rowToMachine(row);
      await this.handleTimeout(machine);
    }
  }

  /**
   * Handle a timed out machine
   */
  private async handleTimeout(machine: StateMachine): Promise<void> {
    this.logger?.warn('Machine state timed out', {
      id: machine.id,
      state: machine.currentState,
    });

    this.emitEvent({ type: 'machine_timeout', machine, state: machine.currentState });

    // Get state definition for retry logic
    const definition = await this.getDefinition(machine.definitionType);
    if (!definition) {
      await this.failMachine(machine.id, 'Timeout: definition not found');
      return;
    }

    const stateDefinition = definition.states.find((s) => s.name === machine.currentState);
    if (!stateDefinition) {
      await this.failMachine(machine.id, 'Timeout: state not found');
      return;
    }

    // Increment retry count
    const retryCount = (machine.context.retryCount || 0) + 1;

    if (retryCount >= stateDefinition.maxRetries) {
      // Max retries - fail
      await this.failMachine(machine.id, `Timeout after ${retryCount} attempts`);
    } else {
      // Retry - update context and resend
      const newContext = { ...machine.context, retryCount };
      const timeoutAt = new Date(Date.now() + stateDefinition.timeout);

      await this.pool.query(
        `UPDATE state_machines SET
          context = $1,
          state_entered_at = NOW(),
          state_timeout_at = $2,
          retry_count = $3,
          updated_at = NOW()
        WHERE id = $4`,
        [JSON.stringify(newContext), timeoutAt, retryCount, machine.id]
      );

      // Resend task
      const updatedMachine = await this.getMachine(machine.id);
      if (updatedMachine) {
        await this.sendTaskToAgent(updatedMachine);
      }
    }
  }

  // ==========================================================================
  // SCHEDULED WORKFLOWS
  // ==========================================================================

  /**
   * Check for scheduled workflows that need to run
   */
  private async checkScheduledWorkflows(): Promise<void> {
    const result = await this.pool.query(
      `SELECT sw.*, smd.type as definition_type
       FROM scheduled_workflows sw
       JOIN state_machine_definitions smd ON sw.definition_id = smd.id
       WHERE sw.is_active = true
       AND sw.next_run_at <= NOW()`
    );

    for (const row of result.rows) {
      await this.runScheduledWorkflow(row);
    }
  }

  /**
   * Run a scheduled workflow
   */
  private async runScheduledWorkflow(schedule: {
    id: number;
    definition_type: string;
    cron_expression: string;
  }): Promise<void> {
    try {
      // Create new machine
      const machine = await this.createMachine({
        definitionType: schedule.definition_type,
      });

      // Start it
      await this.startMachine(machine.id);

      // Update schedule
      const nextRun = this.calculateNextRun(schedule.cron_expression);
      await this.pool.query(
        `UPDATE scheduled_workflows SET
          last_run_at = NOW(),
          last_machine_id = $1,
          next_run_at = $2,
          updated_at = NOW()
        WHERE id = $3`,
        [machine.id, nextRun, schedule.id]
      );

      this.logger?.info('Started scheduled workflow', {
        scheduleId: schedule.id,
        machineId: machine.id,
        type: schedule.definition_type,
      });
    } catch (error) {
      this.logger?.error('Failed to run scheduled workflow', {
        scheduleId: schedule.id,
        error,
      });
    }
  }

  /**
   * Calculate next run time from cron expression
   * Simple implementation - for production use a proper cron parser
   */
  private calculateNextRun(cronExpression: string): Date {
    // For now, just add 1 hour for hourly, 1 day for daily
    const parts = cronExpression.split(' ');
    if (parts[1] === '*') {
      // Hourly
      return new Date(Date.now() + 60 * 60 * 1000);
    }
    // Daily
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Get machine statistics
   */
  async getStats(): Promise<MachineStats> {
    const [byStatus, byAgent, byType, avgDuration, successRate] = await Promise.all([
      this.pool.query(`SELECT status, COUNT(*) as count FROM state_machines GROUP BY status`),
      this.pool.query(`SELECT agent_type, COUNT(*) as count FROM state_machines GROUP BY agent_type`),
      this.pool.query(`SELECT definition_type, COUNT(*) as count FROM state_machines GROUP BY definition_type`),
      this.pool.query(`
        SELECT definition_type, AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as avg_ms
        FROM state_machines
        WHERE completed_at IS NOT NULL
        GROUP BY definition_type
      `),
      this.pool.query(`
        SELECT definition_type,
          COUNT(*) FILTER (WHERE status = 'completed') * 100.0 / COUNT(*) as rate
        FROM state_machines
        WHERE status IN ('completed', 'failed')
        GROUP BY definition_type
      `),
    ]);

    return {
      byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, parseInt(r.count)])) as Record<MachineStatus, number>,
      byAgent: Object.fromEntries(byAgent.rows.map((r) => [r.agent_type, parseInt(r.count)])) as Record<AgentType, number>,
      byType: Object.fromEntries(byType.rows.map((r) => [r.definition_type, parseInt(r.count)])),
      avgDuration: Object.fromEntries(avgDuration.rows.map((r) => [r.definition_type, parseFloat(r.avg_ms) || 0])),
      successRate: Object.fromEntries(successRate.rows.map((r) => [r.definition_type, parseFloat(r.rate) || 0])),
    };
  }

  /**
   * Get transition history for a machine
   */
  async getTransitions(machineId: string): Promise<StateTransition[]> {
    const result = await this.pool.query<StateTransitionRow>(
      `SELECT * FROM state_transitions WHERE machine_id = $1 ORDER BY created_at`,
      [machineId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      machineId: row.machine_id,
      fromState: row.from_state,
      toState: row.to_state,
      success: row.success,
      agentOutput: row.agent_output || undefined,
      errorMessage: row.error_message || undefined,
      errorCode: row.error_code || undefined,
      durationMs: row.duration_ms || undefined,
      createdAt: row.created_at,
      attemptNumber: row.attempt_number,
    }));
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Log a state transition
   */
  private async logTransition(
    machineId: string,
    fromState: string | null,
    toState: string,
    success: boolean,
    output?: Record<string, unknown>,
    error?: string,
    durationMs?: number
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO state_transitions (machine_id, from_state, to_state, success, agent_output, error_message, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [machineId, fromState, toState, success, output ? JSON.stringify(output) : null, error, durationMs]
    );
  }

  /**
   * Interpolate placeholders in prompt
   */
  private interpolatePrompt(template: string, context: MachineContext): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      const value = context[key];
      if (value === undefined) return match;
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
  }

  /**
   * Evaluate a skip condition
   */
  private evaluateCondition(condition: string, context: MachineContext): boolean {
    try {
      // Simple evaluation - only supports !context.field
      if (condition.startsWith('!context.')) {
        const field = condition.slice(9);
        return !context[field];
      }
      if (condition.startsWith('context.')) {
        const field = condition.slice(8);
        return !!context[field];
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Emit a typed event
   */
  private emitEvent(event: StateMachineEvent): void {
    this.emit(event.type, event);
    this.emit('event', event);
  }

  /**
   * Convert database row to StateMachineDefinition
   */
  private rowToDefinition(row: StateMachineDefinitionRow): StateMachineDefinition {
    return {
      id: row.id,
      type: row.type,
      agentType: row.agent_type as AgentType,
      name: row.name,
      description: row.description || undefined,
      initialState: row.initial_state,
      states: row.states,
      triggerType: row.trigger_type as StateMachineDefinition['triggerType'],
      triggerConfig: row.trigger_config || undefined,
      version: row.version,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Convert database row to StateMachine
   */
  private rowToMachine(row: StateMachineRow): StateMachine {
    return {
      id: row.id,
      definitionId: row.definition_id,
      definitionType: row.definition_type,
      agentType: row.agent_type as AgentType,
      agentId: row.agent_id || undefined,
      currentState: row.current_state,
      previousState: row.previous_state || undefined,
      context: row.context,
      status: row.status as MachineStatus,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined,
      stateEnteredAt: row.state_entered_at,
      stateTimeoutAt: row.state_timeout_at || undefined,
      githubIssue: row.github_issue || undefined,
      githubRepo: row.github_repo || undefined,
      errorMessage: row.error_message || undefined,
      retryCount: row.retry_count,
      priority: row.priority,
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new StateMachineService instance
 */
export function createStateMachineService(
  config: StateMachineServiceConfig
): StateMachineService {
  return new StateMachineService(config);
}

export default StateMachineService;
