'use client';

import useSWR from 'swr';
import { getAllSettings, getSettingsByCategory, updateSetting, updateSettingsCategory } from '@/lib/api';
import type { AllSettings, SettingsGroup } from '@/lib/api';

export function useSettings() {
  const { data, error, mutate } = useSWR<AllSettings | null>(
    'settings',
    async () => {
      const response = await getAllSettings();
      return response.data;
    },
    { refreshInterval: 30000 }
  );

  return {
    settings: data || null,
    isLoading: !error && !data,
    isError: error,
    refresh: () => mutate(),
  };
}

export function useSettingsCategory(category: string) {
  const { data, error, mutate } = useSWR<SettingsGroup | null>(
    `settings-${category}`,
    async () => {
      const response = await getSettingsByCategory(category);
      return response.data;
    },
    { refreshInterval: 30000 }
  );

  return {
    settings: data || null,
    isLoading: !error && !data,
    isError: error,
    refresh: () => mutate(),
  };
}

export async function saveSetting(category: string, key: string, value: unknown) {
  const result = await updateSetting(category, key, value);
  return result;
}

export async function saveSettingsCategory(category: string, updates: Record<string, unknown>) {
  const result = await updateSettingsCategory(category, updates);
  return result;
}
