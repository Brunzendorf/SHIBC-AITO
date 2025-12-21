/**
 * Tests for Image Quota System
 * TASK-040: Test quota management per agent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to define mock before vi.mock hoisting
const mockRedis = vi.hoisted(() => ({
  incr: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  setex: vi.fn().mockResolvedValue('OK'),
  expire: vi.fn().mockResolvedValue(1),
}));

vi.mock('../redis.js', () => ({
  redis: mockRedis,
}));

// Mock logger
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  IMAGE_QUOTAS,
  IMAGE_COSTS,
  canGenerateImage,
  recordImageGeneration,
  getImageUsageStats,
  getQuotaWarning,
} from './image-quota.js';

describe('IMAGE_QUOTAS', () => {
  it('should define quotas for all agent roles', () => {
    expect(IMAGE_QUOTAS.ceo).toBeDefined();
    expect(IMAGE_QUOTAS.cmo).toBeDefined();
    expect(IMAGE_QUOTAS.cto).toBeDefined();
    expect(IMAGE_QUOTAS.cfo).toBeDefined();
    expect(IMAGE_QUOTAS.coo).toBeDefined();
    expect(IMAGE_QUOTAS.cco).toBeDefined();
    expect(IMAGE_QUOTAS.dao).toBeDefined();
  });

  it('should give CMO the highest daily limit', () => {
    expect(IMAGE_QUOTAS.cmo.daily).toBeGreaterThan(IMAGE_QUOTAS.ceo.daily);
    expect(IMAGE_QUOTAS.cmo.daily).toBeGreaterThan(IMAGE_QUOTAS.cto.daily);
  });

  it('should restrict most agents to free models only', () => {
    expect(IMAGE_QUOTAS.cmo.freeModelOnly).toBe(false);
    expect(IMAGE_QUOTAS.cto.freeModelOnly).toBe(true);
    expect(IMAGE_QUOTAS.cfo.freeModelOnly).toBe(true);
  });
});

describe('IMAGE_COSTS', () => {
  it('should have cost for imagen model', () => {
    expect(IMAGE_COSTS['imagen-4.0-generate-001']).toBeGreaterThan(0);
  });

  it('should have free gemini model', () => {
    expect(IMAGE_COSTS['gemini-2.5-flash-image']).toBe(0);
  });
});

describe('canGenerateImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should allow when under limit', async () => {
    mockRedis.get.mockResolvedValue('5'); // 5 used

    const result = await canGenerateImage('cmo');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(15); // 20 - 5
  });

  it('should deny when at limit', async () => {
    mockRedis.get.mockResolvedValue('20'); // At limit for CMO

    const result = await canGenerateImage('cmo');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily limit');
  });

  it('should deny unknown agent role', async () => {
    const result = await canGenerateImage('unknown');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Unknown agent role');
  });

  it('should deny paid model for restricted agents', async () => {
    const result = await canGenerateImage('cto', 'imagen-4.0-generate-001');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('free models');
  });

  it('should allow paid model for CMO', async () => {
    mockRedis.get.mockResolvedValue('0');

    const result = await canGenerateImage('cmo', 'imagen-4.0-generate-001');

    expect(result.allowed).toBe(true);
  });

  it('should allow when no usage recorded', async () => {
    mockRedis.get.mockResolvedValue(null);

    const result = await canGenerateImage('cmo');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(20);
  });
});

describe('recordImageGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should increment usage counter', async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.get.mockResolvedValue('0');

    const result = await recordImageGeneration('cmo');

    expect(mockRedis.incr).toHaveBeenCalled();
    expect(result.count).toBe(1);
  });

  it('should set expiry on counter', async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.get.mockResolvedValue('0');

    await recordImageGeneration('cmo');

    expect(mockRedis.expire).toHaveBeenCalled();
  });

  it('should track cost for paid model', async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.get.mockResolvedValue('0');

    const result = await recordImageGeneration('cmo', 'imagen-4.0-generate-001');

    expect(result.cost).toBe(0.04);
    expect(mockRedis.setex).toHaveBeenCalled();
  });

  it('should track zero cost for free model', async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.get.mockResolvedValue('0');

    const result = await recordImageGeneration('cmo', 'gemini-2.5-flash-image');

    expect(result.cost).toBe(0);
  });
});

describe('getImageUsageStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return correct stats for used quota', async () => {
    mockRedis.get
      .mockResolvedValueOnce('10') // usage
      .mockResolvedValueOnce('0.4'); // cost

    const stats = await getImageUsageStats('cmo');

    expect(stats.used).toBe(10);
    expect(stats.limit).toBe(20);
    expect(stats.remaining).toBe(10);
    expect(stats.totalCost).toBe(0.4);
    expect(stats.usagePercent).toBe(50);
  });

  it('should return zeros for unknown agent', async () => {
    const stats = await getImageUsageStats('unknown');

    expect(stats.used).toBe(0);
    expect(stats.limit).toBe(0);
    expect(stats.remaining).toBe(0);
  });

  it('should cap remaining at 0 when over limit', async () => {
    mockRedis.get
      .mockResolvedValueOnce('25') // over limit
      .mockResolvedValueOnce('1.0');

    const stats = await getImageUsageStats('cmo');

    expect(stats.remaining).toBe(0);
  });
});

describe('getQuotaWarning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when usage is low', async () => {
    mockRedis.get
      .mockResolvedValueOnce('5') // 25% usage
      .mockResolvedValueOnce('0.2');

    const warning = await getQuotaWarning('cmo');

    expect(warning).toBeNull();
  });

  it('should warn at 80% usage', async () => {
    mockRedis.get
      .mockResolvedValueOnce('16') // 80% usage
      .mockResolvedValueOnce('0.64');

    const warning = await getQuotaWarning('cmo');

    expect(warning).toContain('80%');
    expect(warning).toContain('4 left');
  });

  it('should warn when limit reached', async () => {
    mockRedis.get
      .mockResolvedValueOnce('20') // 100% usage
      .mockResolvedValueOnce('0.8');

    const warning = await getQuotaWarning('cmo');

    expect(warning).toContain('REACHED');
  });
});

describe('quota integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should work with workflow: check -> record -> check', async () => {
    // First check: no usage
    mockRedis.get.mockResolvedValueOnce(null);
    const check1 = await canGenerateImage('cmo');
    expect(check1.allowed).toBe(true);
    expect(check1.remaining).toBe(20);

    // Record
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.get
      .mockResolvedValueOnce('0') // cost check
    await recordImageGeneration('cmo');

    // Second check: 1 used
    mockRedis.get.mockResolvedValueOnce('1');
    const check2 = await canGenerateImage('cmo');
    expect(check2.allowed).toBe(true);
    expect(check2.remaining).toBe(19);
  });
});
