'use client';

import { useApi } from './useApi';
import type { Event } from '@/lib/api';

export function useEvents(limit = 50) {
  return useApi<Event[]>(`/events?limit=${limit}`);
}
