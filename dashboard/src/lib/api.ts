// API client for AITO Orchestrator

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { data: null, error: errorText || `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Health endpoints
export async function getHealth() {
  return fetchApi<{ status: string }>('/health');
}

export async function getHealthFull() {
  return fetchApi<HealthFull>('/health/full');
}

// Agent endpoints
export async function getAgents() {
  return fetchApi<Agent[]>('/agents');
}

export async function getAgent(type: string) {
  return fetchApi<AgentDetail>(`/agents/${type}`);
}

export async function restartAgent(type: string) {
  return fetchApi<{ message: string }>(`/agents/${type}/restart`, { method: 'POST' });
}

export async function startAgent(type: string) {
  return fetchApi<{ message: string }>(`/agents/${type}/start`, { method: 'POST' });
}

export async function stopAgent(type: string) {
  return fetchApi<{ message: string }>(`/agents/${type}/stop`, { method: 'POST' });
}

// Events
export async function getEvents(limit = 50) {
  return fetchApi<Event[]>(`/events?limit=${limit}`);
}

export async function getAgentEvents(agentId: string, limit = 20) {
  return fetchApi<Event[]>(`/events/agent/${agentId}?limit=${limit}`);
}

// Decisions
export async function getAllDecisions(limit = 50, offset = 0) {
  return fetchApi<Decision[]>(`/decisions?limit=${limit}&offset=${offset}`);
}

export async function getPendingDecisions() {
  return fetchApi<Decision[]>('/decisions/pending');
}

export async function getDecision(id: string) {
  return fetchApi<Decision>(`/decisions/${id}`);
}

export async function getEscalatedDecisions() {
  return fetchApi<Decision[]>('/decisions/escalated');
}

export async function submitHumanDecision(id: string, decision: 'approve' | 'reject', reason?: string) {
  return fetchApi<{ status: string; decision: string }>(`/decisions/${id}/human-decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
  });
}

// Escalations
export async function getPendingEscalations() {
  return fetchApi<Escalation[]>('/escalations/pending');
}

export async function respondToEscalation(id: string, response: string) {
  return fetchApi<{ message: string }>(`/escalations/${id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ response }),
  });
}

// Workers
export async function getWorkerExecutions(limit = 100, agent?: string, includeDryRun = true) {
  const params = new URLSearchParams({ limit: String(limit), includeDryRun: String(includeDryRun) });
  if (agent) params.append('agent', agent);
  return fetchApi<WorkerExecution[]>(`/workers?${params}`);
}

export async function getWorkerExecution(taskId: string) {
  return fetchApi<WorkerExecution>(`/workers/${taskId}`);
}

export async function getWorkerStats() {
  return fetchApi<WorkerStats>(`/workers/stats/summary`);
}

// Metrics
export async function getMetrics() {
  return fetchApi<string>('/metrics');
}

// Types
export interface HealthFull {
  status: string;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    docker: ComponentHealth;
    agents: AgentsHealth;
  };
  uptime: number;
}

export interface ComponentHealth {
  status: 'healthy' | 'unhealthy';
  message?: string;
  latencyMs?: number;
}

export interface AgentsHealth {
  total: number;
  healthy: number;
  unhealthy: number;
  inactive: number;
  details: Record<string, AgentHealthDetail>;
}

export interface AgentHealthDetail {
  agentId: string;
  status: string;
  lastCheck: string;
  containerId?: string;
  containerStatus?: string;
  memoryUsage?: number;
  cpuUsage?: number;
}

export interface ContainerStatus {
  agentId: string;
  status: string;
  lastCheck: string;
  containerId?: string;
  containerStatus?: string;
  memoryUsage?: number;
  cpuUsage?: number;
}

export interface Agent {
  id: string;
  type: string;
  name: string;
  status: string;
  profilePath: string;
  loopInterval: number;
  containerId?: string;
  containerStatus?: ContainerStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDetail extends Agent {
  state: Record<string, unknown>;
  history: AgentHistoryEntry[];
}

export interface AgentHistoryEntry {
  id: string;
  actionType: string;
  summary: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface Event {
  id: string;
  eventType: string;
  sourceAgent?: string;
  targetAgent?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface Decision {
  id: string;
  title: string;
  description?: string;
  proposedBy: string;
  decisionType: string;
  status: string;
  vetoRound: number;
  ceoVote?: string;
  daoVote?: string;
  cLevelVotes?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface Escalation {
  id: string;
  decisionId?: string;
  reason: string;
  channelsNotified: string[];
  humanResponse?: string;
  status: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface WorkerExecution {
  timestamp: string;
  taskId: string;
  parentAgent: string;
  servers: string[];
  task?: string;
  toolsUsed?: string[];
  success: boolean;
  duration: number;
  error?: string;
  mode?: string;
  dryRun?: boolean;
}

export interface WorkerStats {
  total: number;
  success: number;
  failure: number;
  dryRunCount: number;
  avgDurationMs: number;
  byAgent: Record<string, number>;
  byServer: Record<string, number>;
}
