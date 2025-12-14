'use client';

import { useApi } from './useApi';
import type { WorkerExecution, WorkerStats } from '@/lib/api';

interface WorkersResponse {
  success: boolean;
  data: WorkerExecution[];
  timestamp: string;
}

interface WorkerStatsResponse {
  success: boolean;
  data: WorkerStats;
  timestamp: string;
}

export function useWorkerExecutions(limit = 100, agent?: string, includeDryRun = true) {
  const params = new URLSearchParams({ limit: String(limit), includeDryRun: String(includeDryRun) });
  if (agent) params.append('agent', agent);

  const { data, error, isLoading, mutate } = useApi<WorkersResponse>(`/workers?${params}`);

  return {
    executions: data?.data || [],
    error,
    isLoading,
    mutate,
  };
}

export function useWorkerStats() {
  const { data, error, isLoading, mutate } = useApi<WorkerStatsResponse>('/workers/stats/summary');

  return {
    stats: data?.data || null,
    error,
    isLoading,
    mutate,
  };
}

export function useWorkerExecution(taskId: string | null) {
  const { data, error, isLoading, mutate } = useApi<{ success: boolean; data: WorkerExecution }>(
    taskId ? `/workers/${taskId}` : null
  );

  return {
    execution: data?.data || null,
    error,
    isLoading,
    mutate,
  };
}
