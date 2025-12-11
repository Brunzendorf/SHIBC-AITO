'use client';

import useSWR, { SWRConfiguration } from 'swr';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Generic fetcher for SWR
const fetcher = async (url: string) => {
  const response = await fetch(`${API_BASE}${url}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
};

// Custom hook options
const defaultOptions: SWRConfiguration = {
  refreshInterval: 5000,  // Auto-refresh every 5 seconds
  revalidateOnFocus: true,
  dedupingInterval: 2000,
};

// Generic hook for any endpoint
export function useApi<T>(endpoint: string | null, options?: SWRConfiguration) {
  return useSWR<T>(endpoint, fetcher, { ...defaultOptions, ...options });
}

// Convenience export
export { fetcher, defaultOptions };
