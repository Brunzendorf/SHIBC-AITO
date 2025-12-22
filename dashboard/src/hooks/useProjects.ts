'use client';

import { useApi } from './useApi';
import type {
  Project,
  ProjectWithDetails,
  ProjectTask,
  ScheduledEvent,
  ProjectStats,
  AgentWorkload,
  ProjectStatus,
} from '@/lib/api';

// === Projects ===

export function useProjects(status?: ProjectStatus, owner?: string) {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (owner) params.append('owner', owner);
  const query = params.toString() ? `?${params}` : '';
  return useApi<Project[]>(`/projects${query}`);
}

export function useProject(id: string | null) {
  return useApi<ProjectWithDetails>(id ? `/projects/${id}` : null);
}

export function useProjectStats() {
  return useApi<ProjectStats>('/projects/stats/summary', {
    refreshInterval: 30000, // Refresh every 30 seconds
  });
}

export function useAgentWorkload() {
  return useApi<AgentWorkload[]>('/projects/stats/workload', {
    refreshInterval: 30000,
  });
}

// === Project Tasks ===

export function useProjectTasks(projectId: string | null) {
  return useApi<ProjectTask[]>(projectId ? `/projects/${projectId}/tasks` : null);
}

export function useProjectTask(id: string | null) {
  return useApi<ProjectTask & { canStart: boolean }>(id ? `/project-tasks/${id}` : null);
}

export function useBlockedTasks() {
  return useApi<ProjectTask[]>('/project-tasks/blocked/all');
}

// === Scheduled Events ===

export function useScheduledEvents(days = 14, platform?: string, agent?: string) {
  const params = new URLSearchParams({ days: String(days) });
  if (platform) params.append('platform', platform);
  if (agent) params.append('agent', agent);
  return useApi<ScheduledEvent[]>(`/scheduled-events?${params}`);
}

export function useScheduledEventsByRange(start: string | null, end: string | null) {
  if (!start || !end) return useApi<ScheduledEvent[]>(null);
  const params = new URLSearchParams({ start, end });
  return useApi<ScheduledEvent[]>(`/scheduled-events/range?${params}`);
}

export function useProjectEvents(projectId: string | null) {
  return useApi<ScheduledEvent[]>(projectId ? `/projects/${projectId}/events` : null);
}

export function useScheduledEvent(id: string | null) {
  return useApi<ScheduledEvent>(id ? `/scheduled-events/${id}` : null);
}

export function useDueEvents() {
  return useApi<ScheduledEvent[]>('/scheduled-events/due/now', {
    refreshInterval: 60000, // Check every minute
  });
}
