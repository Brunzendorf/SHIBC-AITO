/**
 * Tests for Text Overlay System
 * TASK-040 Phase 3: Comprehensive tests for text overlay functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to define mocks before vi.mock hoisting
const { mockSharp, mockSharpInstance } = vi.hoisted(() => {
  const instance = {
    metadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
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

// Mock logger
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock brand-image-generator for SHIBC_BRAND constant
vi.mock('./brand-image-generator.js', () => ({
  SHIBC_BRAND: {
    fonts: {
      heading: 'Barlow',
      body: 'Public Sans',
    },
  },
}));

import {
  addTextOverlay,
  addMultiTextOverlay,
  type TextOverlayConfig,
  type MultiTextOverlay,
} from './text-overlay.js';

describe('addTextOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSharpInstance.metadata.mockResolvedValue({ width: 1920, height: 1080 });
    mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from('result'));
  });

  it('should add text overlay with minimal config', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: TextOverlayConfig = {
      text: 'Hello World',
      position: 'center',
    };

    const result = await addTextOverlay(base64, config);

    expect(mockSharp).toHaveBeenCalled();
    expect(mockSharpInstance.composite).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('should position text at top', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: TextOverlayConfig = {
      text: 'Top Text',
      position: 'top',
    };

    const result = await addTextOverlay(base64, config);

    expect(result).toBeDefined();
    expect(mockSharpInstance.composite).toHaveBeenCalled();
  });

  it('should position text at bottom', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: TextOverlayConfig = {
      text: 'Bottom Text',
      position: 'bottom',
    };

    const result = await addTextOverlay(base64, config);

    expect(result).toBeDefined();
  });

  it('should use custom position', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: TextOverlayConfig = {
      text: 'Custom Position',
      position: 'custom',
      customPosition: { x: 25, y: 75 },
    };

    const result = await addTextOverlay(base64, config);

    expect(result).toBeDefined();
  });

  it('should apply custom styling', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: TextOverlayConfig = {
      text: 'Styled Text',
      position: 'center',
      fontSize: 48,
      fontFamily: 'Arial',
      fontWeight: 700,
      color: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.8,
      textAlign: 'center',
      padding: 20,
      shadow: true,
    };

    const result = await addTextOverlay(base64, config);

    expect(result).toBeDefined();
  });

  it('should support left text alignment', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: TextOverlayConfig = {
      text: 'Left aligned text',
      position: 'center',
      textAlign: 'left',
    };

    const result = await addTextOverlay(base64, config);

    expect(result).toBeDefined();
  });

  it('should support right text alignment', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: TextOverlayConfig = {
      text: 'Right aligned text',
      position: 'center',
      textAlign: 'right',
    };

    const result = await addTextOverlay(base64, config);

    expect(result).toBeDefined();
  });

  it('should wrap long text', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const longText = 'This is a very long text that should be wrapped across multiple lines to fit within the image boundaries properly';
    const config: TextOverlayConfig = {
      text: longText,
      position: 'center',
      maxWidth: 60,
    };

    const result = await addTextOverlay(base64, config);

    expect(result).toBeDefined();
  });

  it('should return original on metadata error', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    mockSharpInstance.metadata.mockResolvedValueOnce({});

    const config: TextOverlayConfig = {
      text: 'Test',
      position: 'center',
    };

    const result = await addTextOverlay(base64, config);

    expect(result).toBe(base64);
  });

  it('should return original on sharp error', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    mockSharpInstance.composite.mockImplementationOnce(() => {
      throw new Error('Sharp error');
    });

    const config: TextOverlayConfig = {
      text: 'Test',
      position: 'center',
    };

    const result = await addTextOverlay(base64, config);

    expect(result).toBe(base64);
  });

  it('should handle default position fallback', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: TextOverlayConfig = {
      text: 'Test',
      position: 'invalid' as any,
    };

    const result = await addTextOverlay(base64, config);

    expect(result).toBeDefined();
  });
});

describe('addMultiTextOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSharpInstance.metadata.mockResolvedValue({ width: 1920, height: 1080 });
    mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from('result'));
  });

  it('should add headline only', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: MultiTextOverlay = {
      headline: {
        text: 'Main Headline',
      },
      position: 'center',
    };

    const result = await addMultiTextOverlay(base64, config);

    expect(result).toBeDefined();
    expect(mockSharpInstance.composite).toHaveBeenCalled();
  });

  it('should add headline and subtitle', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: MultiTextOverlay = {
      headline: {
        text: 'Breaking News',
        fontSize: 64,
        fontWeight: 800,
        color: '#fda92d',
      },
      subtitle: {
        text: 'Important announcement for the community',
        fontSize: 32,
        fontWeight: 400,
        color: '#ffffff',
      },
      position: 'center',
    };

    const result = await addMultiTextOverlay(base64, config);

    expect(result).toBeDefined();
  });

  it('should position at top', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: MultiTextOverlay = {
      headline: { text: 'Top Headline' },
      position: 'top',
    };

    const result = await addMultiTextOverlay(base64, config);

    expect(result).toBeDefined();
  });

  it('should position at bottom', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: MultiTextOverlay = {
      headline: { text: 'Bottom Headline' },
      subtitle: { text: 'Bottom subtitle' },
      position: 'bottom',
    };

    const result = await addMultiTextOverlay(base64, config);

    expect(result).toBeDefined();
  });

  it('should apply custom background styling', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: MultiTextOverlay = {
      headline: { text: 'Styled' },
      subtitle: { text: 'Subtitle' },
      position: 'center',
      backgroundColor: '#141A21',
      backgroundOpacity: 0.9,
      padding: 30,
    };

    const result = await addMultiTextOverlay(base64, config);

    expect(result).toBeDefined();
  });

  it('should return original on metadata error', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    mockSharpInstance.metadata.mockResolvedValueOnce({});

    const config: MultiTextOverlay = {
      headline: { text: 'Test' },
      position: 'center',
    };

    const result = await addMultiTextOverlay(base64, config);

    expect(result).toBe(base64);
  });

  it('should return original on sharp error', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    mockSharpInstance.composite.mockImplementationOnce(() => {
      throw new Error('Sharp error');
    });

    const config: MultiTextOverlay = {
      headline: { text: 'Test' },
      position: 'center',
    };

    const result = await addMultiTextOverlay(base64, config);

    expect(result).toBe(base64);
  });

  it('should handle subtitle only (no headline)', async () => {
    const base64 = Buffer.from('test-image').toString('base64');
    const config: MultiTextOverlay = {
      subtitle: { text: 'Just a subtitle' },
      position: 'bottom',
    };

    const result = await addMultiTextOverlay(base64, config);

    expect(result).toBeDefined();
  });
});
