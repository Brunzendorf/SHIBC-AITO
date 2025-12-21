/**
 * Deduplication Module
 * TASK-037: Initiative deduplication with hash-based tracking
 */

import crypto from 'crypto';
import type { DeduplicationStrategy } from './types.js';
import { redis } from '../redis.js';
import { createLogger } from '../logger.js';

const logger = createLogger('initiative:dedup');

/**
 * Redis key for tracking created initiatives
 */
const INITIATIVE_CREATED_KEY = 'initiatives:created';

/**
 * Default deduplication strategy using SHA256 hashing
 */
export class DefaultDeduplicationStrategy implements DeduplicationStrategy {
  /**
   * Generate SHA256 hash for initiative title
   * TASK-008: Previous simple regex-based hash had collisions
   */
  generateHash(title: string): string {
    return crypto
      .createHash('sha256')
      .update(title.toLowerCase().trim())
      .digest('hex')
      .slice(0, 16); // 16 hex chars = 64 bits, sufficient for deduplication
  }

  /**
   * Check if initiative was already created
   */
  async wasCreated(title: string): Promise<boolean> {
    const hash = this.generateHash(title);
    const exists = await redis.sismember(INITIATIVE_CREATED_KEY, hash) === 1;

    if (exists) {
      logger.debug({ title }, 'Initiative found in dedup cache');
    }

    return exists;
  }

  /**
   * Mark initiative as created
   */
  async markCreated(title: string): Promise<void> {
    const hash = this.generateHash(title);
    await redis.sadd(INITIATIVE_CREATED_KEY, hash);
    logger.debug({ title, hash }, 'Initiative marked as created');
  }

  /**
   * Calculate Jaccard similarity between two strings
   * Returns value between 0 (no overlap) and 1 (identical)
   */
  calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().match(/[a-z0-9]+/g) || []);
    const wordsB = new Set(b.toLowerCase().match(/[a-z0-9]+/g) || []);

    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }
}

/**
 * Create default deduplication strategy
 */
export function createDeduplicationStrategy(): DeduplicationStrategy {
  return new DefaultDeduplicationStrategy();
}

/**
 * Utility: Get all created initiative hashes
 */
export async function getCreatedHashes(): Promise<string[]> {
  return redis.smembers(INITIATIVE_CREATED_KEY);
}

/**
 * Utility: Clear all deduplication tracking (for testing)
 */
export async function clearDeduplicationCache(): Promise<void> {
  await redis.del(INITIATIVE_CREATED_KEY);
  logger.warn('Deduplication cache cleared');
}

/**
 * Utility: Get count of created initiatives
 */
export async function getCreatedCount(): Promise<number> {
  return redis.scard(INITIATIVE_CREATED_KEY);
}
