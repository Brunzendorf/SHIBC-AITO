/**
 * Image Tools Module
 * TASK-040: Centralized exports for image processing utilities
 */

// Constants & Brand Identity
export {
  SHIBC_BRAND,
  SHIBC_SOCIAL_HANDLES,
  IMAGE_TEMPLATES,
  IMAGE_SIZES,
  ASPECT_RATIOS,
  getTemplateDimensions,
  type BrandImageTemplate,
} from './constants.js';

// Type Definitions
export type {
  // Metadata
  ImageMetadata,
  ImageSearchCriteria,
  ImageSearchResult,
  // Text Overlay
  VerticalPosition,
  LogoPosition,
  CustomPosition,
  TextOverlayConfig,
  MultiTextOverlayConfig,
  // Branding
  BrandingStrategy,
  BrandingConfig,
  BrandingResult,
  // Generation
  ImageGenerationRequest,
  ImageGenerationResult,
  // Storage
  StorageDestination,
  StorageResult,
} from './types.js';

// Position Utilities
export {
  calculateVerticalPosition,
  calculateTextPosition,
  calculateLogoPosition,
  calculateFooterPosition,
  calculateFooterTextY,
  calculateFitScale,
  scaleDimensions,
  percentToAbsolute,
  clampToImageBounds,
  type PositionCoordinates,
  type ImageDimensions,
  type ElementDimensions,
} from './position.js';
