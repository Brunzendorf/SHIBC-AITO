/**
 * Image Cache & Reuse System
 * Check for existing images before generating new ones
 */

import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../logger.js';
import { redis } from '../redis.js';

const logger = createLogger('image-cache');

/**
 * Image metadata for caching
 */
export interface ImageMetadata {
  filepath: string;
  filename: string;
  createdAt: number;
  agentRole: string;
  template?: string;
  tags?: string[];
  eventType?: string;        // e.g., "price-milestone", "partnership", "announcement"
  description?: string;
  model?: string;
  brandingType?: string;     // e.g., "logo-watermark", "text-footer"
}

/**
 * Search criteria for finding existing images
 */
export interface ImageSearchCriteria {
  template?: string;
  eventType?: string;
  tags?: string[];
  maxAgeHours?: number;      // Only return images younger than X hours
  agentRole?: string;
}

/**
 * Save image metadata to Redis
 */
export async function saveImageMetadata(metadata: ImageMetadata): Promise<void> {
  const key = `image:metadata:${metadata.filename}`;
  await redis.setex(key, 60 * 60 * 24 * 30, JSON.stringify(metadata)); // 30 days TTL

  // Add to searchable index
  if (metadata.eventType) {
    const indexKey = `image:index:event:${metadata.eventType}`;
    await redis.sadd(indexKey, metadata.filename);
    await redis.expire(indexKey, 60 * 60 * 24 * 30);
  }

  if (metadata.template) {
    const indexKey = `image:index:template:${metadata.template}`;
    await redis.sadd(indexKey, metadata.filename);
    await redis.expire(indexKey, 60 * 60 * 24 * 30);
  }

  if (metadata.tags) {
    for (const tag of metadata.tags) {
      const indexKey = `image:index:tag:${tag}`;
      await redis.sadd(indexKey, metadata.filename);
      await redis.expire(indexKey, 60 * 60 * 24 * 30);
    }
  }

  logger.info({ filename: metadata.filename, eventType: metadata.eventType }, 'Image metadata saved');
}

/**
 * Search for existing images matching criteria
 */
export async function findExistingImages(
  criteria: ImageSearchCriteria
): Promise<ImageMetadata[]> {
  const candidates: Set<string> = new Set();

  // Search by event type
  if (criteria.eventType) {
    const indexKey = `image:index:event:${criteria.eventType}`;
    const filenames = await redis.smembers(indexKey);
    filenames.forEach((f: string) => candidates.add(f));
  }

  // Search by template
  if (criteria.template) {
    const indexKey = `image:index:template:${criteria.template}`;
    const filenames = await redis.smembers(indexKey);
    filenames.forEach((f: string) => candidates.add(f));
  }

  // Search by tags
  if (criteria.tags && criteria.tags.length > 0) {
    for (const tag of criteria.tags) {
      const indexKey = `image:index:tag:${tag}`;
      const filenames = await redis.smembers(indexKey);
      filenames.forEach((f: string) => candidates.add(f));
    }
  }

  // If no criteria, return empty
  if (candidates.size === 0) {
    return [];
  }

  // Load metadata for all candidates
  const results: ImageMetadata[] = [];
  const now = Date.now();
  const maxAge = criteria.maxAgeHours ? criteria.maxAgeHours * 60 * 60 * 1000 : Infinity;

  for (const filename of candidates) {
    const key = `image:metadata:${filename}`;
    const data = await redis.get(key);
    if (!data) continue;

    const metadata = JSON.parse(data) as ImageMetadata;

    // Filter by age
    if (now - metadata.createdAt > maxAge) continue;

    // Filter by agent role if specified
    if (criteria.agentRole && metadata.agentRole !== criteria.agentRole) continue;

    // Check if file still exists
    try {
      await fs.access(metadata.filepath);
      results.push(metadata);
    } catch {
      logger.warn({ filepath: metadata.filepath }, 'Cached image file not found, skipping');
    }
  }

  // Sort by creation time (newest first)
  results.sort((a, b) => b.createdAt - a.createdAt);

  logger.info({
    criteria,
    candidatesFound: candidates.size,
    resultsAfterFilter: results.length,
  }, 'Image search completed');

  return results;
}

/**
 * Check if suitable image already exists
 */
export async function checkExistingImage(
  criteria: ImageSearchCriteria
): Promise<{ exists: boolean; image?: ImageMetadata; reason?: string }> {
  const images = await findExistingImages(criteria);

  if (images.length === 0) {
    return { exists: false, reason: 'No matching images found' };
  }

  const bestMatch = images[0]; // Newest matching image
  const ageHours = (Date.now() - bestMatch.createdAt) / (1000 * 60 * 60);

  logger.info({
    filename: bestMatch.filename,
    ageHours: ageHours.toFixed(1),
    eventType: bestMatch.eventType,
  }, 'Existing image found');

  return {
    exists: true,
    image: bestMatch,
    reason: `Found existing ${bestMatch.eventType} image (${ageHours.toFixed(1)}h old)`,
  };
}

/**
 * List all cached images in workspace
 */
export async function listCachedImages(workspaceDir: string = './workspace'): Promise<ImageMetadata[]> {
  const imageDir = path.join(workspaceDir, 'images');

  try {
    const files = await fs.readdir(imageDir);
    const images: ImageMetadata[] = [];

    for (const file of files) {
      if (!file.match(/\.(jpg|jpeg|png)$/i)) continue;

      const key = `image:metadata:${file}`;
      const data = await redis.get(key);

      if (data) {
        images.push(JSON.parse(data) as ImageMetadata);
      }
    }

    return images.sort((a, b) => b.createdAt - a.createdAt);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to list cached images');
    return [];
  }
}

/**
 * Clean old image metadata from Redis
 */
export async function cleanOldImageMetadata(maxAgeDays: number = 30): Promise<number> {
  const pattern = 'image:metadata:*';
  const keys = await redis.keys(pattern);
  const now = Date.now();
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  for (const key of keys) {
    const data = await redis.get(key);
    if (!data) continue;

    const metadata = JSON.parse(data) as ImageMetadata;
    if (now - metadata.createdAt > maxAge) {
      await redis.del(key);
      deleted++;
    }
  }

  logger.info({ deleted, maxAgeDays }, 'Cleaned old image metadata');
  return deleted;
}
