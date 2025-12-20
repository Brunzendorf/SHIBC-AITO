/**
 * Image Storage Utilities
 * Handles saving generated images to different destinations
 */

import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../logger.js';

const logger = createLogger('image-storage');

export interface ImageStorageOptions {
  destination: 'workspace' | 'directus' | 'github';
  filename?: string;
  metadata?: {
    agent?: string;
    prompt?: string;
    timestamp?: number;
  };
}

/**
 * Save Base64 image to workspace
 */
export async function saveImageToWorkspace(
  base64Data: string,
  filename: string,
  subdir: string = 'images'
): Promise<string> {
  const workspaceDir = process.env.WORKSPACE_DIR || '/app/workspace';
  const imageDir = path.join(workspaceDir, subdir);

  // Create directory if it doesn't exist
  await fs.mkdir(imageDir, { recursive: true });

  const buffer = Buffer.from(base64Data, 'base64');
  const filepath = path.join(imageDir, filename);

  await fs.writeFile(filepath, buffer);

  logger.info({ filepath, size: buffer.length }, 'Image saved to workspace');
  return filepath;
}

/**
 * Upload image to Directus CMS
 * Useful for CMO agent to manage marketing assets
 */
export async function uploadImageToDirectus(
  base64Data: string,
  filename: string,
  metadata?: Record<string, any>
): Promise<string | null> {
  const directusUrl = process.env.DIRECTUS_URL;
  const directusToken = process.env.DIRECTUS_TOKEN;

  if (!directusUrl || !directusToken) {
    logger.warn('Directus credentials not configured, skipping upload');
    return null;
  }

  try {
    const buffer = Buffer.from(base64Data, 'base64');

    // Create FormData for file upload
    const formData = new FormData();
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    formData.append('file', blob, filename);

    if (metadata) {
      formData.append('title', metadata.title || filename);
      formData.append('description', metadata.description || '');
    }

    const response = await fetch(`${directusUrl}/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${directusToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Directus upload failed: ${response.statusText}`);
    }

    const result = await response.json() as { data?: { id?: string } };
    const fileId = result.data?.id;
    const publicUrl = `${directusUrl}/assets/${fileId}`;

    logger.info({ publicUrl, fileId }, 'Image uploaded to Directus');
    return publicUrl;
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to upload to Directus');
    return null;
  }
}

/**
 * Commit image to GitHub repository
 * Useful for documentation and website assets
 */
export async function commitImageToGithub(
  base64Data: string,
  filename: string,
  commitMessage: string = 'Add generated image'
): Promise<string | null> {
  const workspaceDir = process.env.WORKSPACE_DIR || '/app/workspace';
  const imageDir = path.join(workspaceDir, 'assets', 'images');

  try {
    // Save to workspace first
    await fs.mkdir(imageDir, { recursive: true });
    const filepath = path.join(imageDir, filename);
    const buffer = Buffer.from(base64Data, 'base64');
    await fs.writeFile(filepath, buffer);

    logger.info({ filepath }, 'Image saved for git commit');

    // Note: Actual git commit should be handled by workspace.ts
    // This just prepares the file in the workspace
    return filepath;
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to prepare image for GitHub');
    return null;
  }
}

/**
 * Smart image storage - automatically chooses destination based on context
 */
export async function storeImage(
  base64Data: string,
  options: ImageStorageOptions
): Promise<{ filepath?: string; url?: string }> {
  const timestamp = Date.now();
  const filename = options.filename || `image-${timestamp}.jpg`;

  const result: { filepath?: string; url?: string } = {};

  switch (options.destination) {
    case 'workspace':
      result.filepath = await saveImageToWorkspace(base64Data, filename);
      break;

    case 'directus': {
      const url = await uploadImageToDirectus(base64Data, filename, options.metadata);
      result.url = url ?? undefined;
      // Fallback to workspace if Directus fails
      if (!url) {
        result.filepath = await saveImageToWorkspace(base64Data, filename);
      }
      break;
    }

    case 'github': {
      const filepath = await commitImageToGithub(base64Data, filename);
      result.filepath = filepath ?? undefined;
      break;
    }
  }

  return result;
}
