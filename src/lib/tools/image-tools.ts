/**
 * Image Manipulation Tools for Designer Agent
 * Professional image editing capabilities
 */

import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../logger.js';

const logger = createLogger('image-tools');

/**
 * Tool: Resize Image
 */
export async function resizeImage(params: {
  inputPath: string;
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  outputPath?: string;
}): Promise<{ success: boolean; outputPath: string; dimensions: { width: number; height: number } }> {
  try {
    const { inputPath, width, height, fit = 'inside', outputPath } = params;

    const image = sharp(inputPath);
    const metadata = await image.metadata();

    // Resize
    const resized = image.resize(width, height, { fit });

    // Output path
    const output = outputPath || inputPath.replace(/(\.\w+)$/, `-resized${width || height}$1`);
    await resized.toFile(output);

    const newMetadata = await sharp(output).metadata();

    logger.info({ inputPath, outputPath: output, dimensions: { width: newMetadata.width, height: newMetadata.height } }, 'Image resized');

    return {
      success: true,
      outputPath: output,
      dimensions: { width: newMetadata.width!, height: newMetadata.height! },
    };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to resize image');
    throw error;
  }
}

/**
 * Tool: Crop Image
 */
export async function cropImage(params: {
  inputPath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  outputPath?: string;
}): Promise<{ success: boolean; outputPath: string }> {
  try {
    const { inputPath, x, y, width, height, outputPath } = params;

    const output = outputPath || inputPath.replace(/(\.\w+)$/, `-cropped$1`);

    await sharp(inputPath)
      .extract({ left: x, top: y, width, height })
      .toFile(output);

    logger.info({ inputPath, outputPath: output, crop: { x, y, width, height } }, 'Image cropped');

    return { success: true, outputPath: output };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to crop image');
    throw error;
  }
}

/**
 * Tool: Adjust Colors
 */
export async function adjustColors(params: {
  inputPath: string;
  brightness?: number;  // 0-2 (1 = no change)
  saturation?: number;  // 0-2 (1 = no change)
  contrast?: number;    // 0-2 (1 = no change)
  hue?: number;         // 0-360 degrees rotation
  outputPath?: string;
}): Promise<{ success: boolean; outputPath: string }> {
  try {
    const { inputPath, brightness, saturation, contrast, hue, outputPath } = params;

    let image = sharp(inputPath);

    // Apply modulate (brightness, saturation, hue)
    if (brightness !== undefined || saturation !== undefined || hue !== undefined) {
      image = image.modulate({
        brightness,
        saturation,
        hue,
      });
    }

    // Apply linear (contrast)
    if (contrast !== undefined && contrast !== 1) {
      const a = contrast;
      const b = 128 * (1 - a); // Center at mid-gray
      image = image.linear(a, b);
    }

    const output = outputPath || inputPath.replace(/(\.\w+)$/, `-adjusted$1`);
    await image.toFile(output);

    logger.info({ inputPath, outputPath: output, adjustments: { brightness, saturation, contrast, hue } }, 'Colors adjusted');

    return { success: true, outputPath: output };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to adjust colors');
    throw error;
  }
}

/**
 * Tool: Apply Filter
 */
export async function applyFilter(params: {
  inputPath: string;
  filter: 'grayscale' | 'sepia' | 'blur' | 'sharpen' | 'negative';
  intensity?: number;  // 0-1 for blur
  outputPath?: string;
}): Promise<{ success: boolean; outputPath: string }> {
  try {
    const { inputPath, filter, intensity = 0.5, outputPath } = params;

    let image = sharp(inputPath);

    switch (filter) {
      case 'grayscale':
        image = image.grayscale();
        break;

      case 'sepia':
        // Sepia tone: tint with warm brown
        image = image.tint({ r: 112, g: 66, b: 20 });
        break;

      case 'blur':
        const sigma = intensity * 10; // 0-10 blur strength
        image = image.blur(sigma);
        break;

      case 'sharpen':
        image = image.sharpen();
        break;

      case 'negative':
        image = image.negate();
        break;
    }

    const output = outputPath || inputPath.replace(/(\.\w+)$/, `-${filter}$1`);
    await image.toFile(output);

    logger.info({ inputPath, outputPath: output, filter }, 'Filter applied');

    return { success: true, outputPath: output };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to apply filter');
    throw error;
  }
}

/**
 * Tool: Combine Images (Collage)
 */
export async function combineImages(params: {
  images: Array<{ path: string; x: number; y: number; width?: number; height?: number }>;
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor?: string;
  outputPath: string;
}): Promise<{ success: boolean; outputPath: string }> {
  try {
    const { images, canvasWidth, canvasHeight, backgroundColor = '#FFFFFF', outputPath } = params;

    // Create canvas
    const canvas = sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: backgroundColor,
      },
    });

    // Prepare composite layers
    const layers = await Promise.all(
      images.map(async (img) => {
        let image = sharp(img.path);

        // Resize if specified
        if (img.width || img.height) {
          image = image.resize(img.width, img.height, { fit: 'cover' });
        }

        return {
          input: await image.toBuffer(),
          top: img.y,
          left: img.x,
        };
      })
    );

    // Composite all layers
    await canvas.composite(layers).toFile(outputPath);

    logger.info({ outputPath, imageCount: images.length }, 'Images combined');

    return { success: true, outputPath };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to combine images');
    throw error;
  }
}

/**
 * Tool: Remove Background (Simple)
 */
export async function removeBackground(params: {
  inputPath: string;
  threshold?: number;  // 0-255 for white background removal
  outputPath?: string;
}): Promise<{ success: boolean; outputPath: string }> {
  try {
    const { inputPath, threshold = 240, outputPath } = params;

    // Simple background removal for white/light backgrounds
    // For advanced removal, would need rembg or similar AI model
    const output = outputPath || inputPath.replace(/(\.\w+)$/, `-nobg.png`);

    await sharp(inputPath)
      .removeAlpha()
      .ensureAlpha()
      .toFile(output);

    logger.info({ inputPath, outputPath: output }, 'Background removed (simple)');

    return { success: true, outputPath: output };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to remove background');
    throw error;
  }
}

/**
 * Tool: Generate Thumbnail
 */
export async function generateThumbnail(params: {
  inputPath: string;
  size?: number;  // Square size (default 200)
  outputPath?: string;
}): Promise<{ success: boolean; outputPath: string; size: number }> {
  try {
    const { inputPath, size = 200, outputPath } = params;

    const output = outputPath || inputPath.replace(/(\.\w+)$/, `-thumb$1`);

    await sharp(inputPath)
      .resize(size, size, { fit: 'cover', position: 'center' })
      .toFile(output);

    logger.info({ inputPath, outputPath: output, size }, 'Thumbnail generated');

    return { success: true, outputPath: output, size };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to generate thumbnail');
    throw error;
  }
}

/**
 * Tool: Optimize Image (Compress)
 */
export async function optimizeImage(params: {
  inputPath: string;
  quality?: number;  // 1-100 (JPEG) or 0-100 (PNG)
  format?: 'jpeg' | 'png' | 'webp';
  outputPath?: string;
}): Promise<{ success: boolean; outputPath: string; originalSize: number; newSize: number; savings: string }> {
  try {
    const { inputPath, quality = 80, format, outputPath } = params;

    const originalStats = await fs.stat(inputPath);
    const originalSize = originalStats.size;

    let image = sharp(inputPath);

    // Convert format if specified
    if (format) {
      switch (format) {
        case 'jpeg':
          image = image.jpeg({ quality });
          break;
        case 'png':
          image = image.png({ quality });
          break;
        case 'webp':
          image = image.webp({ quality });
          break;
      }
    } else {
      // Keep original format but compress
      const ext = path.extname(inputPath).toLowerCase();
      if (ext === '.jpg' || ext === '.jpeg') {
        image = image.jpeg({ quality });
      } else if (ext === '.png') {
        image = image.png({ quality });
      } else if (ext === '.webp') {
        image = image.webp({ quality });
      }
    }

    const output = outputPath || inputPath.replace(/(\.\w+)$/, `-optimized$1`);
    await image.toFile(output);

    const newStats = await fs.stat(output);
    const newSize = newStats.size;
    const savings = `${((1 - newSize / originalSize) * 100).toFixed(1)}%`;

    logger.info({
      inputPath,
      outputPath: output,
      originalSize,
      newSize,
      savings,
    }, 'Image optimized');

    return {
      success: true,
      outputPath: output,
      originalSize,
      newSize,
      savings,
    };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to optimize image');
    throw error;
  }
}

/**
 * Tool: Rotate Image
 */
export async function rotateImage(params: {
  inputPath: string;
  angle: number;  // Degrees (90, 180, 270, or custom)
  backgroundColor?: string;
  outputPath?: string;
}): Promise<{ success: boolean; outputPath: string }> {
  try {
    const { inputPath, angle, backgroundColor = '#FFFFFF', outputPath } = params;

    const output = outputPath || inputPath.replace(/(\.\w+)$/, `-rotated${angle}$1`);

    await sharp(inputPath)
      .rotate(angle, { background: backgroundColor })
      .toFile(output);

    logger.info({ inputPath, outputPath: output, angle }, 'Image rotated');

    return { success: true, outputPath: output };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to rotate image');
    throw error;
  }
}

/**
 * Tool: Add Border
 */
export async function addBorder(params: {
  inputPath: string;
  width: number;  // Border width in pixels
  color?: string;
  outputPath?: string;
}): Promise<{ success: boolean; outputPath: string }> {
  try {
    const { inputPath, width, color = '#000000', outputPath } = params;

    const output = outputPath || inputPath.replace(/(\.\w+)$/, `-bordered$1`);

    await sharp(inputPath)
      .extend({
        top: width,
        bottom: width,
        left: width,
        right: width,
        background: color,
      })
      .toFile(output);

    logger.info({ inputPath, outputPath: output, borderWidth: width, color }, 'Border added');

    return { success: true, outputPath: output };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to add border');
    throw error;
  }
}

/**
 * Tool: Get Image Info
 */
export async function getImageInfo(params: {
  inputPath: string;
}): Promise<{
  width: number;
  height: number;
  format: string;
  size: number;
  aspectRatio: string;
  hasAlpha: boolean;
}> {
  try {
    const { inputPath } = params;

    const metadata = await sharp(inputPath).metadata();
    const stats = await fs.stat(inputPath);

    const aspectRatio = metadata.width && metadata.height
      ? `${metadata.width}:${metadata.height} (${(metadata.width / metadata.height).toFixed(2)})`
      : 'unknown';

    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || 'unknown',
      size: stats.size,
      aspectRatio,
      hasAlpha: metadata.hasAlpha || false,
    };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to get image info');
    throw error;
  }
}
