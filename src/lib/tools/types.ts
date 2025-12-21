/**
 * Image Tools Types
 * TASK-040: Unified type definitions for image processing
 *
 * Consolidates types from:
 * - image-cache.ts (ImageMetadata)
 * - image-rag.ts (ImageRAGMetadata)
 * - text-overlay.ts (TextOverlayConfig)
 */

// =============================================================================
// IMAGE METADATA
// =============================================================================

/**
 * Unified image metadata interface
 * Used by both Redis cache and Qdrant RAG
 */
export interface ImageMetadata {
  /** Full file path */
  filepath: string;
  /** File name only */
  filename: string;
  /** Agent that created the image */
  agentRole: string;
  /** Creation timestamp (Unix ms) */
  createdAt: number;
  /** Template used (e.g., 'twitter-post', 'marketing-banner') */
  template?: string;
  /** Event type (e.g., 'price-milestone', 'partnership') */
  eventType?: string;
  /** Searchable tags */
  tags?: string[];
  /** Human-readable description */
  description?: string;
  /** AI model used for generation */
  model?: string;
  /** Branding type applied (e.g., 'logo-watermark', 'text-footer') */
  brandingType?: string;
  /** SHA256 hash for duplicate detection */
  imageHash?: string;
}

/**
 * Search criteria for finding existing images
 */
export interface ImageSearchCriteria {
  /** Filter by template */
  template?: string;
  /** Filter by event type */
  eventType?: string;
  /** Filter by tags (any match) */
  tags?: string[];
  /** Only return images younger than X hours */
  maxAgeHours?: number;
  /** Filter by agent role */
  agentRole?: string;
}

/**
 * Image search result with relevance score
 */
export interface ImageSearchResult {
  metadata: ImageMetadata;
  /** Similarity score (0-1, higher is better) */
  score: number;
  /** Vector distance (lower is better) */
  distance: number;
}

// =============================================================================
// TEXT OVERLAY
// =============================================================================

/**
 * Position type for text/element placement
 */
export type VerticalPosition = 'top' | 'center' | 'bottom';

/**
 * Corner/edge position for logos and watermarks
 */
export type LogoPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';

/**
 * Custom position as percentage (0-100)
 */
export interface CustomPosition {
  x: number;
  y: number;
}

/**
 * Text overlay configuration
 */
export interface TextOverlayConfig {
  text: string;
  position: VerticalPosition | 'custom';
  customPosition?: CustomPosition;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  color?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  padding?: number;
  maxWidth?: number;
}

/**
 * Multi-text overlay configuration (headline + subtitle)
 */
export interface MultiTextOverlayConfig {
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
  position: VerticalPosition;
  backgroundColor?: string;
  backgroundOpacity?: number;
  padding?: number;
}

// =============================================================================
// BRANDING
// =============================================================================

/**
 * Branding strategy options
 */
export type BrandingStrategy =
  | 'logo-watermark'
  | 'text-footer'
  | 'logo-and-text'
  | 'none';

/**
 * Branding configuration
 */
export interface BrandingConfig {
  strategy: BrandingStrategy;
  logoPath?: string;
  logoPosition?: LogoPosition;
  logoScale?: number;
  logoOpacity?: number;
  footerText?: string;
  footerHeight?: number;
}

/**
 * Result from branding operation
 */
export interface BrandingResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  strategy?: BrandingStrategy;
}

// =============================================================================
// IMAGE GENERATION
// =============================================================================

/**
 * Image generation request
 */
export interface ImageGenerationRequest {
  prompt: string;
  template?: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  size?: '1K' | '2K' | '4K';
  style?: string;
  negativePrompt?: string;
}

/**
 * Image generation result
 */
export interface ImageGenerationResult {
  success: boolean;
  imagePath?: string;
  imageUrl?: string;
  error?: string;
  model?: string;
  metadata?: ImageMetadata;
}

// =============================================================================
// STORAGE
// =============================================================================

/**
 * Storage destination options
 */
export type StorageDestination = 'workspace' | 'directus' | 'github';

/**
 * Storage result
 */
export interface StorageResult {
  success: boolean;
  destination: StorageDestination;
  path?: string;
  url?: string;
  error?: string;
}
