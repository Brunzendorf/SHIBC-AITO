/**
 * Tests for Brand Image Generator
 * TASK-040 Phase 3: Comprehensive tests for brand-compliant image generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to define mocks before vi.mock hoisting
const { mockSharp, mockSharpInstance } = vi.hoisted(() => {
  const instance = {
    metadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
    resize: vi.fn().mockReturnThis(),
    composite: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('test-image-data')),
  };
  return {
    mockSharpInstance: instance,
    mockSharp: vi.fn(() => instance),
  };
});

vi.mock('sharp', () => ({
  default: mockSharp,
}));

// Mock fs
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(Buffer.from('logo-data')),
  },
}));

// Mock logger
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock image-storage
vi.mock('./image-storage.js', () => ({
  storeImage: vi.fn().mockResolvedValue({ filepath: '/images/test.jpg' }),
}));

import {
  SHIBC_BRAND,
  IMAGE_TEMPLATES,
  SHIBC_SOCIAL_HANDLES,
  buildBrandPrompt,
  generateBrandImage,
  addTextFooter,
  applyBranding,
  addLogoWatermark,
} from './brand-image-generator.js';

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

describe('IMAGE_TEMPLATES', () => {
  it('should have twitter-post template', () => {
    const template = IMAGE_TEMPLATES['twitter-post'];
    expect(template).toBeDefined();
    expect(template.type).toBe('social-media');
    expect(template.aspectRatio).toBe('16:9');
    expect(template.size).toBe('1K');
  });

  it('should have marketing-banner template', () => {
    const template = IMAGE_TEMPLATES['marketing-banner'];
    expect(template).toBeDefined();
    expect(template.type).toBe('marketing-banner');
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
  });

  it('should have required elements and style guide', () => {
    for (const [name, template] of Object.entries(IMAGE_TEMPLATES)) {
      expect(template.requiredElements.length).toBeGreaterThan(0);
      expect(template.styleGuide.length).toBeGreaterThan(0);
    }
  });
});

describe('SHIBC_SOCIAL_HANDLES', () => {
  it('should have all social handles', () => {
    expect(SHIBC_SOCIAL_HANDLES.telegram).toBeDefined();
    expect(SHIBC_SOCIAL_HANDLES.twitter).toBeDefined();
    expect(SHIBC_SOCIAL_HANDLES.website).toContain('shibaclassic');
  });
});

describe('buildBrandPrompt', () => {
  it('should build prompt from template', () => {
    const template = IMAGE_TEMPLATES['twitter-post'];
    const prompt = buildBrandPrompt(template);

    expect(prompt).toContain('SHIBA CLASSIC');
    expect(prompt).toContain('SHIBC');
    expect(prompt).toContain('#fda92d');
    expect(prompt).toContain('#8E33FF');
  });

  it('should include custom content', () => {
    const template = IMAGE_TEMPLATES['announcement'];
    const customContent = 'Special milestone celebration for 10K holders';
    const prompt = buildBrandPrompt(template, customContent);

    expect(prompt).toContain('Special milestone celebration');
    expect(prompt).toContain('10K holders');
  });

  it('should include all required elements', () => {
    const template = IMAGE_TEMPLATES['marketing-banner'];
    const prompt = buildBrandPrompt(template);

    for (const element of template.requiredElements) {
      expect(prompt).toContain(element);
    }
  });

  it('should include brand requirements', () => {
    const template = IMAGE_TEMPLATES['infographic'];
    const prompt = buildBrandPrompt(template);

    expect(prompt).toContain('STRICT BRAND REQUIREMENTS');
    expect(prompt).toContain('CRITICAL');
  });
});

describe('generateBrandImage', () => {
  it('should return error for unknown template', async () => {
    const result = await generateBrandImage('unknown-template' as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown template');
  });

  it('should return implementation pending for valid template', async () => {
    const result = await generateBrandImage('twitter-post');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Implementation pending');
  });

  it('should accept custom content', async () => {
    const result = await generateBrandImage('announcement', 'Custom announcement text');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Implementation pending');
  });

  it('should accept options', async () => {
    const result = await generateBrandImage('marketing-banner', 'Content', {
      model: 'gemini-2.5-flash-image',
      addLogoOverlay: true,
    });

    expect(result.success).toBe(false);
  });
});

describe('addTextFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSharpInstance.metadata.mockResolvedValue({ width: 1920, height: 1080 });
    mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from('result'));
  });

  it('should add text footer with default handles', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const result = await addTextFooter(base64);

    expect(mockSharp).toHaveBeenCalled();
    expect(mockSharpInstance.composite).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should use custom handles', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const result = await addTextFooter(base64, {
      telegram: '@custom_tg',
      twitter: '@custom_tw',
    });

    expect(result).toBeDefined();
  });

  it('should use smart text for same handles', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    await addTextFooter(base64, {
      telegram: '@same_handle',
      twitter: '@same_handle',
    });

    // Verify composite was called (text includes website when handles are same)
    expect(mockSharpInstance.composite).toHaveBeenCalled();
  });

  it('should return original on error', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    mockSharpInstance.metadata.mockRejectedValueOnce(new Error('Sharp error'));

    const result = await addTextFooter(base64);

    expect(result).toBe(base64);
  });
});

describe('addLogoWatermark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSharpInstance.metadata.mockResolvedValue({ width: 1920, height: 1080 });
    mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from('result'));
  });

  it('should add logo at default position (bottom-right)', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const result = await addLogoWatermark(base64);

    expect(mockSharpInstance.composite).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should support different positions', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const;

    for (const position of positions) {
      await addLogoWatermark(base64, position);
      expect(mockSharpInstance.composite).toHaveBeenCalled();
    }
  });

  it('should support custom opacity', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    await addLogoWatermark(base64, 'center', 0.5);

    expect(mockSharpInstance.composite).toHaveBeenCalled();
  });

  it('should return original on error', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    mockSharp.mockImplementationOnce(() => {
      throw new Error('Sharp error');
    });

    const result = await addLogoWatermark(base64);

    expect(result).toBe(base64);
  });
});

describe('applyBranding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSharpInstance.metadata.mockResolvedValue({ width: 1920, height: 1080 });
    mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from('result'));
  });

  it('should apply logo-watermark strategy', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const result = await applyBranding(base64, { type: 'logo-watermark' });

    expect(result).toBeDefined();
    expect(mockSharpInstance.composite).toHaveBeenCalled();
  });

  it('should apply text-footer strategy', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const result = await applyBranding(base64, {
      type: 'text-footer',
      handles: { twitter: '@test', telegram: '@test' },
    });

    expect(result).toBeDefined();
  });

  it('should apply logo-and-text strategy', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const result = await applyBranding(base64, {
      type: 'logo-and-text',
      logoPosition: 'top-right',
    });

    expect(result).toBeDefined();
  });

  it('should return original for none strategy', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const result = await applyBranding(base64, { type: 'none' });

    expect(result).toBe(base64);
  });

  it('should use default watermark for unknown strategy', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const result = await applyBranding(base64, { type: 'unknown' as any });

    expect(result).toBeDefined();
  });
});
