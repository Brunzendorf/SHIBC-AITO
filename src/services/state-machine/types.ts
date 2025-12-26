/**
 * State Machine Types (TASK-109.2)
 *
 * TypeScript definitions for deterministic agent workflows.
 * Matches PostgreSQL schema in docker/migrations/010_state_machines.sql
 */

// ============================================================================
// AGENT TYPES
// ============================================================================

export type AgentType = 'ceo' | 'cmo' | 'cto' | 'cfo' | 'coo' | 'cco' | 'dao';

// ============================================================================
// STATE DEFINITION (Template for a single state)
// ============================================================================

export interface StateDefinition {
  /** State name (e.g., 'WRITE_CODE', 'RUN_TESTS') */
  name: string;

  /** Human-readable description */
  description: string;

  /** Prompt sent to agent when entering this state */
  agentPrompt: string;

  /** Required fields in agent's response */
  requiredOutput: string[];

  /** Next state on success (null = workflow complete) */
  onSuccess: string | null;

  /** Next state on failure (same state = retry) */
  onFailure: string | null;

  /** Timeout in milliseconds */
  timeout: number;

  /** Maximum retry attempts before failing */
  maxRetries: number;

  /** Optional: Skip condition (e.g., '!context.needsSpec') */
  skipIf?: string;
}

// ============================================================================
// STATE MACHINE DEFINITION (Workflow Template)
// ============================================================================

export type TriggerType = 'manual' | 'issue_assigned' | 'scheduled' | 'event';

export interface TriggerConfig {
  /** For issue_assigned: GitHub labels that trigger this workflow */
  labels?: string[];

  /** For scheduled: Cron expression */
  cron?: string;

  /** For scheduled: Timezone */
  timezone?: string;

  /** For event: Event type to listen for */
  eventType?: string;
}

export interface StateMachineDefinition {
  /** Database ID */
  id: number;

  /** Unique type identifier (e.g., 'cto_build_project') */
  type: string;

  /** Target agent type */
  agentType: AgentType;

  /** Human-readable name */
  name: string;

  /** Description */
  description?: string;

  /** Starting state */
  initialState: string;

  /** Array of state definitions */
  states: StateDefinition[];

  /** How this workflow is triggered */
  triggerType: TriggerType;

  /** Trigger-specific configuration */
  triggerConfig?: TriggerConfig;

  /** Version number */
  version: number;

  /** Is this definition active? */
  isActive: boolean;

  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// MACHINE CONTEXT (Persistent data across states)
// ============================================================================

export interface MachineContext {
  // Project info
  projectName?: string;
  projectPath?: string;

  // GitHub
  githubIssue?: number;
  githubRepo?: string;

  // Spec
  specPath?: string;
  needsSpec?: boolean;

  // Analysis
  summary?: string;
  complexity?: 'low' | 'medium' | 'high';

  // Build
  filesCreated?: string[];
  buildSuccess?: boolean;

  // Tests
  testsPassed?: boolean;
  coverage?: number;

  // Git
  commitHash?: string;
  pushed?: boolean;

  // Deployment
  stagingUrl?: string;
  prodUrl?: string;
  deployed?: boolean;
  verified?: boolean;

  // Retry tracking
  retryCount: number;
  maxRetries: number;

  // CMO specific
  audience?: string;
  channels?: string[];
  messages?: string[];
  postIds?: string[];
  metrics?: Record<string, number>;

  // CFO specific
  balances?: Record<string, number>;
  prices?: Record<string, number>;
  totalValue?: number;
  runway?: number;
  burnRate?: number;

  // COO specific
  healthyAgents?: string[];
  staleAgents?: string[];
  stuckAgents?: string[];
  errorRates?: Record<string, number>;
  restarted?: string[];

  // Custom fields
  [key: string]: unknown;
}

// ============================================================================
// STATE MACHINE INSTANCE (Running Workflow)
// ============================================================================

export type MachineStatus =
  | 'pending'    // Created but not started
  | 'running'    // Currently executing
  | 'paused'     // Temporarily stopped
  | 'completed'  // Successfully finished
  | 'failed'     // Failed after retries
  | 'cancelled'; // Manually cancelled

export interface StateMachine {
  /** UUID */
  id: string;

  /** Reference to definition */
  definitionId: number;
  definitionType: string;

  /** Target agent */
  agentType: AgentType;
  agentId?: string;

  /** Current state */
  currentState: string;
  previousState?: string;

  /** Persistent context */
  context: MachineContext;

  /** Status */
  status: MachineStatus;

  /** Timing */
  startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;

  /** State timing */
  stateEnteredAt: Date;
  stateTimeoutAt?: Date;

  /** External references */
  githubIssue?: number;
  githubRepo?: string;

  /** Error handling */
  errorMessage?: string;
  retryCount: number;

  /** Priority (0 = highest) */
  priority: number;
}

// ============================================================================
// STATE TRANSITION (Audit Trail)
// ============================================================================

export interface StateTransition {
  /** Database ID */
  id: number;

  /** Machine reference */
  machineId: string;

  /** Transition */
  fromState: string | null;
  toState: string;

  /** Outcome */
  success: boolean;

  /** Agent's response */
  agentOutput?: Record<string, unknown>;

  /** Error info */
  errorMessage?: string;
  errorCode?: string;

  /** Timing */
  durationMs?: number;
  createdAt: Date;

  /** Retry tracking */
  attemptNumber: number;
}

// ============================================================================
// QUEUE ITEM (Pending Task)
// ============================================================================

export type QueueStatus = 'pending' | 'sent' | 'acknowledged' | 'timeout';

export interface QueueItem {
  /** Database ID */
  id: number;

  /** Machine reference */
  machineId: string;

  /** Target agent */
  agentType: AgentType;

  /** Payload to send */
  taskPayload: StateTaskMessage;

  /** Status */
  status: QueueStatus;

  /** Timing */
  createdAt: Date;
  sentAt?: Date;
  acknowledgedAt?: Date;
  timeoutAt?: Date;

  /** Retry */
  retryCount: number;
  maxRetries: number;
}

// ============================================================================
// SCHEDULED WORKFLOW
// ============================================================================

export interface ScheduledWorkflow {
  /** Database ID */
  id: number;

  /** Definition reference */
  definitionId: number;
  definitionType: string;

  /** Schedule */
  cronExpression: string;
  timezone: string;

  /** Status */
  isActive: boolean;

  /** Last execution */
  lastRunAt?: Date;
  lastMachineId?: string;
  lastStatus?: MachineStatus;

  /** Next execution */
  nextRunAt?: Date;

  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// REDIS MESSAGES
// ============================================================================

/**
 * Message sent from State Machine Service to Agent
 */
export interface StateTaskMessage {
  type: 'state_task';

  /** Machine instance ID */
  machineId: string;

  /** Current state name */
  state: string;

  /** Workflow type */
  workflowType: string;

  /** Context for the agent */
  context: MachineContext;

  /** Prompt for the agent */
  prompt: string;

  /** Required fields in response */
  requiredOutput: string[];

  /** Timeout for this state */
  timeout: number;

  /** Attempt number (for retries) */
  attemptNumber: number;
}

/**
 * Message sent from Agent to State Machine Service
 */
export interface StateAckMessage {
  type: 'state_ack';

  /** Machine instance ID */
  machineId: string;

  /** State that was completed */
  state: string;

  /** Success/failure */
  success: boolean;

  /** Agent's output (must include requiredOutput fields) */
  output: Record<string, unknown>;

  /** Error message if failed */
  error?: string;

  /** Tokens used in this state */
  tokensUsed?: number;
}

// ============================================================================
// SERVICE INTERFACES
// ============================================================================

/**
 * Options for creating a new state machine
 */
export interface CreateMachineOptions {
  /** Workflow type (e.g., 'cto_build_project') */
  definitionType: string;

  /** Initial context */
  context?: Partial<MachineContext>;

  /** GitHub issue number */
  githubIssue?: number;

  /** GitHub repo */
  githubRepo?: string;

  /** Priority (0-100, lower = higher priority) */
  priority?: number;
}

/**
 * Options for transitioning to next state
 */
export interface TransitionOptions {
  /** Machine ID */
  machineId: string;

  /** Was the state successful? */
  success: boolean;

  /** Agent's output */
  output?: Record<string, unknown>;

  /** Error message if failed */
  error?: string;

  /** Duration in milliseconds */
  durationMs?: number;
}

/**
 * Query options for listing machines
 */
export interface ListMachinesOptions {
  /** Filter by agent type */
  agentType?: AgentType;

  /** Filter by status */
  status?: MachineStatus | MachineStatus[];

  /** Filter by definition type */
  definitionType?: string;

  /** Filter by GitHub issue */
  githubIssue?: number;

  /** Limit results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;
}

/**
 * Statistics for dashboard
 */
export interface MachineStats {
  /** Counts by status */
  byStatus: Record<MachineStatus, number>;

  /** Counts by agent */
  byAgent: Record<AgentType, number>;

  /** Counts by workflow type */
  byType: Record<string, number>;

  /** Average duration by workflow type */
  avgDuration: Record<string, number>;

  /** Success rate by workflow type */
  successRate: Record<string, number>;
}

// ============================================================================
// EVENT TYPES (for internal event bus)
// ============================================================================

export type StateMachineEvent =
  | { type: 'machine_created'; machine: StateMachine }
  | { type: 'state_entered'; machine: StateMachine; state: string }
  | { type: 'state_completed'; machine: StateMachine; transition: StateTransition }
  | { type: 'machine_completed'; machine: StateMachine }
  | { type: 'machine_failed'; machine: StateMachine; error: string }
  | { type: 'machine_timeout'; machine: StateMachine; state: string }
  | { type: 'task_sent'; queueItem: QueueItem }
  | { type: 'task_acknowledged'; queueItem: QueueItem };

// ============================================================================
// DATABASE ROW TYPES (for pg queries)
// ============================================================================

export interface StateMachineDefinitionRow {
  id: number;
  type: string;
  agent_type: string;
  name: string;
  description: string | null;
  initial_state: string;
  states: StateDefinition[];
  trigger_type: string;
  trigger_config: TriggerConfig | null;
  version: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface StateMachineRow {
  id: string;
  definition_id: number;
  definition_type: string;
  agent_type: string;
  agent_id: string | null;
  current_state: string;
  previous_state: string | null;
  context: MachineContext;
  status: string;
  started_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  state_entered_at: Date;
  state_timeout_at: Date | null;
  github_issue: number | null;
  github_repo: string | null;
  error_message: string | null;
  retry_count: number;
  priority: number;
}

export interface StateTransitionRow {
  id: number;
  machine_id: string;
  from_state: string | null;
  to_state: string;
  success: boolean;
  agent_output: Record<string, unknown> | null;
  error_message: string | null;
  error_code: string | null;
  duration_ms: number | null;
  created_at: Date;
  attempt_number: number;
}

export interface QueueItemRow {
  id: number;
  machine_id: string;
  agent_type: string;
  task_payload: StateTaskMessage;
  status: string;
  created_at: Date;
  sent_at: Date | null;
  acknowledged_at: Date | null;
  timeout_at: Date | null;
  retry_count: number;
  max_retries: number;
}

export interface ScheduledWorkflowRow {
  id: number;
  definition_id: number;
  definition_type: string;
  cron_expression: string;
  timezone: string;
  is_active: boolean;
  last_run_at: Date | null;
  last_machine_id: string | null;
  last_status: string | null;
  next_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
