/**
 * Image Tools Constants
 * TASK-040: Extracted from brand-image-generator.ts for reusability
 *
 * Contains:
 * - SHIBC_BRAND: Corporate Identity guidelines
 * - IMAGE_TEMPLATES: Template definitions for different image types
 * - SHIBC_SOCIAL_HANDLES: Social media handles for footers
 */

// =============================================================================
// BRAND IDENTITY
// =============================================================================

/**
 * Shiba Classic CI Guidelines
 */
export const SHIBC_BRAND = {
  name: 'Shiba Classic',
  ticker: 'SHIBC',
  tagline: 'The Original SHIBC',

  colors: {
    primary: '#fda92d', // Orange/Gold
    secondary: '#8E33FF', // Purple
    dark: '#141A21', // Dark Background
    light: '#F7F8F9', // Light Background
    accent: '#00B8D9', // Cyan
    error: '#FF5630', // Red
  },

  fonts: {
    heading: 'Barlow', // Weight: 800 for H1/H2
    body: 'Public Sans', // Weight: 400-700
  },

  style: {
    aesthetic: 'Modern, tech-forward design with dark mode preference',
    elements: [
      'Gradient backgrounds (orange-to-gold)',
      'Glassmorphism effects (blur, transparency)',
      'Geometric patterns suggesting blockchain/network',
      'Professional yet approachable',
      'Cryptocurrency/meme coin hybrid aesthetic',
    ],
  },

  mascot: {
    description: 'Shiba dog mascot',
    style: 'Cute, friendly, professional',
    context: 'Represents the community, NOT the token name',
  },
} as const;

/**
 * Social media handles for image footers
 */
export const SHIBC_SOCIAL_HANDLES = {
  twitter: '@shiaboracle',
  telegram: 't.me/ShibaClassicPortal',
  website: 'shibaclassic.io',
} as const;

// =============================================================================
// IMAGE TEMPLATES
// =============================================================================

/**
 * Image Template Definition
 */
export interface BrandImageTemplate {
  type: 'social-media' | 'marketing-banner' | 'infographic' | 'announcement';
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  size: '1K' | '2K' | '4K';
  requiredElements: string[];
  styleGuide: string;
}

/**
 * Available image templates
 */
export const IMAGE_TEMPLATES: Record<string, BrandImageTemplate> = {
  'twitter-post': {
    type: 'social-media',
    aspectRatio: '16:9',
    size: '1K',
    requiredElements: [
      'SHIBC logo (top-left or center)',
      'Brand colors (orange-gold gradient)',
      'Blockchain/network visual elements',
      'Clean space for text overlay',
    ],
    styleGuide: `
      - Primary colors: Orange-gold (#fda92d) gradient background
      - Secondary: Purple (#8E33FF) and cyan (#00B8D9) accents
      - Modern, tech-forward aesthetic
      - Glassmorphism effects
      - Professional cryptocurrency branding
      - NO random elements, strictly CI-compliant
    `,
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
      'Premium, professional look',
    ],
    styleGuide: `
      - Background: Dark (#141A21) with orange-gold gradient overlay
      - Geometric blockchain patterns in cyan (#00B8D9)
      - Glassmorphism floating panels
      - Modern sans-serif typography space (Barlow font style)
      - High-end cryptocurrency marketing material
      - MUST include SHIBC branding elements
    `,
  },

  announcement: {
    type: 'announcement',
    aspectRatio: '1:1',
    size: '1K',
    requiredElements: [
      'SHIBC logo centered or prominent',
      'Bold announcement headline space',
      'Brand colors with high contrast',
      'Clean, readable design',
    ],
    styleGuide: `
      - Clean, minimalist design
      - High contrast for readability
      - Brand colors: Orange (#fda92d) primary, Purple (#8E33FF) accent
      - Space for headline text (Barlow bold style)
      - Professional announcement aesthetic
      - Corporate-crypto hybrid style
    `,
  },

  infographic: {
    type: 'infographic',
    aspectRatio: '4:3',
    size: '2K',
    requiredElements: [
      'SHIBC logo watermark',
      'Data visualization elements',
      'Brand color scheme throughout',
      'Professional charts/graphs style',
      'Clean information hierarchy',
    ],
    styleGuide: `
      - Professional business infographic style
      - Color coding: Orange (positive), Purple (metrics), Cyan (highlights)
      - Dark background (#141A21) with color accents
      - Modern data visualization aesthetic
      - Chart elements in brand colors
      - Executive presentation quality
    `,
  },
} as const;

// =============================================================================
// DIMENSIONS
// =============================================================================

/**
 * Image size presets
 */
export const IMAGE_SIZES = {
  '1K': { width: 1024, height: 1024 },
  '2K': { width: 2048, height: 2048 },
  '4K': { width: 4096, height: 4096 },
} as const;

/**
 * Aspect ratio dimensions (based on 1K width)
 */
export const ASPECT_RATIOS = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
} as const;

/**
 * Get dimensions for a template
 */
export function getTemplateDimensions(
  template: BrandImageTemplate
): { width: number; height: number } {
  const baseSize = IMAGE_SIZES[template.size];
  const ratio = ASPECT_RATIOS[template.aspectRatio];

  // Scale to match the base size while maintaining aspect ratio
  const scale = baseSize.width / 1024;
  return {
    width: Math.round(ratio.width * scale),
    height: Math.round(ratio.height * scale),
  };
}
