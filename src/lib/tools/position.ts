/**
 * Position Calculation Utilities
 * TASK-040: Extracted from text-overlay.ts and brand-image-generator.ts
 *
 * Provides reusable position calculation functions for:
 * - Text overlays
 * - Logo watermarks
 * - Element placement
 */

import type {
  VerticalPosition,
  LogoPosition,
  CustomPosition,
} from './types.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Calculated position coordinates
 */
export interface PositionCoordinates {
  x: number;
  y: number;
}

/**
 * Image dimensions
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Element dimensions (for logos, text boxes, etc.)
 */
export interface ElementDimensions {
  width: number;
  height: number;
}

// =============================================================================
// VERTICAL POSITION
// =============================================================================

/**
 * Calculate Y coordinate for vertical positioning
 *
 * @param position - Vertical position ('top', 'center', 'bottom')
 * @param imageHeight - Total image height
 * @param elementHeight - Height of element being positioned
 * @param padding - Padding from edges
 * @returns Y coordinate
 */
export function calculateVerticalPosition(
  position: VerticalPosition,
  imageHeight: number,
  elementHeight: number,
  padding: number = 0
): number {
  switch (position) {
    case 'top':
      return padding;
    case 'center':
      return Math.floor((imageHeight - elementHeight) / 2);
    case 'bottom':
      return imageHeight - elementHeight - padding;
    default:
      return padding;
  }
}

/**
 * Calculate text position with centering
 *
 * @param position - Vertical position or 'custom'
 * @param customPosition - Custom position as percentage (if position is 'custom')
 * @param imageDimensions - Image width/height
 * @param textWidth - Width of text element
 * @param fontSize - Font size (used for default padding)
 * @param padding - Optional explicit padding
 * @returns X, Y coordinates
 */
export function calculateTextPosition(
  position: VerticalPosition | 'custom',
  customPosition: CustomPosition | undefined,
  imageDimensions: ImageDimensions,
  textWidth: number,
  fontSize: number,
  padding?: number
): PositionCoordinates {
  const effectivePadding = padding ?? Math.floor(fontSize * 1.5);

  // Custom position
  if (position === 'custom' && customPosition) {
    return {
      x: Math.floor(imageDimensions.width * (customPosition.x / 100)),
      y: Math.floor(imageDimensions.height * (customPosition.y / 100)),
    };
  }

  // Standard positioning: horizontally centered
  const x = Math.floor((imageDimensions.width - textWidth) / 2);

  // Vertical positioning
  const y = calculateVerticalPosition(
    position as VerticalPosition,
    imageDimensions.height,
    fontSize,
    effectivePadding
  );

  return { x, y };
}

// =============================================================================
// LOGO POSITION
// =============================================================================

/**
 * Calculate logo position coordinates
 *
 * @param position - Logo position ('top-left', 'top-right', etc.)
 * @param imageDimensions - Image width/height
 * @param logoDimensions - Logo width/height
 * @param padding - Padding from edges
 * @returns X, Y coordinates for logo placement
 */
export function calculateLogoPosition(
  position: LogoPosition,
  imageDimensions: ImageDimensions,
  logoDimensions: ElementDimensions,
  padding: number = 20
): PositionCoordinates {
  const { width: imgWidth, height: imgHeight } = imageDimensions;
  const { width: logoWidth, height: logoHeight } = logoDimensions;

  switch (position) {
    case 'top-left':
      return { x: padding, y: padding };

    case 'top-right':
      return { x: imgWidth - logoWidth - padding, y: padding };

    case 'bottom-left':
      return { x: padding, y: imgHeight - logoHeight - padding };

    case 'bottom-right':
      return {
        x: imgWidth - logoWidth - padding,
        y: imgHeight - logoHeight - padding,
      };

    case 'center':
      return {
        x: Math.floor((imgWidth - logoWidth) / 2),
        y: Math.floor((imgHeight - logoHeight) / 2),
      };

    default:
      // Default to bottom-right
      return {
        x: imgWidth - logoWidth - padding,
        y: imgHeight - logoHeight - padding,
      };
  }
}

// =============================================================================
// FOOTER POSITION
// =============================================================================

/**
 * Calculate footer bar position and dimensions
 *
 * @param imageDimensions - Image width/height
 * @param footerHeight - Height of footer bar
 * @returns Position and dimensions for footer
 */
export function calculateFooterPosition(
  imageDimensions: ImageDimensions,
  footerHeight: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: 0,
    y: imageDimensions.height - footerHeight,
    width: imageDimensions.width,
    height: footerHeight,
  };
}

/**
 * Calculate centered text position within footer
 *
 * @param imageDimensions - Image width/height
 * @param footerHeight - Height of footer bar
 * @param textHeight - Height of text (approximately fontSize)
 * @returns Y coordinate for centered text in footer
 */
export function calculateFooterTextY(
  imageDimensions: ImageDimensions,
  footerHeight: number,
  textHeight: number
): number {
  const footerY = imageDimensions.height - footerHeight;
  return footerY + Math.floor((footerHeight - textHeight) / 2);
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate element scale to fit within max dimensions
 *
 * @param elementDimensions - Original element dimensions
 * @param maxDimensions - Maximum allowed dimensions
 * @returns Scale factor (0-1)
 */
export function calculateFitScale(
  elementDimensions: ElementDimensions,
  maxDimensions: ElementDimensions
): number {
  const widthScale = maxDimensions.width / elementDimensions.width;
  const heightScale = maxDimensions.height / elementDimensions.height;
  return Math.min(widthScale, heightScale, 1);
}

/**
 * Scale dimensions while maintaining aspect ratio
 *
 * @param dimensions - Original dimensions
 * @param scale - Scale factor
 * @returns Scaled dimensions
 */
export function scaleDimensions(
  dimensions: ElementDimensions,
  scale: number
): ElementDimensions {
  return {
    width: Math.round(dimensions.width * scale),
    height: Math.round(dimensions.height * scale),
  };
}

/**
 * Calculate percentage position to absolute coordinates
 *
 * @param percentPosition - Position as percentage (0-100)
 * @param imageDimensions - Image dimensions
 * @returns Absolute coordinates
 */
export function percentToAbsolute(
  percentPosition: CustomPosition,
  imageDimensions: ImageDimensions
): PositionCoordinates {
  return {
    x: Math.floor(imageDimensions.width * (percentPosition.x / 100)),
    y: Math.floor(imageDimensions.height * (percentPosition.y / 100)),
  };
}

/**
 * Clamp coordinates to stay within image bounds
 *
 * @param position - Position coordinates
 * @param elementDimensions - Element dimensions
 * @param imageDimensions - Image dimensions
 * @returns Clamped coordinates
 */
export function clampToImageBounds(
  position: PositionCoordinates,
  elementDimensions: ElementDimensions,
  imageDimensions: ImageDimensions
): PositionCoordinates {
  return {
    x: Math.max(
      0,
      Math.min(position.x, imageDimensions.width - elementDimensions.width)
    ),
    y: Math.max(
      0,
      Math.min(position.y, imageDimensions.height - elementDimensions.height)
    ),
  };
}
