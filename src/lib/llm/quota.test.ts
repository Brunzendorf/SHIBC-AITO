/**
 * Tests for LLM Quota Manager
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Redis
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn().mockResolvedValue('OK'),
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  publish: vi.fn().mockResolvedValue(1),
};

vi.mock('../redis.js', () => ({
  redis: mockRedis,
}));

// Mock logger
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Quota Manager', () => {
  let QuotaManager: typeof import('./quota.js').QuotaManager;
  let quotaManager: InstanceType<typeof QuotaManager>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Clear env vars
    delete process.env.GEMINI_MONTHLY_QUOTA;

    const quotaModule = await import('./quota.js');
    QuotaManager = quotaModule.QuotaManager;
    quotaManager = new QuotaManager();
  });

  afterEach(() => {
    delete process.env.GEMINI_MONTHLY_QUOTA;
  });

  describe('recordUsage', () => {
    it('should record first usage for provider', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      await quotaManager.recordUsage('gemini', 100, 50, 500, true);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('llm:quota:gemini:'),
        expect.any(Number),
        expect.stringContaining('"totalRequests":1')
      );
    });

    it('should update existing usage stats', async () => {
      const existingStats = {
        totalRequests: 5,
        successfulRequests: 4,
        failedRequests: 1,
        totalTokensEstimated: 500,
        totalDurationMs: 2500,
        averageDurationMs: 500,
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(existingStats));

      await quotaManager.recordUsage('gemini', 100, 50, 400, true);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.stringContaining('"totalRequests":6')
      );
    });

    it('should track failed requests', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      await quotaManager.recordUsage('gemini', 100, 0, 200, false);

      const savedData = JSON.parse(mockRedis.setex.mock.calls[0][2]);
      expect(savedData.failedRequests).toBe(1);
      expect(savedData.successfulRequests).toBe(0);
    });

    it('should record Claude session usage', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      await quotaManager.recordUsage('claude', 100, 50, 500, true);

      // Should increment 5-hour and 7-day counters
      expect(mockRedis.incr).toHaveBeenCalledWith(expect.stringContaining('claude:session:5h'));
      expect(mockRedis.incr).toHaveBeenCalledWith(expect.stringContaining('claude:session:7d'));
      expect(mockRedis.expire).toHaveBeenCalledTimes(2);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('Redis down'));

      await expect(
        quotaManager.recordUsage('gemini', 100, 50, 500, true)
      ).resolves.not.toThrow();
    });

    it('should check quota warnings for Gemini', async () => {
      process.env.GEMINI_MONTHLY_QUOTA = '1000';
      mockRedis.get.mockResolvedValueOnce(null);

      // Re-import to pick up env var
      vi.resetModules();
      const quotaModule = await import('./quota.js');
      const manager = new quotaModule.QuotaManager();

      await manager.recordUsage('gemini', 800, 200, 500, true);

      // Should publish warning since usage > 50%
      expect(mockRedis.publish).toHaveBeenCalled();
    });
  });

  describe('getUsageStats', () => {
    it('should return null when no data exists', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const stats = await quotaManager.getUsageStats('gemini');

      expect(stats).toBeNull();
    });

    it('should return parsed stats', async () => {
      const storedStats = {
        totalRequests: 10,
        successfulRequests: 9,
        failedRequests: 1,
        totalTokensEstimated: 1000,
        totalDurationMs: 5000,
        averageDurationMs: 500,
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(storedStats));

      const stats = await quotaManager.getUsageStats('gemini');

      expect(stats).toEqual(storedStats);
    });

    it('should accept custom month parameter', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      await quotaManager.getUsageStats('gemini', '2024-01');

      expect(mockRedis.get).toHaveBeenCalledWith('llm:quota:gemini:2024-01');
    });

    it('should handle Redis errors', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('Redis error'));

      const stats = await quotaManager.getUsageStats('gemini');

      expect(stats).toBeNull();
    });
  });

  describe('getProviderQuota', () => {
    it('should return default quota when no stats exist', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const quota = await quotaManager.getProviderQuota('gemini');

      expect(quota).toEqual({
        provider: 'gemini',
        usedQuota: 0,
        lastUpdated: expect.any(Date),
      });
    });

    it('should return Claude quota with session windows', async () => {
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({
        totalRequests: 5,
        totalTokensEstimated: 500,
      }));
      mockRedis.get.mockResolvedValueOnce('10'); // 5-hour count
      mockRedis.get.mockResolvedValueOnce('50'); // 7-day count

      const quota = await quotaManager.getProviderQuota('claude');

      expect(quota?.sessionWindows).toBeDefined();
      expect(quota?.sessionWindows?.fiveHour.requestsUsed).toBe(10);
      expect(quota?.sessionWindows?.sevenDay.requestsUsed).toBe(50);
    });

    it('should return Gemini quota with token-based info', async () => {
      process.env.GEMINI_MONTHLY_QUOTA = '100000';
      vi.resetModules();
      const quotaModule = await import('./quota.js');
      const manager = new quotaModule.QuotaManager();

      mockRedis.get.mockResolvedValueOnce(JSON.stringify({
        totalRequests: 5,
        totalTokensEstimated: 5000,
      }));

      const quota = await manager.getProviderQuota('gemini');

      expect(quota?.totalQuota).toBe(100000);
      expect(quota?.remainingQuota).toBe(95000);
      expect(quota?.resetDate).toBeDefined();
    });
  });

  describe('hasAvailableQuota', () => {
    it('should return true when no quota configured', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const available = await quotaManager.hasAvailableQuota('gemini', 1000);

      expect(available).toBe(true);
    });

    it('should return true when remaining quota is sufficient', async () => {
      process.env.GEMINI_MONTHLY_QUOTA = '100000';
      vi.resetModules();
      const quotaModule = await import('./quota.js');
      const manager = new quotaModule.QuotaManager();

      mockRedis.get.mockResolvedValueOnce(JSON.stringify({
        totalTokensEstimated: 50000,
      }));

      const available = await manager.hasAvailableQuota('gemini', 10000);

      expect(available).toBe(true);
    });

    it('should return false when remaining quota is insufficient', async () => {
      process.env.GEMINI_MONTHLY_QUOTA = '100000';
      vi.resetModules();
      const quotaModule = await import('./quota.js');
      const manager = new quotaModule.QuotaManager();

      mockRedis.get.mockResolvedValueOnce(JSON.stringify({
        totalTokensEstimated: 95000,
      }));

      const available = await manager.hasAvailableQuota('gemini', 10000);

      expect(available).toBe(false);
    });
  });

  describe('getAllQuotas', () => {
    it('should return quotas for all providers', async () => {
      mockRedis.get.mockResolvedValue(null);

      const quotas = await quotaManager.getAllQuotas();

      expect(quotas).toHaveProperty('claude');
      expect(quotas).toHaveProperty('gemini');
      expect(quotas).toHaveProperty('openai');
    });
  });

  describe('getUsageComparison', () => {
    it('should return comparison with totals', async () => {
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({
        totalRequests: 10,
        totalTokensEstimated: 1000,
        totalDurationMs: 5000,
      }));
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({
        totalRequests: 20,
        totalTokensEstimated: 2000,
        totalDurationMs: 8000,
      }));
      mockRedis.get.mockResolvedValueOnce(null); // OpenAI

      const comparison = await quotaManager.getUsageComparison();

      expect(comparison.total.requests).toBe(30);
      expect(comparison.total.tokens).toBe(3000);
      expect(comparison.total.avgDuration).toBeCloseTo(433.33, 0);
    });

    it('should handle empty stats', async () => {
      mockRedis.get.mockResolvedValue(null);

      const comparison = await quotaManager.getUsageComparison();

      expect(comparison.total.requests).toBe(0);
      expect(comparison.total.tokens).toBe(0);
      expect(comparison.total.avgDuration).toBe(0);
    });
  });

  describe('quota warnings', () => {
    it('should publish critical warning at 95%+ usage', async () => {
      process.env.GEMINI_MONTHLY_QUOTA = '1000';
      vi.resetModules();
      const quotaModule = await import('./quota.js');
      const manager = new quotaModule.QuotaManager();

      mockRedis.get.mockResolvedValueOnce(null);
      await manager.recordUsage('gemini', 950, 50, 500, true);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'channel:quota:warning',
        expect.stringContaining('"level":"critical"')
      );
    });

    it('should publish warning at 80%+ usage', async () => {
      process.env.GEMINI_MONTHLY_QUOTA = '1000';
      vi.resetModules();
      const quotaModule = await import('./quota.js');
      const manager = new quotaModule.QuotaManager();

      mockRedis.get.mockResolvedValueOnce(null);
      await manager.recordUsage('gemini', 800, 50, 500, true);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'channel:quota:warning',
        expect.stringContaining('"level":"warning"')
      );
    });

    it('should publish info at 50%+ usage', async () => {
      process.env.GEMINI_MONTHLY_QUOTA = '1000';
      vi.resetModules();
      const quotaModule = await import('./quota.js');
      const manager = new quotaModule.QuotaManager();

      mockRedis.get.mockResolvedValueOnce(null);
      await manager.recordUsage('gemini', 500, 50, 500, true);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'channel:quota:warning',
        expect.stringContaining('"level":"info"')
      );
    });
  });
});
