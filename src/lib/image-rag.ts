/**
 * Image RAG (Retrieval-Augmented Generation for Images)
 * Uses vision models for image embeddings and Qdrant for vector storage
 */

import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';
import { llmConfig } from './config.js';

const logger = createLogger('image-rag');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const IMAGE_COLLECTION = 'aito_images';
const VISION_MODEL = 'llava';  // Ollama vision model for embeddings

/**
 * Image metadata for RAG
 */
export interface ImageRAGMetadata {
  filepath: string;
  filename: string;
  agentRole: string;
  template?: string;
  eventType?: string;
  tags?: string[];
  description?: string;
  brandingType?: string;
  createdAt: number;
  imageHash?: string;  // For duplicate detection
}

/**
 * Image search result
 */
export interface ImageSearchResult {
  metadata: ImageRAGMetadata;
  score: number;  // Similarity score (0-1)
  distance: number;
}

/**
 * Initialize Qdrant collection for images
 */
export async function initImageCollection(): Promise<void> {
  try {
    // Check if collection exists
    const checkResponse = await fetch(`${QDRANT_URL}/collections/${IMAGE_COLLECTION}`);

    if (checkResponse.ok) {
      logger.info('Image collection already exists');
      return;
    }

    // Create collection with vision model dimensions
    // LLaVA embeddings are typically 4096-dimensional
    const createPayload = {
      vectors: {
        size: 4096,
        distance: 'Cosine',
      },
      optimizers_config: {
        indexing_threshold: 10000,
      },
    };

    const response = await fetch(`${QDRANT_URL}/collections/${IMAGE_COLLECTION}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload),
    });

    if (!response.ok) {
      throw new Error(`Failed to create collection: ${await response.text()}`);
    }

    logger.info({ collection: IMAGE_COLLECTION }, 'Image collection created');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to initialize image collection');
    throw error;
  }
}

/**
 * Generate embedding for image using vision model
 */
export async function generateImageEmbedding(imagePath: string): Promise<number[]> {
  try {
    // Read image as base64
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');

    // Call Ollama with vision model to get embeddings
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        prompt: 'Analyze this image', // Vision models need a prompt
        images: [base64Image],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${await response.text()}`);
    }

    const result = await response.json() as any;
    return result.embedding;
  } catch (error: any) {
    logger.error({ error: error.message, imagePath }, 'Failed to generate image embedding');
    throw error;
  }
}

/**
 * Index image in Qdrant
 */
export async function indexImage(
  imagePath: string,
  metadata: ImageRAGMetadata
): Promise<void> {
  try {
    // Generate embedding
    logger.info({ filepath: imagePath }, 'Generating image embedding...');
    const embedding = await generateImageEmbedding(imagePath);

    // Create unique ID from filepath
    const id = Buffer.from(imagePath).toString('base64').replace(/[^a-zA-Z0-9]/g, '');

    // Upsert to Qdrant
    const point = {
      id,
      vector: embedding,
      payload: metadata,
    };

    const response = await fetch(
      `${QDRANT_URL}/collections/${IMAGE_COLLECTION}/points?wait=true`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: [point] }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to index image: ${await response.text()}`);
    }

    logger.info({ filename: metadata.filename, id }, 'Image indexed successfully');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to index image');
    throw error;
  }
}

/**
 * Search for visually similar images
 */
export async function searchSimilarImages(
  queryImagePath: string,
  options?: {
    limit?: number;
    filter?: {
      eventType?: string;
      agentRole?: string;
      tags?: string[];
      minScore?: number;
    };
  }
): Promise<ImageSearchResult[]> {
  try {
    // Generate embedding for query image
    const queryEmbedding = await generateImageEmbedding(queryImagePath);

    // Build filter
    const filter: any = {};
    if (options?.filter?.eventType) {
      filter.must = filter.must || [];
      filter.must.push({
        key: 'eventType',
        match: { value: options.filter.eventType },
      });
    }

    if (options?.filter?.agentRole) {
      filter.must = filter.must || [];
      filter.must.push({
        key: 'agentRole',
        match: { value: options.filter.agentRole },
      });
    }

    if (options?.filter?.tags && options.filter.tags.length > 0) {
      filter.must = filter.must || [];
      filter.must.push({
        key: 'tags',
        match: { any: options.filter.tags },
      });
    }

    // Search in Qdrant
    const searchPayload = {
      vector: queryEmbedding,
      limit: options?.limit || 10,
      with_payload: true,
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
    };

    const response = await fetch(
      `${QDRANT_URL}/collections/${IMAGE_COLLECTION}/points/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchPayload),
      }
    );

    if (!response.ok) {
      throw new Error(`Search failed: ${await response.text()}`);
    }

    const result = await response.json() as any;
    const results: ImageSearchResult[] = result.result.map((hit: any) => ({
      metadata: hit.payload as ImageRAGMetadata,
      score: hit.score,
      distance: 1 - hit.score,
    }));

    // Filter by minimum score if specified
    const minScore = options?.filter?.minScore || 0;
    const filtered = results.filter(r => r.score >= minScore);

    logger.info({
      queryImage: path.basename(queryImagePath),
      resultsFound: filtered.length,
      topScore: filtered[0]?.score,
    }, 'Image search completed');

    return filtered;
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to search similar images');
    throw error;
  }
}

/**
 * Search images by text description
 */
export async function searchImagesByText(
  textQuery: string,
  options?: {
    limit?: number;
    filter?: {
      eventType?: string;
      agentRole?: string;
    };
  }
): Promise<ImageSearchResult[]> {
  try {
    // Use vision model to generate embedding from text
    // This enables text-to-image search
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        prompt: textQuery,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to generate text embedding: ${await response.text()}`);
    }

    const result = await response.json() as any;
    const { embedding } = result;

    // Build filter
    const filter: any = {};
    if (options?.filter?.eventType) {
      filter.must = filter.must || [];
      filter.must.push({
        key: 'eventType',
        match: { value: options.filter.eventType },
      });
    }

    // Search in Qdrant
    const searchPayload = {
      vector: embedding,
      limit: options?.limit || 10,
      with_payload: true,
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
    };

    const searchResponse = await fetch(
      `${QDRANT_URL}/collections/${IMAGE_COLLECTION}/points/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchPayload),
      }
    );

    if (!searchResponse.ok) {
      throw new Error(`Search failed: ${await searchResponse.text()}`);
    }

    const searchResult = await searchResponse.json() as any;
    const results: ImageSearchResult[] = searchResult.result.map((hit: any) => ({
      metadata: hit.payload as ImageRAGMetadata,
      score: hit.score,
      distance: 1 - hit.score,
    }));

    logger.info({
      query: textQuery,
      resultsFound: results.length,
      topScore: results[0]?.score,
    }, 'Text-to-image search completed');

    return results;
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to search images by text');
    throw error;
  }
}

/**
 * Batch index all images in workspace
 */
export async function indexWorkspaceImages(workspaceDir: string = './workspace'): Promise<{
  indexed: number;
  failed: number;
  skipped: number;
}> {
  const imageDir = path.join(workspaceDir, 'images');
  let indexed = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const files = await fs.readdir(imageDir);

    for (const file of files) {
      if (!file.match(/\.(jpg|jpeg|png)$/i)) {
        skipped++;
        continue;
      }

      try {
        const filepath = path.join(imageDir, file);

        // Create basic metadata (can be enhanced with Redis metadata)
        const metadata: ImageRAGMetadata = {
          filepath,
          filename: file,
          agentRole: 'unknown',
          createdAt: Date.now(),
        };

        await indexImage(filepath, metadata);
        indexed++;

        logger.info({ file, progress: `${indexed}/${files.length}` }, 'Indexed image');
      } catch (error: any) {
        logger.error({ file, error: error.message }, 'Failed to index image');
        failed++;
      }
    }

    logger.info({ indexed, failed, skipped }, 'Batch indexing completed');
    return { indexed, failed, skipped };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to batch index images');
    throw error;
  }
}

/**
 * Delete image from RAG index
 */
export async function deleteImageFromRAG(filepath: string): Promise<void> {
  try {
    const id = Buffer.from(filepath).toString('base64').replace(/[^a-zA-Z0-9]/g, '');

    const response = await fetch(
      `${QDRANT_URL}/collections/${IMAGE_COLLECTION}/points/delete?wait=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: [id] }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete image from RAG: ${await response.text()}`);
    }

    logger.info({ filepath }, 'Image deleted from RAG');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to delete image from RAG');
    throw error;
  }
}
