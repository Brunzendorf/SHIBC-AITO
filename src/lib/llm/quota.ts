/**
 * LLM Quota & Usage Monitoring
 * Tracks API usage and quota limits for Claude and Gemini
 */

import { createLogger } from '../logger.js';
import { redis } from '../redis.js';
import type { LLMProviderType } from './types.js';

const logger = createLogger('llm-quota');

/**
 * Quota information for a provider
 */
export interface ProviderQuota {
  provider: LLMProviderType;

  // Token-based quota (Gemini)
  totalQuota?: number; // Total tokens per month
  usedQuota: number; // Tokens used this period
  remainingQuota?: number; // Calculated remaining

  // Session-based quota (Claude Code)
  sessionWindows?: {
    fiveHour: {
      requestsUsed: number;
      maxRequests?: number; // Unknown for Claude Code
      windowStart: Date;
      windowEnd: Date;
    };
    sevenDay: {
      requestsUsed: number;
      maxRequests?: number; // Unknown for Claude Code
      windowStart: Date;
      windowEnd: Date;
    };
  };

  resetDate?: Date; // When quota resets
  lastUpdated: Date;
}

/**
 * Usage statistics
 */
export interface UsageStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokensEstimated: number; // Estimated based on prompt length
  totalDurationMs: number;
  averageDurationMs: number;
}

/**
 * Quota threshold warnings
 */
export interface QuotaWarning {
  provider: LLMProviderType;
  level: 'info' | 'warning' | 'critical';
  message: string;
  percentageUsed: number;
  timestamp: Date;
}

/**
 * Quota Manager - Tracks usage and monitors limits
 */
export class QuotaManager {
  private redisKeyPrefix = 'llm:quota:';

  /**
   * Record API call usage
   * - Gemini: Token-based tracking
   * - Claude: Session-based tracking (5h/7d windows)
   */
  async recordUsage(
    provider: LLMProviderType,
    promptTokens: number,
    completionTokens: number,
    durationMs: number,
    success: boolean
  ): Promise<void> {
    const now = new Date();
    const month = now.toISOString().slice(0, 7); // YYYY-MM
    const key = `${this.redisKeyPrefix}${provider}:${month}`;

    try {
      // Get current stats
      const currentData = await redis.get(key);
      const stats: UsageStats = currentData
        ? JSON.parse(currentData)
        : {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            totalTokensEstimated: 0,
            totalDurationMs: 0,
            averageDurationMs: 0,
          };

      // Update stats
      stats.totalRequests++;
      if (success) {
        stats.successfulRequests++;
      } else {
        stats.failedRequests++;
      }
      stats.totalTokensEstimated += promptTokens + completionTokens;
      stats.totalDurationMs += durationMs;
      stats.averageDurationMs = stats.totalDurationMs / stats.totalRequests;

      // Save to Redis (expire after 90 days)
      await redis.setex(key, 90 * 24 * 60 * 60, JSON.stringify(stats));

      // Claude-specific: Record session usage
      if (provider === 'claude') {
        await this.recordClaudeSession();
      }

      logger.debug({
        provider,
        month,
        totalRequests: stats.totalRequests,
        totalTokens: stats.totalTokensEstimated,
      }, 'Usage recorded');

      // Check for warnings (Gemini only - Claude warnings based on session windows)
      if (provider === 'gemini') {
        await this.checkQuotaWarnings(provider, stats);
      }
    } catch (error) {
      logger.error({ error, provider }, 'Failed to record usage');
    }
  }

  /**
   * Get usage stats for a provider
   */
  async getUsageStats(provider: LLMProviderType, month?: string): Promise<UsageStats | null> {
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    const key = `${this.redisKeyPrefix}${provider}:${targetMonth}`;

    try {
      const data = await redis.get(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (error) {
      logger.error({ error, provider }, 'Failed to get usage stats');
      return null;
    }
  }

  /**
   * Get quota information for a provider
   *
   * - Claude: Session windows (5h/7d) - no token limits
   * - Gemini: Token-based monthly quota
   */
  async getProviderQuota(provider: LLMProviderType): Promise<ProviderQuota | null> {
    const month = new Date().toISOString().slice(0, 7);
    const stats = await this.getUsageStats(provider, month);

    if (!stats) {
      return {
        provider,
        usedQuota: 0,
        lastUpdated: new Date(),
      };
    }

    const quota: ProviderQuota = {
      provider,
      usedQuota: stats.totalTokensEstimated,
      lastUpdated: new Date(),
    };

    // Claude: Add session window data
    if (provider === 'claude') {
      quota.sessionWindows = await this.getClaudeSessionWindows();
    }
    // Gemini: Add token-based quota
    else {
      const totalQuota = this.getQuotaLimitFromEnv(provider);
      quota.totalQuota = totalQuota;
      quota.remainingQuota = totalQuota ? totalQuota - stats.totalTokensEstimated : undefined;
      quota.resetDate = this.getQuotaResetDate();
    }

    return quota;
  }

  /**
   * Get quota limit from environment variables (optional configuration)
   * Note: Claude Code uses session windows (5h/7d), not monthly token limits
   */
  private getQuotaLimitFromEnv(provider: LLMProviderType): number | undefined {
    // Only Gemini uses token-based monthly quota
    if (provider === 'gemini') {
      const envVar = process.env.GEMINI_MONTHLY_QUOTA;
      return envVar ? parseInt(envVar, 10) : undefined;
    }
    // Claude Code doesn't expose max session requests - return undefined
    return undefined;
  }

  /**
   * Get session window data for Claude Code
   */
  private async getClaudeSessionWindows(): Promise<ProviderQuota['sessionWindows']> {
    const now = new Date();

    // 5-hour window
    const fiveHourKey = `${this.redisKeyPrefix}claude:session:5h`;
    const fiveHourData = await redis.get(fiveHourKey);
    const fiveHourRequests = fiveHourData ? parseInt(fiveHourData, 10) : 0;

    // Calculate window boundaries
    const currentHour = now.getHours();
    const fiveHourWindowStart = new Date(now);
    fiveHourWindowStart.setHours(Math.floor(currentHour / 5) * 5, 0, 0, 0);
    const fiveHourWindowEnd = new Date(fiveHourWindowStart);
    fiveHourWindowEnd.setHours(fiveHourWindowStart.getHours() + 5);

    // 7-day window
    const sevenDayKey = `${this.redisKeyPrefix}claude:session:7d`;
    const sevenDayData = await redis.get(sevenDayKey);
    const sevenDayRequests = sevenDayData ? parseInt(sevenDayData, 10) : 0;

    const sevenDayWindowStart = new Date(now);
    sevenDayWindowStart.setDate(now.getDate() - (now.getDay())); // Start of week
    sevenDayWindowStart.setHours(0, 0, 0, 0);
    const sevenDayWindowEnd = new Date(sevenDayWindowStart);
    sevenDayWindowEnd.setDate(sevenDayWindowStart.getDate() + 7);

    return {
      fiveHour: {
        requestsUsed: fiveHourRequests,
        maxRequests: undefined, // Claude doesn't expose this
        windowStart: fiveHourWindowStart,
        windowEnd: fiveHourWindowEnd,
      },
      sevenDay: {
        requestsUsed: sevenDayRequests,
        maxRequests: undefined,
        windowStart: sevenDayWindowStart,
        windowEnd: sevenDayWindowEnd,
      },
    };
  }

  /**
   * Record Claude session usage (instead of tokens)
   */
  private async recordClaudeSession(): Promise<void> {
    const now = new Date();

    // Increment 5-hour window counter
    const fiveHourKey = `${this.redisKeyPrefix}claude:session:5h`;
    const fiveHourTTL = 5 * 60 * 60; // 5 hours
    await redis.incr(fiveHourKey);
    await redis.expire(fiveHourKey, fiveHourTTL);

    // Increment 7-day window counter
    const sevenDayKey = `${this.redisKeyPrefix}claude:session:7d`;
    const sevenDayTTL = 7 * 24 * 60 * 60; // 7 days
    await redis.incr(sevenDayKey);
    await redis.expire(sevenDayKey, sevenDayTTL);

    logger.debug({ provider: 'claude' }, 'Claude session usage recorded');
  }

  /**
   * Calculate when quota resets (first day of next month)
   */
  private getQuotaResetDate(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  /**
   * Check if quota is running low and emit warnings
   */
  private async checkQuotaWarnings(provider: LLMProviderType, stats: UsageStats): Promise<void> {
    const totalQuota = this.getQuotaLimitFromEnv(provider);
    if (!totalQuota) return; // No quota configured, skip warnings

    const percentageUsed = (stats.totalTokensEstimated / totalQuota) * 100;

    let warning: QuotaWarning | null = null;

    if (percentageUsed >= 95) {
      warning = {
        provider,
        level: 'critical',
        message: `${provider.toUpperCase()} quota at ${percentageUsed.toFixed(1)}% - CRITICAL!`,
        percentageUsed,
        timestamp: new Date(),
      };
    } else if (percentageUsed >= 80) {
      warning = {
        provider,
        level: 'warning',
        message: `${provider.toUpperCase()} quota at ${percentageUsed.toFixed(1)}% - Consider switching providers`,
        percentageUsed,
        timestamp: new Date(),
      };
    } else if (percentageUsed >= 50) {
      warning = {
        provider,
        level: 'info',
        message: `${provider.toUpperCase()} quota at ${percentageUsed.toFixed(1)}%`,
        percentageUsed,
        timestamp: new Date(),
      };
    }

    if (warning) {
      // Map warning levels to logger methods
      const logMethod = warning.level === 'critical' ? 'error' : warning.level === 'warning' ? 'warn' : 'info';
      logger[logMethod]({ warning }, 'Quota warning');

      // Publish warning to Redis for dashboard
      await redis.publish('channel:quota:warning', JSON.stringify(warning));
    }
  }

  /**
   * Check if provider has sufficient quota
   */
  async hasAvailableQuota(provider: LLMProviderType, estimatedTokens: number = 1000): Promise<boolean> {
    const quota = await this.getProviderQuota(provider);

    if (!quota || !quota.totalQuota) {
      // No quota limit configured - assume available
      return true;
    }

    if (!quota.remainingQuota) {
      return true; // Unknown remaining - assume available
    }

    // Check if remaining quota can handle estimated tokens
    return quota.remainingQuota >= estimatedTokens;
  }

  /**
   * Get all provider quotas
   */
  async getAllQuotas(): Promise<Record<LLMProviderType, ProviderQuota | null>> {
    const [claudeQuota, geminiQuota, openaiQuota] = await Promise.all([
      this.getProviderQuota('claude'),
      this.getProviderQuota('gemini'),
      this.getProviderQuota('openai'),
    ]);

    return {
      claude: claudeQuota,
      gemini: geminiQuota,
      openai: openaiQuota,
    };
  }

  /**
   * Get usage comparison between providers
   */
  async getUsageComparison(): Promise<{
    claude: UsageStats | null;
    gemini: UsageStats | null;
    openai: UsageStats | null;
    total: {
      requests: number;
      tokens: number;
      avgDuration: number;
    };
  }> {
    const month = new Date().toISOString().slice(0, 7);
    const [claudeStats, geminiStats, openaiStats] = await Promise.all([
      this.getUsageStats('claude', month),
      this.getUsageStats('gemini', month),
      this.getUsageStats('openai', month),
    ]);

    const totalRequests = (claudeStats?.totalRequests || 0) + (geminiStats?.totalRequests || 0) + (openaiStats?.totalRequests || 0);
    const totalTokens = (claudeStats?.totalTokensEstimated || 0) + (geminiStats?.totalTokensEstimated || 0) + (openaiStats?.totalTokensEstimated || 0);
    const totalDuration = (claudeStats?.totalDurationMs || 0) + (geminiStats?.totalDurationMs || 0) + (openaiStats?.totalDurationMs || 0);

    return {
      claude: claudeStats,
      gemini: geminiStats,
      openai: openaiStats,
      total: {
        requests: totalRequests,
        tokens: totalTokens,
        avgDuration: totalRequests > 0 ? totalDuration / totalRequests : 0,
      },
    };
  }
}

// Export singleton instance
export const quotaManager = new QuotaManager();
