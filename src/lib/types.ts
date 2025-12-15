// Agent Types
export type AgentType = 'ceo' | 'dao' | 'cmo' | 'cto' | 'cfo' | 'coo' | 'cco';
export type AgentStatus = 'inactive' | 'starting' | 'active' | 'stopping' | 'error';
export type AgentTier = 'head' | 'clevel' | 'worker';

export interface Agent {
  id: string;
  type: AgentType;
  name: string;
  profilePath: string;
  loopInterval: number; // seconds
  gitRepo?: string;
  gitFilter?: string;
  status: AgentStatus;
  containerId?: string;
  lastHeartbeat?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Agent State
export interface AgentState {
  id: string;
  agentId: string;
  stateKey: string;
  stateValue: unknown;
  createdAt: Date;
  updatedAt: Date;
}

// Agent History (for RAG)
export type ActionType = 'decision' | 'task' | 'communication' | 'error' | 'idea';

export interface AgentHistory {
  id: string;
  agentId: string;
  actionType: ActionType;
  summary: string;
  details: unknown;
  embedding?: number[];
  createdAt: Date;
}

// Decisions & Veto
export type DecisionType = 'operational' | 'minor' | 'major' | 'critical';
export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'vetoed' | 'escalated';
export type VoteValue = 'approve' | 'veto' | 'abstain';

// Approval Requirements per Tier
export interface ApprovalRequirements {
  ceoRequired: boolean;
  daoRequired: boolean;
  humanRequired: boolean;
  timeoutMs: number;
  autoApproveOnTimeout: boolean; // true for minor (auto-approve), false for major/critical (escalate)
}

export const APPROVAL_REQUIREMENTS: Record<DecisionType, ApprovalRequirements> = {
  operational: {
    ceoRequired: false,
    daoRequired: false,
    humanRequired: false,
    timeoutMs: 0,
    autoApproveOnTimeout: true,
  },
  minor: {
    ceoRequired: true,
    daoRequired: false,
    humanRequired: false,
    timeoutMs: 4 * 60 * 60 * 1000, // 4 hours
    autoApproveOnTimeout: true, // CEO can only veto, otherwise auto-approve
  },
  major: {
    ceoRequired: true,
    daoRequired: true,
    humanRequired: false,
    timeoutMs: 24 * 60 * 60 * 1000, // 24 hours
    autoApproveOnTimeout: false, // Escalate to human on timeout
  },
  critical: {
    ceoRequired: true,
    daoRequired: true,
    humanRequired: true,
    timeoutMs: 48 * 60 * 60 * 1000, // 48 hours
    autoApproveOnTimeout: false, // Escalate to human on timeout
  },
};

export interface Decision {
  id: string;
  title: string;
  description?: string;
  proposedBy: string;
  decisionType: DecisionType;
  status: DecisionStatus;
  vetoRound: number;
  ceoVote?: VoteValue;
  daoVote?: VoteValue;
  cLevelVotes?: Record<AgentType, VoteValue>;
  humanDecision?: VoteValue;
  resolvedAt?: Date;
  createdAt: Date;
}

// Tasks
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 1 | 2 | 3 | 4 | 5; // 1 = highest

export interface Task {
  id: string;
  title: string;
  description?: string;
  assignedTo: string;
  createdBy: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: Date;
  completedAt?: Date;
  result?: unknown;
  createdAt: Date;
}

// Events
export type EventType =
  | 'agent_started'
  | 'agent_stopped'
  | 'agent_error'
  | 'task_created'
  | 'task_completed'
  | 'decision_proposed'
  | 'decision_voted'
  | 'decision_resolved'
  | 'escalation_created'
  | 'escalation_resolved'
  | 'status_request'
  | 'status_response'
  | 'broadcast'
  | 'human_message'
  | 'initiative_created';

export interface Event {
  id: string;
  eventType: EventType;
  sourceAgent?: string;
  targetAgent?: string;
  payload: unknown;
  correlationId?: string; // Links related events in a chain
  createdAt: Date;
}

// Messages (Inter-Agent Communication)
export type MessageType =
  | 'task'
  | 'task_queued'          // Notification that a task was added to queue (wake-up signal)
  | 'status_request'
  | 'status_response'
  | 'decision'
  | 'vote'
  | 'alert'
  | 'broadcast'
  | 'direct'
  | 'worker_result'        // Result from MCP worker execution
  | 'pr_approved_by_rag'   // PR passed RAG quality check, needs CEO approval
  | 'pr_rejected'          // PR failed RAG quality check
  | 'pr_review_requested'; // Agent requests RAG to review PR

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent' | 'critical';

export interface AgentMessage {
  id: string;
  type: MessageType;
  from: string;
  to: string | 'all' | 'head' | 'clevel';
  payload: unknown;
  priority: MessagePriority;
  timestamp: Date;
  requiresResponse: boolean;
  responseDeadline?: Date;
  correlationId?: string; // Links related events in a chain (e.g., decision -> vote -> result)
}

// Escalations
export type EscalationStatus = 'pending' | 'responded' | 'timeout';
export type EscalationChannel = 'telegram' | 'email' | 'dashboard';

export interface Escalation {
  id: string;
  decisionId: string;
  reason: string;
  channelsNotified: EscalationChannel[];
  humanResponse?: string;
  respondedAt?: Date;
  status: EscalationStatus;
  createdAt: Date;
}

// Container Config
export interface ContainerConfig {
  image: string;
  name: string;
  environment: Record<string, string>;
  volumes?: string[];
  ports?: string[];
  memory?: string;
  cpus?: string;
  restart?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
}

// Health Check
export interface HealthStatus {
  agentId: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastCheck: Date;
  containerId?: string;
  containerStatus?: string;
  memoryUsage?: number;
  cpuUsage?: number;
  errorMessage?: string;
}

// API Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
}

// Scheduler
export interface ScheduledJob {
  id: string;
  agentId: string;
  cronExpression: string;
  lastRun?: Date;
  nextRun?: Date;
  enabled: boolean;
}

// Metrics
export interface Metric {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: Date;
}

// MCP Worker Types
export interface WorkerTask {
  id: string;
  parentAgent: AgentType;
  parentAgentId: string;
  task: string;               // Natural language task description
  servers: string[];          // Required MCP servers (e.g., ['telegram', 'directus'])
  timeout?: number;           // Max execution time in ms (default: 60000)
  context?: Record<string, unknown>; // Optional context from parent agent
}

export interface WorkerResult {
  taskId: string;
  success: boolean;
  result?: string;            // Task output description
  data?: unknown;             // Structured data if any
  toolsUsed?: string[];       // Which MCP tools were called
  error?: string;             // Error message if failed
  duration: number;           // Execution time in ms
}

// Domain Approval Request Types
export type DomainApprovalStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved';

export interface DomainApprovalRequest {
  id: string;
  domain: string;
  requestedBy: AgentType;       // Agent that requested access
  taskContext: string;          // What task needed this domain
  url: string;                  // Full URL that was attempted
  reason?: string;              // Why it's needed
  status: DomainApprovalStatus;
  reviewedBy?: string;          // 'ceo', 'human', or 'auto'
  reviewNotes?: string;
  suggestedCategory?: string;   // AI suggested category
  securityScore?: number;       // AI security assessment (0-100)
  createdAt: Date;
  updatedAt: Date;
}
