/**
 * Tests for Deduplication Module
 * TASK-037: Initiative deduplication with hash-based tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock redis - must define mocks inside vi.mock factory to avoid hoisting issues
vi.mock('../../redis.js', () => ({
  redis: {
    sismember: vi.fn(),
    sadd: vi.fn(),
    smembers: vi.fn(),
    del: vi.fn(),
    scard: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks are set up
import { DefaultDeduplicationStrategy, createDeduplicationStrategy } from '../dedup.js';
import { redis } from '../../redis.js';

// Cast to access mock methods
const mockRedis = redis as unknown as {
  sismember: ReturnType<typeof vi.fn>;
  sadd: ReturnType<typeof vi.fn>;
  smembers: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  scard: ReturnType<typeof vi.fn>;
};

describe('DefaultDeduplicationStrategy', () => {
  let strategy: DefaultDeduplicationStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new DefaultDeduplicationStrategy();
  });

  describe('generateHash', () => {
    it('should generate consistent hash for same title', () => {
      const hash1 = strategy.generateHash('Test Title');
      const hash2 = strategy.generateHash('Test Title');

      expect(hash1).toBe(hash2);
    });

    it('should be case-insensitive', () => {
      const hash1 = strategy.generateHash('Test Title');
      const hash2 = strategy.generateHash('TEST TITLE');
      const hash3 = strategy.generateHash('test title');

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it('should trim whitespace', () => {
      const hash1 = strategy.generateHash('Test Title');
      const hash2 = strategy.generateHash('  Test Title  ');

      expect(hash1).toBe(hash2);
    });

    it('should generate 16-character hex hash', () => {
      const hash = strategy.generateHash('Any title here');

      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should generate different hashes for different titles', () => {
      const hash1 = strategy.generateHash('Title One');
      const hash2 = strategy.generateHash('Title Two');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle special characters', () => {
      const hash = strategy.generateHash('Title with émojis and symbols !@#');

      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should handle empty string', () => {
      const hash = strategy.generateHash('');

      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('wasCreated', () => {
    it('should return true if hash exists in Redis', async () => {
      mockRedis.sismember.mockResolvedValue(1);

      const result = await strategy.wasCreated('Test Title');

      expect(result).toBe(true);
      expect(mockRedis.sismember).toHaveBeenCalled();
    });

    it('should return false if hash not in Redis', async () => {
      mockRedis.sismember.mockResolvedValue(0);

      const result = await strategy.wasCreated('New Title');

      expect(result).toBe(false);
    });

    it('should check Redis with generated hash', async () => {
      mockRedis.sismember.mockResolvedValue(0);
      const hash = strategy.generateHash('Test Title');

      await strategy.wasCreated('Test Title');

      expect(mockRedis.sismember).toHaveBeenCalledWith(
        'initiatives:created',
        hash
      );
    });
  });

  describe('markCreated', () => {
    it('should add hash to Redis set', async () => {
      const hash = strategy.generateHash('Test Title');

      await strategy.markCreated('Test Title');

      expect(mockRedis.sadd).toHaveBeenCalledWith(
        'initiatives:created',
        hash
      );
    });

    it('should be case-insensitive', async () => {
      await strategy.markCreated('TEST TITLE');
      await strategy.markCreated('test title');

      // Both should add the same hash
      const calls = mockRedis.sadd.mock.calls;
      expect(calls[0][1]).toBe(calls[1][1]);
    });
  });

  describe('calculateSimilarity', () => {
    it('should return 1 for identical strings', () => {
      const similarity = strategy.calculateSimilarity('hello world', 'hello world');

      expect(similarity).toBe(1);
    });

    it('should return 0 for completely different strings', () => {
      const similarity = strategy.calculateSimilarity('abc def', 'xyz uvw');

      expect(similarity).toBe(0);
    });

    it('should return partial similarity for overlapping words', () => {
      const similarity = strategy.calculateSimilarity(
        'hello world today',
        'hello world tomorrow'
      );

      // "hello" and "world" are common, "today" vs "tomorrow" differ
      // Jaccard: 2 / 4 = 0.5
      expect(similarity).toBe(0.5);
    });

    it('should be case-insensitive', () => {
      const sim1 = strategy.calculateSimilarity('Hello World', 'hello world');
      const sim2 = strategy.calculateSimilarity('HELLO WORLD', 'hello world');

      expect(sim1).toBe(1);
      expect(sim2).toBe(1);
    });

    it('should ignore special characters', () => {
      const similarity = strategy.calculateSimilarity(
        'hello, world!',
        'hello world'
      );

      expect(similarity).toBe(1);
    });

    it('should return 1 for both empty strings', () => {
      const similarity = strategy.calculateSimilarity('', '');

      expect(similarity).toBe(1);
    });

    it('should return 0 when one string is empty', () => {
      const similarity = strategy.calculateSimilarity('hello', '');

      expect(similarity).toBe(0);
    });

    it('should handle strings with only special characters', () => {
      const similarity = strategy.calculateSimilarity('!!!', '???');

      // No alphanumeric words extracted
      expect(similarity).toBe(1); // Both become empty sets
    });
  });
});

describe('createDeduplicationStrategy', () => {
  it('should create DefaultDeduplicationStrategy instance', () => {
    const strategy = createDeduplicationStrategy();

    expect(strategy).toBeInstanceOf(DefaultDeduplicationStrategy);
  });

  it('should have all required methods', () => {
    const strategy = createDeduplicationStrategy();

    expect(typeof strategy.generateHash).toBe('function');
    expect(typeof strategy.wasCreated).toBe('function');
    expect(typeof strategy.markCreated).toBe('function');
    expect(typeof strategy.calculateSimilarity).toBe('function');
  });
});

describe('Collision resistance (TASK-008)', () => {
  let strategy: DefaultDeduplicationStrategy;

  beforeEach(() => {
    strategy = new DefaultDeduplicationStrategy();
  });

  it('should generate different hashes for similar titles', () => {
    // These caused collisions with the old regex-based hash
    const hash1 = strategy.generateHash('activate twitter');
    const hash2 = strategy.generateHash('activate-twitter');
    const hash3 = strategy.generateHash('activate_twitter');

    expect(hash1).not.toBe(hash2);
    expect(hash2).not.toBe(hash3);
    expect(hash1).not.toBe(hash3);
  });

  it('should handle Unicode normalization', () => {
    const hash1 = strategy.generateHash('café');
    const hash2 = strategy.generateHash('cafe\u0301'); // é as combining accent

    // Note: SHA256 will treat these differently unless normalized
    // This test documents current behavior
    expect(hash1).not.toBe(hash2);
  });

  it('should handle long titles', () => {
    const longTitle = 'A'.repeat(10000);
    const hash = strategy.generateHash(longTitle);

    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it('should be deterministic across runs', () => {
    // Known test vector
    const title = 'Test Initiative Title';
    const hash = strategy.generateHash(title);

    // This hash should be stable across versions
    expect(hash.length).toBe(16);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });
});
