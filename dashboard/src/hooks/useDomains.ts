'use client';

import { useApi } from './useApi';
import type { DomainApprovalRequest, WhitelistDomain } from '@/lib/api';

// Domain Approval Requests
export function useDomainApprovals(status?: string, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.append('status', status);

  const { data, error, isLoading, mutate } = useApi<DomainApprovalRequest[]>(`/domain-approvals?${params}`);

  return {
    approvals: data || [],
    error,
    isLoading,
    mutate,
  };
}

export function usePendingDomainApprovals() {
  const { data, error, isLoading, mutate } = useApi<DomainApprovalRequest[]>('/domain-approvals?status=pending');

  return {
    pendingApprovals: data || [],
    pendingCount: data?.length || 0,
    error,
    isLoading,
    mutate,
  };
}

export function usePendingDomainCount() {
  const { data, error, isLoading, mutate } = useApi<{ count: number }>('/domain-approvals/pending/count');

  return {
    count: data?.count || 0,
    error,
    isLoading,
    mutate,
  };
}

// Domain Whitelist
export function useWhitelist() {
  const { data, error, isLoading, mutate } = useApi<WhitelistDomain[]>('/whitelist');

  return {
    whitelist: data || [],
    error,
    isLoading,
    mutate,
  };
}

export function useWhitelistCategories() {
  const { data, error, isLoading, mutate } = useApi<string[]>('/whitelist/categories');

  return {
    categories: data || [],
    error,
    isLoading,
    mutate,
  };
}
