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
export type DecisionType = 'minor' | 'major' | 'critical';
export type DecisionStatus = 'pending' | 'approved' | 'vetoed' | 'escalated';
export type VoteValue = 'approve' | 'veto' | 'abstain';

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
  | 'broadcast';

export interface Event {
  id: string;
  eventType: EventType;
  sourceAgent?: string;
  targetAgent?: string;
  payload: unknown;
  createdAt: Date;
}

// Messages (Inter-Agent Communication)
export type MessageType =
  | 'task'
  | 'status_request'
  | 'status_response'
  | 'decision'
  | 'vote'
  | 'alert'
  | 'broadcast'
  | 'direct';

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';

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
