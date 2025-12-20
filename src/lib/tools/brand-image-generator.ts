/**
 * Brand-Compliant Image Generator
 * Generates images that strictly follow Shiba Classic CI guidelines
 */

import sharp from 'sharp';
import path from 'path';
import { createLogger } from '../logger.js';
import { storeImage } from './image-storage.js';

const logger = createLogger('brand-image-gen');

/**
 * Shiba Classic CI Guidelines
 */
export const SHIBC_BRAND = {
  name: 'Shiba Classic',
  ticker: 'SHIBC',
  tagline: 'The Original SHIBC',

  colors: {
    primary: '#fda92d',      // Orange/Gold
    secondary: '#8E33FF',    // Purple
    dark: '#141A21',         // Dark Background
    light: '#F7F8F9',        // Light Background
    accent: '#00B8D9',       // Cyan
    error: '#FF5630',        // Red
  },

  fonts: {
    heading: 'Barlow',       // Weight: 800 for H1/H2
    body: 'Public Sans',     // Weight: 400-700
  },

  style: {
    aesthetic: 'Modern, tech-forward design with dark mode preference',
    elements: [
      'Gradient backgrounds (orange-to-gold)',
      'Glassmorphism effects (blur, transparency)',
      'Geometric patterns suggesting blockchain/network',
      'Professional yet approachable',
      'Cryptocurrency/meme coin hybrid aesthetic'
    ],
  },

  mascot: {
    description: 'Shiba dog mascot',
    style: 'Cute, friendly, professional',
    context: 'Represents the community, NOT the token name',
  },
};

/**
 * Image Templates with CI enforcement
 */
export interface BrandImageTemplate {
  type: 'social-media' | 'marketing-banner' | 'infographic' | 'announcement';
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  size: '1K' | '2K' | '4K';
  requiredElements: string[];
  styleGuide: string;
}

export const IMAGE_TEMPLATES: Record<string, BrandImageTemplate> = {
  'twitter-post': {
    type: 'social-media',
    aspectRatio: '16:9',
    size: '1K',
    requiredElements: [
      'SHIBC logo (top-left or center)',
      'Brand colors (orange-gold gradient)',
      'Blockchain/network visual elements',
      'Clean space for text overlay'
    ],
    styleGuide: `
      - Primary colors: Orange-gold (#fda92d) gradient background
      - Secondary: Purple (#8E33FF) and cyan (#00B8D9) accents
      - Modern, tech-forward aesthetic
      - Glassmorphism effects
      - Professional cryptocurrency branding
      - NO random elements, strictly CI-compliant
    `
  },

  'marketing-banner': {
    type: 'marketing-banner',
    aspectRatio: '16:9',
    size: '2K',
    requiredElements: [
      'SHIBC logo prominent',
      'Brand gradient (orange to gold)',
      'Blockchain network visualization',
      'Text space for "SHIBA CLASSIC" branding',
      'Premium, professional look'
    ],
    styleGuide: `
      - Background: Dark (#141A21) with orange-gold gradient overlay
      - Geometric blockchain patterns in cyan (#00B8D9)
      - Glassmorphism floating panels
      - Modern sans-serif typography space (Barlow font style)
      - High-end cryptocurrency marketing material
      - MUST include SHIBC branding elements
    `
  },

  'announcement': {
    type: 'announcement',
    aspectRatio: '1:1',
    size: '1K',
    requiredElements: [
      'SHIBC logo centered or prominent',
      'Bold announcement headline space',
      'Brand colors with high contrast',
      'Clean, readable design'
    ],
    styleGuide: `
      - Clean, minimalist design
      - High contrast for readability
      - Brand colors: Orange (#fda92d) primary, Purple (#8E33FF) accent
      - Space for headline text (Barlow bold style)
      - Professional announcement aesthetic
      - Corporate-crypto hybrid style
    `
  },

  'infographic': {
    type: 'infographic',
    aspectRatio: '4:3',
    size: '2K',
    requiredElements: [
      'SHIBC logo watermark',
      'Data visualization elements',
      'Brand color scheme throughout',
      'Professional charts/graphs style',
      'Clean information hierarchy'
    ],
    styleGuide: `
      - Professional business infographic style
      - Color coding: Orange (positive), Purple (metrics), Cyan (highlights)
      - Dark background (#141A21) with color accents
      - Modern data visualization aesthetic
      - Chart elements in brand colors
      - Executive presentation quality
    `
  },
};

/**
 * Build CI-compliant prompt from template
 */
export function buildBrandPrompt(
  template: BrandImageTemplate,
  customContent?: string
): string {
  const basePrompt = `
Professional ${template.type} image for SHIBA CLASSIC (SHIBC) cryptocurrency token.

**STRICT BRAND REQUIREMENTS:**
1. Project Name: SHIBA CLASSIC or SHIBC (NEVER just "Shiba Inu")
2. Logo: SHIBC logo must be visible (watermark or prominent placement)
3. Colors (MANDATORY):
   - Primary: Orange-gold gradient (#fda92d)
   - Secondary: Purple (#8E33FF)
   - Dark background: #141A21
   - Cyan accents: #00B8D9

4. Required Visual Elements:
${template.requiredElements.map(el => `   - ${el}`).join('\n')}

5. Style Guidelines:
${template.styleGuide}

6. Additional Context:
   - Modern, tech-forward cryptocurrency branding
   - Professional yet approachable aesthetic
   - Glassmorphism and gradient effects
   - Geometric blockchain/network patterns
   - Premium quality marketing material

${customContent ? `\n7. Specific Content:\n${customContent}` : ''}

**CRITICAL:**
- DO NOT generate random crypto imagery
- MUST follow exact brand colors
- MUST include SHIBC branding
- Professional, high-quality output only
- NO generic "Shiba Inu" references without SHIBA CLASSIC context
`;

  return basePrompt.trim();
}

/**
 * Generate brand-compliant image with MCP Server
 */
export async function generateBrandImage(
  templateType: keyof typeof IMAGE_TEMPLATES,
  customContent?: string,
  options?: {
    model?: 'imagen-4.0-generate-001' | 'gemini-2.5-flash-image';
    addLogoOverlay?: boolean;
    saveToDirectus?: boolean;
  }
): Promise<{ success: boolean; filepath?: string; url?: string; error?: string }> {

  const template = IMAGE_TEMPLATES[templateType];
  if (!template) {
    return { success: false, error: `Unknown template: ${templateType}` };
  }

  const prompt = buildBrandPrompt(template, customContent);
  const model = options?.model || 'gemini-2.5-flash-image'; // Use free model by default

  logger.info({
    templateType,
    model,
    aspectRatio: template.aspectRatio,
  }, 'Generating brand-compliant image');

  // TODO: Call Imagen MCP Server with structured prompt
  // TODO: Add SHIBC logo overlay if requested
  // TODO: Save to appropriate destination

  return {
    success: false,
    error: 'Implementation pending - MCP integration required'
  };
}

/**
 * Branding strategy for generated images
 */
export type BrandingStrategy =
  | { type: 'logo-watermark'; position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'; opacity?: number }
  | { type: 'text-footer'; handles?: { telegram?: string; twitter?: string } }
  | { type: 'logo-and-text'; logoPosition?: 'top-left' | 'top-right'; handles?: { telegram?: string; twitter?: string } }
  | { type: 'none' };

/**
 * Social media handles for text branding
 */
export const SHIBC_SOCIAL_HANDLES = {
  telegram: '@shibc_cto',
  twitter: '@shibc_cto',
  website: 'shibaclassic.io',
};

/**
 * Add text footer with social handles
 */
export async function addTextFooter(
  base64Image: string,
  handles?: { telegram?: string; twitter?: string }
): Promise<string> {
  try {
    const baseImage = sharp(Buffer.from(base64Image, 'base64'));
    const metadata = await baseImage.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Could not determine image dimensions');
    }

    // Use provided handles or defaults
    const tg = handles?.telegram || SHIBC_SOCIAL_HANDLES.telegram;
    const tw = handles?.twitter || SHIBC_SOCIAL_HANDLES.twitter;

    // Smart text with Unicode icons: If handles are the same, show handle + website
    // 𝕏 = Unicode X icon for Twitter/X, 🌐 = Globe for website
    const text = (tg === tw)
      ? `𝕏 ${tw}  •  🌐 ${SHIBC_SOCIAL_HANDLES.website}`
      : `𝕏 ${tw}  •  📱 ${tg}`;

    // Calculate font size based on image width (1.5% of width)
    const fontSize = Math.floor(metadata.width * 0.015);
    const padding = Math.floor(fontSize * 0.8);

    // Create text overlay SVG
    const textSvg = `
      <svg width="${metadata.width}" height="${fontSize + padding * 2}">
        <rect width="100%" height="100%" fill="#141A21" fill-opacity="0.7"/>
        <text
          x="50%"
          y="50%"
          text-anchor="middle"
          dominant-baseline="middle"
          font-family="Public Sans, Arial, sans-serif"
          font-size="${fontSize}"
          font-weight="500"
          fill="#F7F8F9"
        >${text}</text>
      </svg>
    `;

    // Composite text at bottom
    const result = await baseImage
      .composite([{
        input: Buffer.from(textSvg),
        top: metadata.height - (fontSize + padding * 2),
        left: 0,
      }])
      .toBuffer();

    logger.info({
      handles: { telegram: tg, twitter: tw },
      fontSize,
    }, 'Text footer added successfully');

    return result.toString('base64');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to add text footer');
    return base64Image;
  }
}

/**
 * Apply branding to image based on strategy
 */
export async function applyBranding(
  base64Image: string,
  strategy: BrandingStrategy
): Promise<string> {
  switch (strategy.type) {
    case 'logo-watermark':
      return addLogoWatermark(
        base64Image,
        strategy.position || 'bottom-right',
        strategy.opacity || 0.85
      );

    case 'text-footer':
      return addTextFooter(base64Image, strategy.handles);

    case 'logo-and-text': {
      // First add logo
      const withLogo = await addLogoWatermark(
        base64Image,
        strategy.logoPosition || 'top-right',
        0.85
      );
      // Then add text footer
      return addTextFooter(withLogo, strategy.handles);
    }

    case 'none':
      logger.info('No branding applied (agent decision)');
      return base64Image;

    default:
      logger.warn({ strategy }, 'Unknown branding strategy, applying default logo watermark');
      return addLogoWatermark(base64Image, 'bottom-right', 0.85);
  }
}

/**
 * Add SHIBC logo watermark to generated image
 */
export async function addLogoWatermark(
  base64Image: string,
  logoPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' = 'bottom-right',
  opacity: number = 0.8
): Promise<string> {
  try {
    const workspaceDir = process.env.WORKSPACE_DIR || './workspace';
    const logoPath = path.join(workspaceDir, 'assets', 'brand', 'SHIBC-logo.png');

    // Load base image
    const baseImage = sharp(Buffer.from(base64Image, 'base64'));
    const metadata = await baseImage.metadata();

    if (!metadata.width || !metadata.height) {
      throw new Error('Could not determine image dimensions');
    }

    // Load and resize logo to 15% of image width while maintaining aspect ratio
    const logoWidth = Math.floor(metadata.width * 0.15);
    const logo = await sharp(logoPath)
      .resize(logoWidth, null, { fit: 'inside', withoutEnlargement: true })
      .toBuffer();

    const logoMetadata = await sharp(logo).metadata();
    const logoHeight = logoMetadata.height || 0;

    // Calculate position based on logoPosition parameter
    let left = 0;
    let top = 0;
    const padding = 20;

    switch (logoPosition) {
      case 'top-left':
        left = padding;
        top = padding;
        break;
      case 'top-right':
        left = metadata.width - logoWidth - padding;
        top = padding;
        break;
      case 'bottom-left':
        left = padding;
        top = metadata.height - logoHeight - padding;
        break;
      case 'bottom-right':
        left = metadata.width - logoWidth - padding;
        top = metadata.height - logoHeight - padding;
        break;
      case 'center':
        left = Math.floor((metadata.width - logoWidth) / 2);
        top = Math.floor((metadata.height - logoHeight) / 2);
        break;
    }

    // Apply opacity to logo
    const logoWithOpacity = await sharp(logo)
      .composite([{
        input: Buffer.from([255, 255, 255, Math.floor(opacity * 255)]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      }])
      .toBuffer();

    // Composite logo onto base image
    const result = await baseImage
      .composite([{
        input: logoWithOpacity,
        left,
        top,
      }])
      .toBuffer();

    logger.info({
      position: logoPosition,
      opacity,
      logoSize: `${logoWidth}x${logoHeight}`,
    }, 'Logo watermark added successfully');

    return result.toString('base64');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to add logo watermark');
    // Return original image if watermarking fails
    return base64Image;
  }
}
