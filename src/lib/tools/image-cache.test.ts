/**
 * Tests for Image Cache System
 * TASK-040: Test Redis-based image caching
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to define mock before vi.mock hoisting
const { mockRedis, mockFs } = vi.hoisted(() => ({
  mockRedis: {
    setex: vi.fn().mockResolvedValue('OK'),
    sadd: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
  },
  mockFs: {
    access: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../redis.js', () => ({
  redis: mockRedis,
}));

// Mock fs
vi.mock('fs/promises', () => ({
  default: mockFs,
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
  saveImageMetadata,
  findExistingImages,
  checkExistingImage,
  listCachedImages,
  cleanOldImageMetadata,
  type ImageMetadata,
  type ImageSearchCriteria,
} from './image-cache.js';

describe('saveImageMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should save metadata to Redis with 30 day TTL', async () => {
    const metadata: ImageMetadata = {
      filepath: '/images/test.jpg',
      filename: 'test.jpg',
      createdAt: Date.now(),
      agentRole: 'cmo',
    };

    await saveImageMetadata(metadata);

    expect(mockRedis.setex).toHaveBeenCalledWith(
      'image:metadata:test.jpg',
      60 * 60 * 24 * 30, // 30 days
      expect.any(String)
    );
  });

  it('should add to event type index', async () => {
    const metadata: ImageMetadata = {
      filepath: '/images/test.jpg',
      filename: 'test.jpg',
      createdAt: Date.now(),
      agentRole: 'cmo',
      eventType: 'price-milestone',
    };

    await saveImageMetadata(metadata);

    expect(mockRedis.sadd).toHaveBeenCalledWith(
      'image:index:event:price-milestone',
      'test.jpg'
    );
    expect(mockRedis.expire).toHaveBeenCalled();
  });

  it('should add to template index', async () => {
    const metadata: ImageMetadata = {
      filepath: '/images/test.jpg',
      filename: 'test.jpg',
      createdAt: Date.now(),
      agentRole: 'cmo',
      template: 'twitter-post',
    };

    await saveImageMetadata(metadata);

    expect(mockRedis.sadd).toHaveBeenCalledWith(
      'image:index:template:twitter-post',
      'test.jpg'
    );
  });

  it('should add to tag indexes', async () => {
    const metadata: ImageMetadata = {
      filepath: '/images/test.jpg',
      filename: 'test.jpg',
      createdAt: Date.now(),
      agentRole: 'cmo',
      tags: ['marketing', 'milestone'],
    };

    await saveImageMetadata(metadata);

    expect(mockRedis.sadd).toHaveBeenCalledWith(
      'image:index:tag:marketing',
      'test.jpg'
    );
    expect(mockRedis.sadd).toHaveBeenCalledWith(
      'image:index:tag:milestone',
      'test.jpg'
    );
  });
});

describe('findExistingImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when no matches', async () => {
    mockRedis.smembers.mockResolvedValue([]);

    const results = await findExistingImages({ eventType: 'unknown' });

    expect(results).toEqual([]);
  });

  it('should search by event type', async () => {
    mockRedis.smembers.mockResolvedValue(['image1.jpg', 'image2.jpg']);
    mockRedis.get
      .mockResolvedValueOnce(
        JSON.stringify({
          filepath: '/images/image1.jpg',
          filename: 'image1.jpg',
          createdAt: Date.now(),
          agentRole: 'cmo',
          eventType: 'price-milestone',
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          filepath: '/images/image2.jpg',
          filename: 'image2.jpg',
          createdAt: Date.now(),
          agentRole: 'cmo',
          eventType: 'price-milestone',
        })
      );

    const results = await findExistingImages({ eventType: 'price-milestone' });

    expect(mockRedis.smembers).toHaveBeenCalledWith(
      'image:index:event:price-milestone'
    );
    expect(results).toHaveLength(2);
  });

  it('should filter by max age', async () => {
    const now = Date.now();
    mockRedis.smembers.mockResolvedValue(['old.jpg', 'new.jpg']);
    mockRedis.get
      .mockResolvedValueOnce(
        JSON.stringify({
          filepath: '/images/old.jpg',
          filename: 'old.jpg',
          createdAt: now - 48 * 60 * 60 * 1000, // 48 hours ago
          agentRole: 'cmo',
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          filepath: '/images/new.jpg',
          filename: 'new.jpg',
          createdAt: now - 1 * 60 * 60 * 1000, // 1 hour ago
          agentRole: 'cmo',
        })
      );

    const results = await findExistingImages({
      eventType: 'test',
      maxAgeHours: 24,
    });

    // Only new.jpg should be returned (1 hour old)
    expect(results).toHaveLength(1);
    expect(results[0].filename).toBe('new.jpg');
  });

  it('should filter by agent role', async () => {
    const now = Date.now();
    mockRedis.smembers.mockResolvedValue(['cmo-image.jpg', 'cto-image.jpg']);
    mockRedis.get
      .mockResolvedValueOnce(
        JSON.stringify({
          filepath: '/images/cmo-image.jpg',
          filename: 'cmo-image.jpg',
          createdAt: now,
          agentRole: 'cmo',
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          filepath: '/images/cto-image.jpg',
          filename: 'cto-image.jpg',
          createdAt: now,
          agentRole: 'cto',
        })
      );

    const results = await findExistingImages({
      eventType: 'test',
      agentRole: 'cmo',
    });

    expect(results).toHaveLength(1);
    expect(results[0].agentRole).toBe('cmo');
  });
});

describe('checkExistingImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return exists: false when no matches', async () => {
    mockRedis.smembers.mockResolvedValue([]);

    const result = await checkExistingImage({ eventType: 'unknown' });

    expect(result.exists).toBe(false);
    expect(result.reason).toContain('No matching');
  });

  it('should return exists: true with best match', async () => {
    const now = Date.now();
    mockRedis.smembers.mockResolvedValue(['image.jpg']);
    mockRedis.get.mockResolvedValue(
      JSON.stringify({
        filepath: '/images/image.jpg',
        filename: 'image.jpg',
        createdAt: now - 3600000, // 1 hour ago
        agentRole: 'cmo',
        eventType: 'price-milestone',
      })
    );

    const result = await checkExistingImage({ eventType: 'price-milestone' });

    expect(result.exists).toBe(true);
    expect(result.image).toBeDefined();
    expect(result.image?.filename).toBe('image.jpg');
  });
});

describe('listCachedImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when no images', async () => {
    mockFs.readdir.mockResolvedValue([]);

    const results = await listCachedImages('/workspace');

    expect(results).toEqual([]);
  });

  it('should filter non-image files', async () => {
    mockFs.readdir.mockResolvedValue(['test.txt', 'image.jpg', 'doc.pdf']);
    mockRedis.get.mockResolvedValue(
      JSON.stringify({
        filepath: '/workspace/images/image.jpg',
        filename: 'image.jpg',
        createdAt: Date.now(),
        agentRole: 'cmo',
      })
    );

    const results = await listCachedImages('/workspace');

    expect(results).toHaveLength(1);
    expect(results[0].filename).toBe('image.jpg');
  });

  it('should handle readdir errors gracefully', async () => {
    mockFs.readdir.mockRejectedValue(new Error('Directory not found'));

    const results = await listCachedImages('/nonexistent');

    expect(results).toEqual([]);
  });
});

describe('cleanOldImageMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delete old metadata', async () => {
    const oldDate = Date.now() - 40 * 24 * 60 * 60 * 1000; // 40 days ago
    mockRedis.keys.mockResolvedValue(['image:metadata:old.jpg']);
    mockRedis.get.mockResolvedValue(
      JSON.stringify({
        filepath: '/images/old.jpg',
        filename: 'old.jpg',
        createdAt: oldDate,
        agentRole: 'cmo',
      })
    );

    const deleted = await cleanOldImageMetadata(30);

    expect(mockRedis.del).toHaveBeenCalledWith('image:metadata:old.jpg');
    expect(deleted).toBe(1);
  });

  it('should not delete recent metadata', async () => {
    const recentDate = Date.now() - 5 * 24 * 60 * 60 * 1000; // 5 days ago
    mockRedis.keys.mockResolvedValue(['image:metadata:recent.jpg']);
    mockRedis.get.mockResolvedValue(
      JSON.stringify({
        filepath: '/images/recent.jpg',
        filename: 'recent.jpg',
        createdAt: recentDate,
        agentRole: 'cmo',
      })
    );

    const deleted = await cleanOldImageMetadata(30);

    expect(mockRedis.del).not.toHaveBeenCalled();
    expect(deleted).toBe(0);
  });
});
