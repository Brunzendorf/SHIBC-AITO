/**
 * Tests for Image Tools Constants
 * TASK-040: Verify brand constants and template definitions
 */

import { describe, it, expect } from 'vitest';
import {
  SHIBC_BRAND,
  SHIBC_SOCIAL_HANDLES,
  IMAGE_TEMPLATES,
  IMAGE_SIZES,
  ASPECT_RATIOS,
  getTemplateDimensions,
} from './constants.js';

describe('SHIBC_BRAND', () => {
  it('should have correct brand name and ticker', () => {
    expect(SHIBC_BRAND.name).toBe('Shiba Classic');
    expect(SHIBC_BRAND.ticker).toBe('SHIBC');
    expect(SHIBC_BRAND.tagline).toBe('The Original SHIBC');
  });

  it('should have all required colors', () => {
    expect(SHIBC_BRAND.colors.primary).toBe('#fda92d');
    expect(SHIBC_BRAND.colors.secondary).toBe('#8E33FF');
    expect(SHIBC_BRAND.colors.dark).toBe('#141A21');
    expect(SHIBC_BRAND.colors.light).toBe('#F7F8F9');
    expect(SHIBC_BRAND.colors.accent).toBe('#00B8D9');
    expect(SHIBC_BRAND.colors.error).toBe('#FF5630');
  });

  it('should have font definitions', () => {
    expect(SHIBC_BRAND.fonts.heading).toBe('Barlow');
    expect(SHIBC_BRAND.fonts.body).toBe('Public Sans');
  });

  it('should have style guidelines', () => {
    expect(SHIBC_BRAND.style.aesthetic).toContain('Modern');
    expect(SHIBC_BRAND.style.elements).toBeInstanceOf(Array);
    expect(SHIBC_BRAND.style.elements.length).toBeGreaterThan(0);
  });

  it('should have mascot description', () => {
    expect(SHIBC_BRAND.mascot.description).toContain('Shiba');
    expect(SHIBC_BRAND.mascot.style).toContain('friendly');
  });
});

describe('SHIBC_SOCIAL_HANDLES', () => {
  it('should have all social handles', () => {
    expect(SHIBC_SOCIAL_HANDLES.twitter).toBe('@shiaboracle');
    expect(SHIBC_SOCIAL_HANDLES.telegram).toContain('t.me');
    expect(SHIBC_SOCIAL_HANDLES.website).toContain('shibaclassic');
  });
});

describe('IMAGE_TEMPLATES', () => {
  it('should have twitter-post template', () => {
    const template = IMAGE_TEMPLATES['twitter-post'];
    expect(template).toBeDefined();
    expect(template.type).toBe('social-media');
    expect(template.aspectRatio).toBe('16:9');
    expect(template.size).toBe('1K');
    expect(template.requiredElements).toBeInstanceOf(Array);
    expect(template.styleGuide).toContain('Orange');
  });

  it('should have marketing-banner template', () => {
    const template = IMAGE_TEMPLATES['marketing-banner'];
    expect(template).toBeDefined();
    expect(template.type).toBe('marketing-banner');
    expect(template.aspectRatio).toBe('16:9');
    expect(template.size).toBe('2K');
  });

  it('should have announcement template', () => {
    const template = IMAGE_TEMPLATES['announcement'];
    expect(template).toBeDefined();
    expect(template.type).toBe('announcement');
    expect(template.aspectRatio).toBe('1:1');
  });

  it('should have infographic template', () => {
    const template = IMAGE_TEMPLATES['infographic'];
    expect(template).toBeDefined();
    expect(template.type).toBe('infographic');
    expect(template.aspectRatio).toBe('4:3');
    expect(template.size).toBe('2K');
  });

  it('should have required elements for each template', () => {
    for (const [name, template] of Object.entries(IMAGE_TEMPLATES)) {
      expect(template.requiredElements.length).toBeGreaterThan(0);
      expect(template.styleGuide.length).toBeGreaterThan(0);
    }
  });
});

describe('IMAGE_SIZES', () => {
  it('should have 1K size', () => {
    expect(IMAGE_SIZES['1K']).toEqual({ width: 1024, height: 1024 });
  });

  it('should have 2K size', () => {
    expect(IMAGE_SIZES['2K']).toEqual({ width: 2048, height: 2048 });
  });

  it('should have 4K size', () => {
    expect(IMAGE_SIZES['4K']).toEqual({ width: 4096, height: 4096 });
  });
});

describe('ASPECT_RATIOS', () => {
  it('should have 1:1 ratio', () => {
    expect(ASPECT_RATIOS['1:1']).toEqual({ width: 1024, height: 1024 });
  });

  it('should have 16:9 ratio', () => {
    expect(ASPECT_RATIOS['16:9']).toEqual({ width: 1920, height: 1080 });
  });

  it('should have 9:16 ratio (vertical)', () => {
    expect(ASPECT_RATIOS['9:16']).toEqual({ width: 1080, height: 1920 });
  });

  it('should have 4:3 ratio', () => {
    expect(ASPECT_RATIOS['4:3']).toEqual({ width: 1024, height: 768 });
  });

  it('should have 3:4 ratio', () => {
    expect(ASPECT_RATIOS['3:4']).toEqual({ width: 768, height: 1024 });
  });
});

describe('getTemplateDimensions', () => {
  it('should return correct dimensions for twitter-post (1K, 16:9)', () => {
    const template = IMAGE_TEMPLATES['twitter-post'];
    const dims = getTemplateDimensions(template);
    expect(dims.width).toBe(1920);
    expect(dims.height).toBe(1080);
  });

  it('should return correct dimensions for marketing-banner (2K, 16:9)', () => {
    const template = IMAGE_TEMPLATES['marketing-banner'];
    const dims = getTemplateDimensions(template);
    expect(dims.width).toBe(3840);
    expect(dims.height).toBe(2160);
  });

  it('should return correct dimensions for announcement (1K, 1:1)', () => {
    const template = IMAGE_TEMPLATES['announcement'];
    const dims = getTemplateDimensions(template);
    expect(dims.width).toBe(1024);
    expect(dims.height).toBe(1024);
  });

  it('should return correct dimensions for infographic (2K, 4:3)', () => {
    const template = IMAGE_TEMPLATES['infographic'];
    const dims = getTemplateDimensions(template);
    expect(dims.width).toBe(2048);
    expect(dims.height).toBe(1536);
  });
});
