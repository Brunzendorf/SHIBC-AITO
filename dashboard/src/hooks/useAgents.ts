'use client';

import { useApi } from './useApi';
import type { Agent, AgentDetail } from '@/lib/api';

export function useAgents() {
  return useApi<Agent[]>('/agents');
}

export function useAgent(type: string | null) {
  return useApi<AgentDetail>(type ? `/agents/${type}` : null);
}

export function useAgentEvents(agentId: string | null, limit = 20) {
  return useApi<Event[]>(agentId ? `/events/agent/${agentId}?limit=${limit}` : null);
}

export interface AgentHistory {
  id: string;
  agentId: string;
  actionType: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export function useAgentHistory(type: string | null, limit = 50) {
  return useApi<AgentHistory[]>(type ? `/agents/${type}/history?limit=${limit}` : null);
}
