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

    const json = await response.json();
    // Unwrap orchestrator response format: {success: true, data: T}
    const data = json.data !== undefined ? json.data : json;
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

// Human-to-Agent Messaging
export async function sendMessageToAgent(agentType: string, message: string, priority: 'low' | 'normal' | 'high' | 'critical' = 'normal') {
  return fetchApi<{ status: string; messageId: string; agentType: string; agentId: string }>(`/agents/${agentType}/message`, {
    method: 'POST',
    body: JSON.stringify({ message, priority }),
  });
}

export async function broadcastMessage(message: string, priority: 'low' | 'normal' | 'high' | 'critical' = 'normal') {
  return fetchApi<{ status: string; messageId: string }>('/broadcast', {
    method: 'POST',
    body: JSON.stringify({ message, priority }),
  });
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
  result?: string;  // Worker output result
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

// Focus Settings
export interface FocusSettings {
  revenueFocus: number;
  communityGrowth: number;
  marketingVsDev: number;
  riskTolerance: number;
  timeHorizon: number;
  updatedAt?: string;
  updatedBy?: string;
}

export async function getFocusSettings() {
  return fetchApi<FocusSettings>('/focus');
}

export async function updateFocusSettings(settings: Partial<FocusSettings>) {
  return fetchApi<FocusSettings>('/focus', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}

// Initiatives (read from Redis via API)
export interface Initiative {
  title: string;
  description: string;
  priority: string;
  revenueImpact: number;
  effort: number;
  suggestedAssignee: string;
  tags: string[];
  issueUrl?: string;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt?: string;
}

export async function getInitiatives() {
  return fetchApi<Initiative[]>('/initiatives');
}

// Domain Approval Requests
export interface DomainApprovalRequest {
  id: string;
  domain: string;
  url: string;
  requestedBy: string;
  taskContext: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  reviewedBy?: string;
  reviewNotes?: string;
  suggestedCategory?: string;
  securityScore?: number;
  createdAt: string;
  updatedAt: string;
}

export async function getDomainApprovals(status?: string, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.append('status', status);
  return fetchApi<DomainApprovalRequest[]>(`/domain-approvals?${params}`);
}

export async function getPendingDomainApprovals() {
  return fetchApi<DomainApprovalRequest[]>('/domain-approvals?status=pending');
}

export async function getPendingDomainApprovalsCount() {
  return fetchApi<{ count: number }>('/domain-approvals/pending/count');
}

export async function approveDomainRequest(id: string, reviewedBy = 'human', notes?: string, category?: string) {
  return fetchApi<DomainApprovalRequest>(`/domain-approvals/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ reviewedBy, notes, category }),
  });
}

export async function rejectDomainRequest(id: string, reviewedBy = 'human', notes?: string) {
  return fetchApi<DomainApprovalRequest>(`/domain-approvals/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reviewedBy, notes }),
  });
}

// Domain Whitelist
export interface WhitelistDomain {
  id: string;
  domain: string;
  category: string;
  description?: string;
  isActive: boolean;
  addedBy: string;
  createdAt: string;
  updatedAt: string;
}

export async function getWhitelist() {
  return fetchApi<WhitelistDomain[]>('/whitelist');
}

export async function getWhitelistCategories() {
  return fetchApi<string[]>('/whitelist/categories');
}

export async function addToWhitelist(domain: string, category: string, description?: string) {
  return fetchApi<WhitelistDomain>('/whitelist', {
    method: 'POST',
    body: JSON.stringify({ domain, category, description }),
  });
}

export async function removeFromWhitelist(domain: string) {
  return fetchApi<{ domain: string; status: string }>(`/whitelist/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
  });
}

// Kanban / Backlog
export interface KanbanIssue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  status: 'backlog' | 'ready' | 'in_progress' | 'review' | 'done' | 'blocked';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  effort?: 'xs' | 's' | 'm' | 'l' | 'xl';
  assignee?: string;
  epicNumber?: number;
  isEpic?: boolean;
  created_at: string;
  html_url?: string;
}

export interface BacklogStats {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byAgent: Record<string, number>;
  lastGroomed?: string;
}

export async function getBacklogIssues() {
  return fetchApi<KanbanIssue[]>('/backlog/issues');
}

export async function getBacklogStats() {
  return fetchApi<BacklogStats>('/backlog/stats');
}

// API object wrapper for convenience
export const api = {
  get: async <T>(endpoint: string) => fetchApi<T>(endpoint),
  post: async <T>(endpoint: string, data?: unknown) => fetchApi<T>(endpoint, {
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined,
  }),
};
