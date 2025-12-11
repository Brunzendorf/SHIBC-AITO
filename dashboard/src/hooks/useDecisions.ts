'use client';

import { useApi } from './useApi';
import type { Decision, Escalation } from '@/lib/api';

export function useAllDecisions(limit = 50) {
  return useApi<Decision[]>(`/decisions?limit=${limit}`);
}

export function usePendingDecisions() {
  return useApi<Decision[]>('/decisions/pending');
}

export function useDecision(id: string | null) {
  return useApi<Decision>(id ? `/decisions/${id}` : null);
}

export function usePendingEscalations() {
  return useApi<Escalation[]>('/escalations/pending');
}

export function useEscalatedDecisions() {
  return useApi<Decision[]>('/decisions/escalated');
}
