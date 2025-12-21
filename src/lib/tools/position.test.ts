/**
 * Tests for Position Calculation Utilities
 * TASK-040: Verify position calculations for image elements
 */

import { describe, it, expect } from 'vitest';
import {
  calculateVerticalPosition,
  calculateTextPosition,
  calculateLogoPosition,
  calculateFooterPosition,
  calculateFooterTextY,
  calculateFitScale,
  scaleDimensions,
  percentToAbsolute,
  clampToImageBounds,
} from './position.js';

describe('calculateVerticalPosition', () => {
  const imageHeight = 1000;
  const elementHeight = 100;
  const padding = 20;

  it('should position at top with padding', () => {
    const y = calculateVerticalPosition('top', imageHeight, elementHeight, padding);
    expect(y).toBe(20);
  });

  it('should center vertically', () => {
    const y = calculateVerticalPosition('center', imageHeight, elementHeight, padding);
    expect(y).toBe(450); // (1000 - 100) / 2
  });

  it('should position at bottom with padding', () => {
    const y = calculateVerticalPosition('bottom', imageHeight, elementHeight, padding);
    expect(y).toBe(880); // 1000 - 100 - 20
  });

  it('should default to top when position is invalid', () => {
    const y = calculateVerticalPosition('invalid' as any, imageHeight, elementHeight, padding);
    expect(y).toBe(20);
  });

  it('should use 0 padding when not specified', () => {
    const y = calculateVerticalPosition('top', imageHeight, elementHeight);
    expect(y).toBe(0);
  });
});

describe('calculateTextPosition', () => {
  const imageDimensions = { width: 1920, height: 1080 };
  const textWidth = 400;
  const fontSize = 48;

  it('should center text horizontally for top position', () => {
    const pos = calculateTextPosition('top', undefined, imageDimensions, textWidth, fontSize);
    expect(pos.x).toBe(760); // (1920 - 400) / 2
    expect(pos.y).toBe(72); // default padding = fontSize * 1.5
  });

  it('should center text horizontally for center position', () => {
    const pos = calculateTextPosition('center', undefined, imageDimensions, textWidth, fontSize);
    expect(pos.x).toBe(760);
    expect(pos.y).toBe(516); // (1080 - 48) / 2
  });

  it('should center text horizontally for bottom position', () => {
    const pos = calculateTextPosition('bottom', undefined, imageDimensions, textWidth, fontSize);
    expect(pos.x).toBe(760);
  });

  it('should use custom position when specified', () => {
    const customPosition = { x: 25, y: 75 };
    const pos = calculateTextPosition('custom', customPosition, imageDimensions, textWidth, fontSize);
    expect(pos.x).toBe(480); // 1920 * 0.25
    expect(pos.y).toBe(810); // 1080 * 0.75
  });

  it('should use explicit padding when provided', () => {
    const pos = calculateTextPosition('top', undefined, imageDimensions, textWidth, fontSize, 50);
    expect(pos.y).toBe(50);
  });
});

describe('calculateLogoPosition', () => {
  const imageDimensions = { width: 1920, height: 1080 };
  const logoDimensions = { width: 200, height: 100 };
  const padding = 20;

  it('should position at top-left', () => {
    const pos = calculateLogoPosition('top-left', imageDimensions, logoDimensions, padding);
    expect(pos.x).toBe(20);
    expect(pos.y).toBe(20);
  });

  it('should position at top-right', () => {
    const pos = calculateLogoPosition('top-right', imageDimensions, logoDimensions, padding);
    expect(pos.x).toBe(1700); // 1920 - 200 - 20
    expect(pos.y).toBe(20);
  });

  it('should position at bottom-left', () => {
    const pos = calculateLogoPosition('bottom-left', imageDimensions, logoDimensions, padding);
    expect(pos.x).toBe(20);
    expect(pos.y).toBe(960); // 1080 - 100 - 20
  });

  it('should position at bottom-right', () => {
    const pos = calculateLogoPosition('bottom-right', imageDimensions, logoDimensions, padding);
    expect(pos.x).toBe(1700);
    expect(pos.y).toBe(960);
  });

  it('should position at center', () => {
    const pos = calculateLogoPosition('center', imageDimensions, logoDimensions, padding);
    expect(pos.x).toBe(860); // (1920 - 200) / 2
    expect(pos.y).toBe(490); // (1080 - 100) / 2
  });

  it('should default to bottom-right for invalid position', () => {
    const pos = calculateLogoPosition('invalid' as any, imageDimensions, logoDimensions, padding);
    expect(pos.x).toBe(1700);
    expect(pos.y).toBe(960);
  });

  it('should use default padding of 20', () => {
    const pos = calculateLogoPosition('top-left', imageDimensions, logoDimensions);
    expect(pos.x).toBe(20);
    expect(pos.y).toBe(20);
  });
});

describe('calculateFooterPosition', () => {
  it('should return footer at bottom of image', () => {
    const imageDimensions = { width: 1920, height: 1080 };
    const footerHeight = 80;

    const footer = calculateFooterPosition(imageDimensions, footerHeight);

    expect(footer.x).toBe(0);
    expect(footer.y).toBe(1000); // 1080 - 80
    expect(footer.width).toBe(1920);
    expect(footer.height).toBe(80);
  });

  it('should work with different dimensions', () => {
    const imageDimensions = { width: 1024, height: 768 };
    const footerHeight = 60;

    const footer = calculateFooterPosition(imageDimensions, footerHeight);

    expect(footer.y).toBe(708);
    expect(footer.width).toBe(1024);
  });
});

describe('calculateFooterTextY', () => {
  it('should center text vertically in footer', () => {
    const imageDimensions = { width: 1920, height: 1080 };
    const footerHeight = 80;
    const textHeight = 24;

    const y = calculateFooterTextY(imageDimensions, footerHeight, textHeight);

    // Footer starts at 1000, text should be centered: 1000 + (80-24)/2 = 1028
    expect(y).toBe(1028);
  });

  it('should handle different text heights', () => {
    const imageDimensions = { width: 1920, height: 1080 };
    const footerHeight = 100;
    const textHeight = 40;

    const y = calculateFooterTextY(imageDimensions, footerHeight, textHeight);

    // Footer starts at 980, text: 980 + (100-40)/2 = 1010
    expect(y).toBe(1010);
  });
});

describe('calculateFitScale', () => {
  it('should return 1 if element fits', () => {
    const element = { width: 100, height: 100 };
    const max = { width: 200, height: 200 };

    expect(calculateFitScale(element, max)).toBe(1);
  });

  it('should scale down based on width', () => {
    const element = { width: 400, height: 100 };
    const max = { width: 200, height: 200 };

    expect(calculateFitScale(element, max)).toBe(0.5);
  });

  it('should scale down based on height', () => {
    const element = { width: 100, height: 400 };
    const max = { width: 200, height: 200 };

    expect(calculateFitScale(element, max)).toBe(0.5);
  });

  it('should use smaller scale when both dimensions exceed', () => {
    const element = { width: 400, height: 800 };
    const max = { width: 200, height: 200 };

    // Width scale: 0.5, Height scale: 0.25 -> use 0.25
    expect(calculateFitScale(element, max)).toBe(0.25);
  });
});

describe('scaleDimensions', () => {
  it('should scale dimensions by factor', () => {
    const dims = { width: 100, height: 200 };
    const scaled = scaleDimensions(dims, 2);

    expect(scaled.width).toBe(200);
    expect(scaled.height).toBe(400);
  });

  it('should handle fractional scales', () => {
    const dims = { width: 100, height: 100 };
    const scaled = scaleDimensions(dims, 0.5);

    expect(scaled.width).toBe(50);
    expect(scaled.height).toBe(50);
  });

  it('should round to nearest integer', () => {
    const dims = { width: 100, height: 100 };
    const scaled = scaleDimensions(dims, 0.33);

    expect(scaled.width).toBe(33);
    expect(scaled.height).toBe(33);
  });
});

describe('percentToAbsolute', () => {
  it('should convert 0% to 0', () => {
    const pos = percentToAbsolute({ x: 0, y: 0 }, { width: 1000, height: 1000 });
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(0);
  });

  it('should convert 100% to full dimension', () => {
    const pos = percentToAbsolute({ x: 100, y: 100 }, { width: 1000, height: 1000 });
    expect(pos.x).toBe(1000);
    expect(pos.y).toBe(1000);
  });

  it('should convert 50% to half', () => {
    const pos = percentToAbsolute({ x: 50, y: 50 }, { width: 1920, height: 1080 });
    expect(pos.x).toBe(960);
    expect(pos.y).toBe(540);
  });

  it('should floor the result', () => {
    const pos = percentToAbsolute({ x: 33.33, y: 66.66 }, { width: 1000, height: 1000 });
    expect(pos.x).toBe(333);
    expect(pos.y).toBe(666);
  });
});

describe('clampToImageBounds', () => {
  const imageDims = { width: 1000, height: 1000 };
  const elemDims = { width: 100, height: 100 };

  it('should not change valid positions', () => {
    const pos = { x: 100, y: 100 };
    const clamped = clampToImageBounds(pos, elemDims, imageDims);

    expect(clamped.x).toBe(100);
    expect(clamped.y).toBe(100);
  });

  it('should clamp negative x to 0', () => {
    const pos = { x: -50, y: 100 };
    const clamped = clampToImageBounds(pos, elemDims, imageDims);

    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(100);
  });

  it('should clamp negative y to 0', () => {
    const pos = { x: 100, y: -50 };
    const clamped = clampToImageBounds(pos, elemDims, imageDims);

    expect(clamped.x).toBe(100);
    expect(clamped.y).toBe(0);
  });

  it('should clamp x that would overflow right edge', () => {
    const pos = { x: 950, y: 100 };
    const clamped = clampToImageBounds(pos, elemDims, imageDims);

    expect(clamped.x).toBe(900); // 1000 - 100
    expect(clamped.y).toBe(100);
  });

  it('should clamp y that would overflow bottom edge', () => {
    const pos = { x: 100, y: 950 };
    const clamped = clampToImageBounds(pos, elemDims, imageDims);

    expect(clamped.x).toBe(100);
    expect(clamped.y).toBe(900); // 1000 - 100
  });

  it('should clamp both dimensions', () => {
    const pos = { x: -100, y: 1000 };
    const clamped = clampToImageBounds(pos, elemDims, imageDims);

    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(900);
  });
});
