/**
 * Image Generation Quota System
 * Tracks daily limits and costs for image generation
 */

import { createLogger } from '../logger.js';
import { redis } from '../redis.js';

const logger = createLogger('image-quota');

/**
 * Daily quotas per agent role
 */
export const IMAGE_QUOTAS = {
  ceo: {
    daily: 5,           // CEO: max 5 images/day (presentations, reports)
    freeModelOnly: false,
  },
  cmo: {
    daily: 20,          // CMO: max 20 images/day (marketing, social media)
    freeModelOnly: false,
  },
  cto: {
    daily: 3,           // CTO: max 3 images/day (technical diagrams)
    freeModelOnly: true,
  },
  cfo: {
    daily: 2,           // CFO: max 2 images/day (charts, reports)
    freeModelOnly: true,
  },
  coo: {
    daily: 5,           // COO: max 5 images/day (operational docs)
    freeModelOnly: true,
  },
  cco: {
    daily: 10,          // CCO: max 10 images/day (community content)
    freeModelOnly: true,
  },
  dao: {
    daily: 5,           // DAO: max 5 images/day (governance visuals)
    freeModelOnly: true,
  },
} as const;

/**
 * Model costs (USD per image)
 */
export const IMAGE_COSTS = {
  'imagen-4.0-generate-001': 0.04,       // $0.04 per image
  'gemini-2.5-flash-image': 0.0,         // Free
} as const;

/**
 * Get Redis key for agent's daily usage
 */
function getDailyUsageKey(agentRole: string): string {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `image:quota:${agentRole}:${today}`;
}

/**
 * Get Redis key for agent's cost tracking
 */
function getDailyCostKey(agentRole: string): string {
  const today = new Date().toISOString().split('T')[0];
  return `image:cost:${agentRole}:${today}`;
}

/**
 * Check if agent can generate an image
 */
export async function canGenerateImage(
  agentRole: string,
  model: string = 'gemini-2.5-flash-image'
): Promise<{ allowed: boolean; remaining: number; reason?: string }> {
  const quota = IMAGE_QUOTAS[agentRole as keyof typeof IMAGE_QUOTAS];

  if (!quota) {
    return { allowed: false, remaining: 0, reason: `Unknown agent role: ${agentRole}` };
  }

  // Check if agent is restricted to free models only
  if (quota.freeModelOnly && IMAGE_COSTS[model as keyof typeof IMAGE_COSTS] > 0) {
    return {
      allowed: false,
      remaining: 0,
      reason: `Agent ${agentRole} can only use free models (gemini-2.5-flash-image)`
    };
  }

  // Check daily limit
  const usageKey = getDailyUsageKey(agentRole);
  const currentUsage = parseInt(await redis.get(usageKey) || '0', 10);
  const remaining = quota.daily - currentUsage;

  if (currentUsage >= quota.daily) {
    return {
      allowed: false,
      remaining: 0,
      reason: `Daily limit reached (${quota.daily} images/day)`
    };
  }

  return { allowed: true, remaining };
}

/**
 * Record an image generation
 */
export async function recordImageGeneration(
  agentRole: string,
  model: string = 'gemini-2.5-flash-image'
): Promise<{ count: number; cost: number; totalCost: number }> {
  const usageKey = getDailyUsageKey(agentRole);
  const costKey = getDailyCostKey(agentRole);

  // Increment usage counter
  const newCount = await redis.incr(usageKey);

  // Set expiry to end of day (so it auto-resets)
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const ttlSeconds = Math.floor((endOfDay.getTime() - now.getTime()) / 1000);
  await redis.expire(usageKey, ttlSeconds);

  // Track cost
  const cost = IMAGE_COSTS[model as keyof typeof IMAGE_COSTS] || 0;
  const totalCostStr = await redis.get(costKey) || '0';
  const totalCost = parseFloat(totalCostStr) + cost;
  await redis.setex(costKey, ttlSeconds, totalCost.toString());

  logger.info({
    agentRole,
    model,
    count: newCount,
    cost,
    totalCost,
  }, 'Image generation recorded');

  return { count: newCount, cost, totalCost };
}

/**
 * Get current usage stats for agent
 */
export async function getImageUsageStats(agentRole: string): Promise<{
  used: number;
  limit: number;
  remaining: number;
  totalCost: number;
  usagePercent: number;
}> {
  const quota = IMAGE_QUOTAS[agentRole as keyof typeof IMAGE_QUOTAS];
  if (!quota) {
    return { used: 0, limit: 0, remaining: 0, totalCost: 0, usagePercent: 0 };
  }

  const usageKey = getDailyUsageKey(agentRole);
  const costKey = getDailyCostKey(agentRole);

  const used = parseInt(await redis.get(usageKey) || '0', 10);
  const totalCost = parseFloat(await redis.get(costKey) || '0');
  const remaining = Math.max(0, quota.daily - used);
  const usagePercent = (used / quota.daily) * 100;

  return {
    used,
    limit: quota.daily,
    remaining,
    totalCost,
    usagePercent,
  };
}

/**
 * Get warning message if usage is high
 */
export async function getQuotaWarning(agentRole: string): Promise<string | null> {
  const stats = await getImageUsageStats(agentRole);

  if (stats.usagePercent >= 100) {
    return `⚠️ Daily image limit REACHED (${stats.used}/${stats.limit})`;
  }

  if (stats.usagePercent >= 80) {
    return `⚠️ Image quota at ${stats.usagePercent.toFixed(0)}% (${stats.used}/${stats.limit}, ${stats.remaining} left)`;
  }

  return null;
}
