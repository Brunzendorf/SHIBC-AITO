/**
 * Tests for Image Tools Types
 * TASK-040: Verify type definitions compile correctly
 */

import { describe, it, expect } from 'vitest';
import type {
  ImageMetadata,
  ImageSearchCriteria,
  ImageSearchResult,
  VerticalPosition,
  LogoPosition,
  CustomPosition,
  TextOverlayConfig,
  MultiTextOverlayConfig,
  BrandingStrategy,
  BrandingConfig,
  BrandingResult,
  ImageGenerationRequest,
  ImageGenerationResult,
  StorageDestination,
  StorageResult,
} from './types.js';

describe('ImageMetadata', () => {
  it('should accept valid metadata', () => {
    const metadata: ImageMetadata = {
      filepath: '/path/to/image.jpg',
      filename: 'image.jpg',
      agentRole: 'cmo',
      createdAt: Date.now(),
    };

    expect(metadata.filepath).toBe('/path/to/image.jpg');
    expect(metadata.agentRole).toBe('cmo');
  });

  it('should accept optional fields', () => {
    const metadata: ImageMetadata = {
      filepath: '/path/to/image.jpg',
      filename: 'image.jpg',
      agentRole: 'cmo',
      createdAt: Date.now(),
      template: 'twitter-post',
      eventType: 'price-milestone',
      tags: ['marketing', 'milestone'],
      description: 'Milestone celebration image',
      model: 'imagen-3',
      brandingType: 'logo-watermark',
      imageHash: 'abc123def456',
    };

    expect(metadata.template).toBe('twitter-post');
    expect(metadata.tags).toContain('marketing');
    expect(metadata.imageHash).toBe('abc123def456');
  });
});

describe('ImageSearchCriteria', () => {
  it('should accept search criteria', () => {
    const criteria: ImageSearchCriteria = {
      template: 'marketing-banner',
      eventType: 'partnership',
      tags: ['announcement'],
      maxAgeHours: 24,
      agentRole: 'cmo',
    };

    expect(criteria.template).toBe('marketing-banner');
    expect(criteria.maxAgeHours).toBe(24);
  });

  it('should accept empty criteria', () => {
    const criteria: ImageSearchCriteria = {};
    expect(criteria).toEqual({});
  });
});

describe('ImageSearchResult', () => {
  it('should contain metadata and scores', () => {
    const result: ImageSearchResult = {
      metadata: {
        filepath: '/path/to/image.jpg',
        filename: 'image.jpg',
        agentRole: 'cmo',
        createdAt: Date.now(),
      },
      score: 0.95,
      distance: 0.05,
    };

    expect(result.score).toBe(0.95);
    expect(result.distance).toBe(0.05);
    expect(result.metadata.filepath).toBe('/path/to/image.jpg');
  });
});

describe('Position Types', () => {
  it('should accept vertical positions', () => {
    const positions: VerticalPosition[] = ['top', 'center', 'bottom'];
    expect(positions).toHaveLength(3);
  });

  it('should accept logo positions', () => {
    const positions: LogoPosition[] = [
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
      'center',
    ];
    expect(positions).toHaveLength(5);
  });

  it('should accept custom position', () => {
    const custom: CustomPosition = { x: 25, y: 75 };
    expect(custom.x).toBe(25);
    expect(custom.y).toBe(75);
  });
});

describe('TextOverlayConfig', () => {
  it('should accept minimal config', () => {
    const config: TextOverlayConfig = {
      text: 'Hello World',
      position: 'center',
    };

    expect(config.text).toBe('Hello World');
    expect(config.position).toBe('center');
  });

  it('should accept full config', () => {
    const config: TextOverlayConfig = {
      text: 'Hello World',
      position: 'custom',
      customPosition: { x: 50, y: 50 },
      fontSize: 48,
      fontFamily: 'Barlow',
      fontWeight: 800,
      color: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.8,
      padding: 20,
      maxWidth: 80,
    };

    expect(config.fontSize).toBe(48);
    expect(config.customPosition?.x).toBe(50);
  });
});

describe('MultiTextOverlayConfig', () => {
  it('should accept headline and subtitle', () => {
    const config: MultiTextOverlayConfig = {
      headline: {
        text: 'Breaking News',
        fontSize: 64,
        fontWeight: 800,
        color: '#ffffff',
      },
      subtitle: {
        text: 'Important announcement',
        fontSize: 32,
        fontWeight: 400,
        color: '#cccccc',
      },
      position: 'center',
    };

    expect(config.headline?.text).toBe('Breaking News');
    expect(config.subtitle?.text).toBe('Important announcement');
  });

  it('should accept headline only', () => {
    const config: MultiTextOverlayConfig = {
      headline: { text: 'Just Headline' },
      position: 'top',
    };

    expect(config.headline?.text).toBe('Just Headline');
    expect(config.subtitle).toBeUndefined();
  });
});

describe('BrandingStrategy', () => {
  it('should accept all branding strategies', () => {
    const strategies: BrandingStrategy[] = [
      'logo-watermark',
      'text-footer',
      'logo-and-text',
      'none',
    ];
    expect(strategies).toHaveLength(4);
  });
});

describe('BrandingConfig', () => {
  it('should accept logo watermark config', () => {
    const config: BrandingConfig = {
      strategy: 'logo-watermark',
      logoPath: '/path/to/logo.png',
      logoPosition: 'bottom-right',
      logoScale: 0.2,
      logoOpacity: 0.8,
    };

    expect(config.strategy).toBe('logo-watermark');
    expect(config.logoPosition).toBe('bottom-right');
  });

  it('should accept text footer config', () => {
    const config: BrandingConfig = {
      strategy: 'text-footer',
      footerText: '@shiaboracle | t.me/ShibaClassicPortal',
      footerHeight: 60,
    };

    expect(config.strategy).toBe('text-footer');
    expect(config.footerText).toContain('@shiaboracle');
  });
});

describe('BrandingResult', () => {
  it('should represent success', () => {
    const result: BrandingResult = {
      success: true,
      outputPath: '/output/branded-image.jpg',
      strategy: 'logo-watermark',
    };

    expect(result.success).toBe(true);
    expect(result.outputPath).toBeDefined();
  });

  it('should represent failure', () => {
    const result: BrandingResult = {
      success: false,
      error: 'Logo file not found',
    };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Logo file not found');
  });
});

describe('ImageGenerationRequest', () => {
  it('should accept minimal request', () => {
    const request: ImageGenerationRequest = {
      prompt: 'A professional cryptocurrency banner',
    };

    expect(request.prompt).toContain('cryptocurrency');
  });

  it('should accept full request', () => {
    const request: ImageGenerationRequest = {
      prompt: 'A professional cryptocurrency banner',
      template: 'marketing-banner',
      aspectRatio: '16:9',
      size: '2K',
      style: 'photorealistic',
      negativePrompt: 'blurry, low quality',
    };

    expect(request.template).toBe('marketing-banner');
    expect(request.size).toBe('2K');
  });
});

describe('ImageGenerationResult', () => {
  it('should represent success with path', () => {
    const result: ImageGenerationResult = {
      success: true,
      imagePath: '/output/generated.jpg',
      model: 'imagen-3',
      metadata: {
        filepath: '/output/generated.jpg',
        filename: 'generated.jpg',
        agentRole: 'cmo',
        createdAt: Date.now(),
      },
    };

    expect(result.success).toBe(true);
    expect(result.model).toBe('imagen-3');
  });

  it('should represent success with URL', () => {
    const result: ImageGenerationResult = {
      success: true,
      imageUrl: 'https://storage.example.com/image.jpg',
    };

    expect(result.imageUrl).toContain('https://');
  });

  it('should represent failure', () => {
    const result: ImageGenerationResult = {
      success: false,
      error: 'Rate limit exceeded',
    };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Rate limit exceeded');
  });
});

describe('StorageDestination', () => {
  it('should accept all destinations', () => {
    const destinations: StorageDestination[] = ['workspace', 'directus', 'github'];
    expect(destinations).toHaveLength(3);
  });
});

describe('StorageResult', () => {
  it('should represent workspace storage', () => {
    const result: StorageResult = {
      success: true,
      destination: 'workspace',
      path: '/workspace/images/output.jpg',
    };

    expect(result.destination).toBe('workspace');
    expect(result.path).toContain('workspace');
  });

  it('should represent directus storage', () => {
    const result: StorageResult = {
      success: true,
      destination: 'directus',
      url: 'https://directus.example.com/assets/abc123',
    };

    expect(result.destination).toBe('directus');
    expect(result.url).toContain('directus');
  });

  it('should represent failure', () => {
    const result: StorageResult = {
      success: false,
      destination: 'github',
      error: 'Push failed',
    };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Push failed');
  });
});
