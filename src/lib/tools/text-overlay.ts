/**
 * Text Overlay System
 * Add professional text overlays to generated images
 * Better quality than AI-generated text!
 */

import sharp from 'sharp';
import { createLogger } from '../logger.js';
import { SHIBC_BRAND } from './brand-image-generator.js';

const logger = createLogger('text-overlay');

/**
 * Text overlay configuration
 */
export interface TextOverlayConfig {
  text: string;
  position: 'top' | 'center' | 'bottom' | 'custom';
  customPosition?: { x: number; y: number };  // Percentage (0-100)
  fontSize?: number;                           // Auto-calculated if not set
  fontFamily?: string;
  fontWeight?: string | number;
  color?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  textAlign?: 'left' | 'center' | 'right';
  maxWidth?: number;                          // Percentage (0-100)
  padding?: number;
  shadow?: boolean;
}

/**
 * Multi-line text overlay (headline + subtitle)
 */
export interface MultiTextOverlay {
  headline?: {
    text: string;
    fontSize?: number;
    fontWeight?: string | number;
    color?: string;
  };
  subtitle?: {
    text: string;
    fontSize?: number;
    fontWeight?: string | number;
    color?: string;
  };
  position: 'top' | 'center' | 'bottom';
  backgroundColor?: string;
  backgroundOpacity?: number;
  padding?: number;
}

/**
 * Add single text overlay to image
 */
export async function addTextOverlay(
  base64Image: string,
  config: TextOverlayConfig
): Promise<string> {
  try {
    const baseImage = sharp(Buffer.from(base64Image, 'base64'));
    const metadata = await baseImage.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Could not determine image dimensions');
    }

    // Calculate font size (default: 3% of image width)
    const fontSize = config.fontSize || Math.floor(metadata.width * 0.03);

    // Calculate text area width
    const maxWidth = config.maxWidth || 80;  // 80% of image width
    const textWidth = Math.floor(metadata.width * (maxWidth / 100));

    // Calculate position
    let x: number;
    let y: number;
    const padding = config.padding || Math.floor(fontSize * 1.5);

    if (config.position === 'custom' && config.customPosition) {
      x = Math.floor(metadata.width * (config.customPosition.x / 100));
      y = Math.floor(metadata.height * (config.customPosition.y / 100));
    } else {
      // Horizontal centering
      x = Math.floor((metadata.width - textWidth) / 2);

      // Vertical positioning
      switch (config.position) {
        case 'top':
          y = padding;
          break;
        case 'center':
          y = Math.floor(metadata.height / 2);
          break;
        case 'bottom':
          y = metadata.height - (fontSize + padding * 2);
          break;
        default:
          y = Math.floor(metadata.height / 2);
      }
    }

    // Create text SVG
    const fontFamily = config.fontFamily || SHIBC_BRAND.fonts.heading;
    const fontWeight = config.fontWeight || 700;
    const color = config.color || '#F7F8F9';
    const bgColor = config.backgroundColor || '#141A21';
    const bgOpacity = config.backgroundOpacity ?? 0.8;
    const textAlign = config.textAlign || 'center';

    // Word wrap for long text
    const words = config.text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    // Simple word wrapping (could be improved with actual text measurement)
    const approxCharsPerLine = Math.floor(textWidth / (fontSize * 0.6));

    for (const word of words) {
      if ((currentLine + ' ' + word).length > approxCharsPerLine && currentLine.length > 0) {
        lines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine += (currentLine ? ' ' : '') + word;
      }
    }
    if (currentLine) lines.push(currentLine.trim());

    // Calculate total height
    const lineHeight = fontSize * 1.3;
    const totalTextHeight = lines.length * lineHeight;
    const boxHeight = totalTextHeight + padding * 2;

    // Build SVG with background and text
    const textElements = lines.map((line, i) => {
      const lineY = padding + (i + 0.5) * lineHeight;
      let textAnchor = 'middle';
      let lineX = textWidth / 2;

      if (textAlign === 'left') {
        textAnchor = 'start';
        lineX = padding;
      } else if (textAlign === 'right') {
        textAnchor = 'end';
        lineX = textWidth - padding;
      }

      const shadowFilter = config.shadow
        ? `<filter id="shadow"><feDropShadow dx="2" dy="2" stdDeviation="3" flood-opacity="0.5"/></filter>`
        : '';

      return `
        ${i === 0 ? shadowFilter : ''}
        <text
          x="${lineX}"
          y="${lineY}"
          text-anchor="${textAnchor}"
          dominant-baseline="middle"
          font-family="${fontFamily}"
          font-size="${fontSize}"
          font-weight="${fontWeight}"
          fill="${color}"
          ${config.shadow ? 'filter="url(#shadow)"' : ''}
        >${line}</text>
      `;
    }).join('\n');

    const textSvg = `
      <svg width="${textWidth}" height="${boxHeight}">
        <defs>
          ${config.shadow ? '<filter id="shadow"><feDropShadow dx="2" dy="2" stdDeviation="3" flood-opacity="0.5"/></filter>' : ''}
        </defs>
        <rect width="100%" height="100%" fill="${bgColor}" fill-opacity="${bgOpacity}" rx="10"/>
        ${textElements}
      </svg>
    `;

    // Composite text onto image
    const result = await baseImage
      .composite([{
        input: Buffer.from(textSvg),
        top: y,
        left: x,
      }])
      .toBuffer();

    logger.info({
      text: config.text.substring(0, 50),
      position: config.position,
      fontSize,
      lines: lines.length,
    }, 'Text overlay added successfully');

    return result.toString('base64');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to add text overlay');
    return base64Image;
  }
}

/**
 * Add multi-line text (headline + subtitle)
 */
export async function addMultiTextOverlay(
  base64Image: string,
  config: MultiTextOverlay
): Promise<string> {
  try {
    const baseImage = sharp(Buffer.from(base64Image, 'base64'));
    const metadata = await baseImage.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Could not determine image dimensions');
    }

    // Calculate font sizes
    const headlineFontSize = config.headline?.fontSize || Math.floor(metadata.width * 0.04);
    const subtitleFontSize = config.subtitle?.fontSize || Math.floor(metadata.width * 0.025);

    const padding = config.padding || Math.floor(headlineFontSize * 1.5);
    const lineSpacing = Math.floor(headlineFontSize * 0.5);

    // Calculate total height
    const headlineHeight = config.headline ? headlineFontSize * 1.3 : 0;
    const subtitleHeight = config.subtitle ? subtitleFontSize * 1.3 : 0;
    const totalHeight = headlineHeight + (config.headline && config.subtitle ? lineSpacing : 0) + subtitleHeight + padding * 2;

    // Calculate position
    let y: number;
    switch (config.position) {
      case 'top':
        y = padding;
        break;
      case 'center':
        y = Math.floor((metadata.height - totalHeight) / 2);
        break;
      case 'bottom':
        y = metadata.height - totalHeight - padding;
        break;
    }

    const bgColor = config.backgroundColor || '#141A21';
    const bgOpacity = config.backgroundOpacity ?? 0.85;

    // Build SVG
    let currentY = padding + headlineFontSize / 2;
    const textElements: string[] = [];

    if (config.headline) {
      textElements.push(`
        <text
          x="50%"
          y="${currentY}"
          text-anchor="middle"
          dominant-baseline="middle"
          font-family="${SHIBC_BRAND.fonts.heading}"
          font-size="${headlineFontSize}"
          font-weight="${config.headline.fontWeight || 800}"
          fill="${config.headline.color || '#fda92d'}"
          filter="url(#shadow)"
        >${config.headline.text}</text>
      `);
      currentY += headlineFontSize + lineSpacing;
    }

    if (config.subtitle) {
      textElements.push(`
        <text
          x="50%"
          y="${currentY}"
          text-anchor="middle"
          dominant-baseline="middle"
          font-family="${SHIBC_BRAND.fonts.body}"
          font-size="${subtitleFontSize}"
          font-weight="${config.subtitle.fontWeight || 500}"
          fill="${config.subtitle.color || '#F7F8F9'}"
        >${config.subtitle.text}</text>
      `);
    }

    const textSvg = `
      <svg width="${metadata.width}" height="${totalHeight}">
        <defs>
          <filter id="shadow">
            <feDropShadow dx="2" dy="2" stdDeviation="4" flood-opacity="0.7"/>
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="${bgColor}" fill-opacity="${bgOpacity}" rx="15"/>
        ${textElements.join('\n')}
      </svg>
    `;

    // Composite onto image
    const result = await baseImage
      .composite([{
        input: Buffer.from(textSvg),
        top: y,
        left: 0,
      }])
      .toBuffer();

    logger.info({
      headline: config.headline?.text,
      subtitle: config.subtitle?.text,
      position: config.position,
    }, 'Multi-text overlay added successfully');

    return result.toString('base64');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to add multi-text overlay');
    return base64Image;
  }
}
