/**
 * Agent State Manager
 * Manages persistent state for agents via PostgreSQL
 */

import { createLogger } from '../lib/logger.js';
import { stateRepo } from '../lib/db.js';
import type { AgentType } from '../lib/types.js';

const logger = createLogger('state');

export interface StateManager {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  getAll(): Promise<Record<string, unknown>>;
  /** TASK-006: Get only essential state keys for loop prompt (performance optimization) */
  getEssential(): Promise<Record<string, unknown>>;
  clear(): Promise<void>;
}

/**
 * Create a state manager for an agent
 */
export function createStateManager(agentId: string, agentType: AgentType): StateManager {
  logger.info({ agentId, agentType }, 'Creating state manager');

  return {
    /**
     * Get a state value by key
     */
    async get<T>(key: string): Promise<T | null> {
      try {
        const value = await stateRepo.get(agentId, key);
        if (value === null) return null;
        return value as T;
      } catch (error) {
        logger.error({ agentId, key, error }, 'Failed to get state');
        return null;
      }
    },

    /**
     * Set a state value
     */
    async set<T>(key: string, value: T): Promise<void> {
      try {
        await stateRepo.set(agentId, key, value);
        logger.debug({ agentId, key }, 'State updated');
      } catch (error) {
        logger.error({ agentId, key, error }, 'Failed to set state');
        throw error;
      }
    },

    /**
     * Delete a state value
     */
    async delete(key: string): Promise<void> {
      try {
        await stateRepo.delete(agentId, key);
        logger.debug({ agentId, key }, 'State deleted');
      } catch (error) {
        logger.error({ agentId, key, error }, 'Failed to delete state');
        throw error;
      }
    },

    /**
     * Get all state values for this agent
     */
    async getAll(): Promise<Record<string, unknown>> {
      try {
        return await stateRepo.getAll(agentId);
      } catch (error) {
        logger.error({ agentId, error }, 'Failed to get all state');
        return {};
      }
    },

    /**
     * TASK-006: Get only essential state keys for loop prompt
     * This is a performance optimization - instead of loading 1000+ keys,
     * only loads the 6 keys actually needed for the loop prompt.
     */
    async getEssential(): Promise<Record<string, unknown>> {
      const result: Record<string, unknown> = {};
      try {
        // Import ESSENTIAL_STATE_KEYS locally to avoid circular dependency issues
        const essentialKeys = [
          'loop_count',
          'last_loop_at',
          'last_loop_result',
          'current_focus',
          'error_count',
          'success_count',
        ];

        // Load each key individually - faster than loading all 1000+ keys
        await Promise.all(
          essentialKeys.map(async (key) => {
            const value = await stateRepo.get(agentId, key);
            if (value !== null) {
              result[key] = value;
            }
          })
        );

        logger.debug({ agentId, keyCount: Object.keys(result).length }, 'Loaded essential state');
        return result;
      } catch (error) {
        logger.error({ agentId, error }, 'Failed to get essential state');
        return result;
      }
    },

    /**
     * Clear all state for this agent
     */
    async clear(): Promise<void> {
      try {
        const states = await stateRepo.getAll(agentId);
        for (const key of Object.keys(states)) {
          await stateRepo.delete(agentId, key);
        }
        logger.info({ agentId }, 'State cleared');
      } catch (error) {
        logger.error({ agentId, error }, 'Failed to clear state');
        throw error;
      }
    },
  };
}

/**
 * Common state keys used by agents
 */
export const StateKeys = {
  // Last loop execution
  LAST_LOOP_AT: 'last_loop_at',
  LAST_LOOP_RESULT: 'last_loop_result',

  // Counters
  LOOP_COUNT: 'loop_count',
  ERROR_COUNT: 'error_count',
  SUCCESS_COUNT: 'success_count',

  // Context
  CURRENT_FOCUS: 'current_focus',
  PENDING_TASKS: 'pending_tasks',
  COMPLETED_TASKS: 'completed_tasks',

  // Communication
  LAST_STATUS_REPORT: 'last_status_report',
  UNREAD_MESSAGES: 'unread_messages',

  // Custom per-agent
  CUSTOM_PREFIX: 'custom:',
} as const;

/**
 * TASK-006: Essential state keys for loop prompt
 * Only these keys are loaded during the main loop to avoid
 * loading 1000+ keys which slows down the agent
 */
export const ESSENTIAL_STATE_KEYS = [
  StateKeys.LOOP_COUNT,
  StateKeys.LAST_LOOP_AT,
  StateKeys.LAST_LOOP_RESULT,
  StateKeys.CURRENT_FOCUS,
  StateKeys.ERROR_COUNT,
  StateKeys.SUCCESS_COUNT,
] as const;

/**
 * Helper to create prefixed custom keys
 */
export function customKey(name: string): string {
  return StateKeys.CUSTOM_PREFIX + name;
}
