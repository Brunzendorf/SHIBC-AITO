'use client';

import { useApi } from './useApi';
import type { WorkerExecution, WorkerStats } from '@/lib/api';

// Note: useApi fetcher already extracts result.data, so we get arrays directly

export function useWorkerExecutions(limit = 100, agent?: string, includeDryRun = true) {
  const params = new URLSearchParams({ limit: String(limit), includeDryRun: String(includeDryRun) });
  if (agent) params.append('agent', agent);

  const { data, error, isLoading, mutate } = useApi<WorkerExecution[]>(`/workers?${params}`);

  return {
    executions: data || [],
    error,
    isLoading,
    mutate,
  };
}

export function useWorkerStats() {
  const { data, error, isLoading, mutate } = useApi<WorkerStats>('/workers/stats/summary');

  return {
    stats: data || null,
    error,
    isLoading,
    mutate,
  };
}

export function useWorkerExecution(taskId: string | null) {
  const { data, error, isLoading, mutate } = useApi<WorkerExecution>(
    taskId ? `/workers/${taskId}` : null
  );

  return {
    execution: data || null,
    error,
    isLoading,
    mutate,
  };
}
