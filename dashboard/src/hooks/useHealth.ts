'use client';

import { useApi } from './useApi';
import type { HealthFull } from '@/lib/api';

export function useHealth() {
  return useApi<HealthFull>('/health/full');
}

export function useHealthSimple() {
  return useApi<{ status: string }>('/health');
}
