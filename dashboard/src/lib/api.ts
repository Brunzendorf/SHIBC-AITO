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
export async function getPendingDecisions() {
  return fetchApi<Decision[]>('/decisions/pending');
}

export async function getDecision(id: string) {
  return fetchApi<Decision>(`/decisions/${id}`);
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
  };
  agents: AgentHealth[];
}

export interface ComponentHealth {
  status: 'healthy' | 'unhealthy';
  message?: string;
  latency?: number;
}

export interface AgentHealth {
  id: string;
  type: string;
  status: string;
  lastLoop?: string;
  loopCount?: number;
  errorCount?: number;
}

export interface Agent {
  id: string;
  type: string;
  name: string;
  status: string;
  profilePath: string;
  loopInterval: number;
  containerId?: string;
  containerStatus?: string;
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
