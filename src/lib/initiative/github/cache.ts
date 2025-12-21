/**
 * GitHub Backlog Cache
 * TASK-037: Redis-based caching for GitHub issues
 */

import { redis } from '../../redis.js';
import { createLogger } from '../../logger.js';
import { getOctokit, getRepoConfig } from './client.js';

const logger = createLogger('initiative:github:cache');

// =============================================================================
// CACHE KEYS
// =============================================================================

const BACKLOG_CACHE_KEY = 'context:backlog';
const CONTEXT_CACHE_PREFIX = 'initiative:context:';

// =============================================================================
// BACKLOG CACHE
// =============================================================================

/**
 * Cached backlog data structure
 */
export interface BacklogData {
  issues: Array<{
    number: number;
    title: string;
    body: string | null | undefined;
    labels: string[];
    state: string;
    created_at: string;
    assignee?: string;
    html_url: string;
  }>;
  lastGroomed: string;
}

/**
 * Refresh the backlog cache in Redis after status changes
 */
export async function refreshBacklogCache(): Promise<void> {
  try {
    const { owner, repo } = getRepoConfig();
    const gh = getOctokit();

    // Fetch all open issues
    const issues = await gh.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: 100,
    });

    const backlogData: BacklogData = {
      issues: issues.data.map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body,
        labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name || '')),
        state: issue.state,
        created_at: issue.created_at,
        assignee: issue.assignee?.login,
        html_url: issue.html_url,
      })),
      lastGroomed: new Date().toISOString(),
    };

    await redis.set(BACKLOG_CACHE_KEY, JSON.stringify(backlogData));
    logger.debug({ issueCount: issues.data.length }, 'Refreshed backlog cache');
  } catch (error) {
    logger.warn({ error }, 'Failed to refresh backlog cache');
  }
}

/**
 * Get cached backlog data
 */
export async function getBacklogCache(): Promise<BacklogData | null> {
  try {
    const cached = await redis.get(BACKLOG_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to read backlog cache');
  }
  return null;
}

// =============================================================================
// INITIATIVE CONTEXT CACHE
// =============================================================================

/**
 * Cache TTL for initiative context (15 minutes)
 */
export const INITIATIVE_CONTEXT_TTL = 15 * 60; // seconds

/**
 * Cached context data structure
 */
export interface CachedContextData {
  githubIssues: {
    open: string[];
    recent: string[];
  };
  dataContext: string;
}

/**
 * Get cached initiative context for an agent
 */
export async function getCachedContext(agentType: string): Promise<CachedContextData | null> {
  const cacheKey = `${CONTEXT_CACHE_PREFIX}${agentType}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug({ agentType }, 'Using cached initiative context');
      return JSON.parse(cached);
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to read initiative context cache');
  }

  return null;
}

/**
 * Set cached initiative context for an agent
 */
export async function setCachedContext(
  agentType: string,
  data: CachedContextData,
  ttl = INITIATIVE_CONTEXT_TTL
): Promise<void> {
  const cacheKey = `${CONTEXT_CACHE_PREFIX}${agentType}`;

  try {
    await redis.setex(cacheKey, ttl, JSON.stringify(data));
    logger.debug({ agentType, ttl }, 'Cached initiative context');
  } catch (error) {
    logger.warn({ error }, 'Failed to cache initiative context');
  }
}

/**
 * Invalidate cached context for an agent
 */
export async function invalidateCachedContext(agentType: string): Promise<void> {
  const cacheKey = `${CONTEXT_CACHE_PREFIX}${agentType}`;

  try {
    await redis.del(cacheKey);
    logger.debug({ agentType }, 'Invalidated initiative context cache');
  } catch (error) {
    logger.warn({ error }, 'Failed to invalidate initiative context cache');
  }
}

/**
 * Invalidate all cached contexts
 */
export async function invalidateAllCachedContexts(): Promise<void> {
  try {
    // Get all context keys
    const keys = await redis.keys(`${CONTEXT_CACHE_PREFIX}*`);

    if (keys.length > 0) {
      await redis.del(...keys);
      logger.debug({ count: keys.length }, 'Invalidated all initiative context caches');
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to invalidate all initiative context caches');
  }
}
