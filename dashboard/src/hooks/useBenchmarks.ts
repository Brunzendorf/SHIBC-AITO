'use client';

import { useApi } from './useApi';
import type {
  BenchmarkTask,
  BenchmarkResult,
  LeaderboardEntry,
} from '@/lib/api';

/**
 * Get all available benchmark tasks
 */
export function useBenchmarkTasks() {
  return useApi<BenchmarkTask[]>('/benchmarks/tasks', {
    refreshInterval: 0, // Static data, no auto-refresh
  });
}

/**
 * Get all benchmark runs (paginated)
 */
export function useBenchmarkRuns(limit = 20) {
  return useApi<BenchmarkResult[]>(`/benchmarks/runs?limit=${limit}`, {
    refreshInterval: 10000, // Refresh every 10s to check for new runs
  });
}

/**
 * Get specific benchmark run by ID
 */
export function useBenchmarkRun(runId: string | null) {
  return useApi<BenchmarkResult>(runId ? `/benchmarks/runs/${runId}` : null, {
    refreshInterval: 0, // Historical data, no auto-refresh
  });
}

/**
 * Get latest benchmark run
 */
export function useLatestBenchmark() {
  return useApi<BenchmarkResult>('/benchmarks/latest', {
    refreshInterval: 10000, // Refresh every 10s
  });
}

/**
 * Get current leaderboard (from latest run)
 */
export function useBenchmarkLeaderboard() {
  return useApi<LeaderboardEntry[]>('/benchmarks/leaderboard', {
    refreshInterval: 10000, // Refresh every 10s
  });
}
