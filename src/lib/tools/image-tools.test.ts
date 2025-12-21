/**
 * Tests for Image Tools Module
 * TASK-038: Securing current behavior before refactoring
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock sharp
const mockSharpInstance = {
  metadata: vi.fn().mockResolvedValue({ width: 800, height: 600, format: 'jpeg', hasAlpha: false }),
  resize: vi.fn().mockReturnThis(),
  extract: vi.fn().mockReturnThis(),
  modulate: vi.fn().mockReturnThis(),
  linear: vi.fn().mockReturnThis(),
  grayscale: vi.fn().mockReturnThis(),
  tint: vi.fn().mockReturnThis(),
  blur: vi.fn().mockReturnThis(),
  sharpen: vi.fn().mockReturnThis(),
  negate: vi.fn().mockReturnThis(),
  composite: vi.fn().mockReturnThis(),
  removeAlpha: vi.fn().mockReturnThis(),
  ensureAlpha: vi.fn().mockReturnThis(),
  rotate: vi.fn().mockReturnThis(),
  extend: vi.fn().mockReturnThis(),
  jpeg: vi.fn().mockReturnThis(),
  png: vi.fn().mockReturnThis(),
  webp: vi.fn().mockReturnThis(),
  toFile: vi.fn().mockResolvedValue({}),
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-image')),
};

const mockSharp = vi.fn().mockReturnValue(mockSharpInstance);

vi.mock('sharp', () => ({
  default: mockSharp,
}));

// Mock fs
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn().mockResolvedValue({ size: 100000 }),
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
  },
}));

// Mock logger
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Image Tools Module', () => {
  let imageToolsModule: typeof import('./image-tools.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Reset mock implementations
    mockSharpInstance.toFile.mockResolvedValue({});
    mockSharpInstance.metadata.mockResolvedValue({
      width: 800,
      height: 600,
      format: 'jpeg',
      hasAlpha: false,
    });

    imageToolsModule = await import('./image-tools.js');
  });

  describe('resizeImage', () => {
    it('should resize image with width and height', async () => {
      const result = await imageToolsModule.resizeImage({
        inputPath: '/test/image.jpg',
        width: 400,
        height: 300,
      });

      expect(result.success).toBe(true);
      expect(result.dimensions).toBeDefined();
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(400, 300, { fit: 'inside' });
    });

    it('should use custom fit option', async () => {
      await imageToolsModule.resizeImage({
        inputPath: '/test/image.jpg',
        width: 400,
        fit: 'cover',
      });

      expect(mockSharpInstance.resize).toHaveBeenCalledWith(400, undefined, { fit: 'cover' });
    });

    it('should use custom output path', async () => {
      const result = await imageToolsModule.resizeImage({
        inputPath: '/test/image.jpg',
        width: 400,
        outputPath: '/test/custom-output.jpg',
      });

      expect(result.outputPath).toBe('/test/custom-output.jpg');
    });

    it('should generate default output path', async () => {
      const result = await imageToolsModule.resizeImage({
        inputPath: '/test/image.jpg',
        width: 400,
      });

      expect(result.outputPath).toContain('-resized');
    });

    it('should throw on error', async () => {
      mockSharpInstance.toFile.mockRejectedValue(new Error('Resize failed'));

      await expect(
        imageToolsModule.resizeImage({ inputPath: '/test/image.jpg', width: 400 })
      ).rejects.toThrow('Resize failed');
    });
  });

  describe('cropImage', () => {
    it('should crop image with coordinates', async () => {
      const result = await imageToolsModule.cropImage({
        inputPath: '/test/image.jpg',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
      });

      expect(result.success).toBe(true);
      expect(mockSharpInstance.extract).toHaveBeenCalledWith({
        left: 100,
        top: 100,
        width: 200,
        height: 200,
      });
    });

    it('should use custom output path', async () => {
      const result = await imageToolsModule.cropImage({
        inputPath: '/test/image.jpg',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        outputPath: '/test/cropped.jpg',
      });

      expect(result.outputPath).toBe('/test/cropped.jpg');
    });

    it('should generate default output path', async () => {
      const result = await imageToolsModule.cropImage({
        inputPath: '/test/image.jpg',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });

      expect(result.outputPath).toContain('-cropped');
    });
  });

  describe('adjustColors', () => {
    it('should adjust brightness', async () => {
      await imageToolsModule.adjustColors({
        inputPath: '/test/image.jpg',
        brightness: 1.5,
      });

      expect(mockSharpInstance.modulate).toHaveBeenCalledWith({
        brightness: 1.5,
        saturation: undefined,
        hue: undefined,
      });
    });

    it('should adjust saturation', async () => {
      await imageToolsModule.adjustColors({
        inputPath: '/test/image.jpg',
        saturation: 0.8,
      });

      expect(mockSharpInstance.modulate).toHaveBeenCalledWith({
        brightness: undefined,
        saturation: 0.8,
        hue: undefined,
      });
    });

    it('should adjust contrast', async () => {
      await imageToolsModule.adjustColors({
        inputPath: '/test/image.jpg',
        contrast: 1.2,
      });

      expect(mockSharpInstance.linear).toHaveBeenCalled();
    });

    it('should not adjust contrast when set to 1', async () => {
      await imageToolsModule.adjustColors({
        inputPath: '/test/image.jpg',
        contrast: 1,
      });

      expect(mockSharpInstance.linear).not.toHaveBeenCalled();
    });

    it('should adjust hue', async () => {
      await imageToolsModule.adjustColors({
        inputPath: '/test/image.jpg',
        hue: 90,
      });

      expect(mockSharpInstance.modulate).toHaveBeenCalledWith({
        brightness: undefined,
        saturation: undefined,
        hue: 90,
      });
    });
  });

  describe('applyFilter', () => {
    it('should apply grayscale filter', async () => {
      await imageToolsModule.applyFilter({
        inputPath: '/test/image.jpg',
        filter: 'grayscale',
      });

      expect(mockSharpInstance.grayscale).toHaveBeenCalled();
    });

    it('should apply sepia filter', async () => {
      await imageToolsModule.applyFilter({
        inputPath: '/test/image.jpg',
        filter: 'sepia',
      });

      expect(mockSharpInstance.tint).toHaveBeenCalledWith({ r: 112, g: 66, b: 20 });
    });

    it('should apply blur filter with intensity', async () => {
      await imageToolsModule.applyFilter({
        inputPath: '/test/image.jpg',
        filter: 'blur',
        intensity: 0.3,
      });

      expect(mockSharpInstance.blur).toHaveBeenCalledWith(3); // 0.3 * 10
    });

    it('should apply sharpen filter', async () => {
      await imageToolsModule.applyFilter({
        inputPath: '/test/image.jpg',
        filter: 'sharpen',
      });

      expect(mockSharpInstance.sharpen).toHaveBeenCalled();
    });

    it('should apply negative filter', async () => {
      await imageToolsModule.applyFilter({
        inputPath: '/test/image.jpg',
        filter: 'negative',
      });

      expect(mockSharpInstance.negate).toHaveBeenCalled();
    });
  });

  describe('combineImages', () => {
    it('should combine multiple images', async () => {
      const result = await imageToolsModule.combineImages({
        images: [
          { path: '/test/image1.jpg', x: 0, y: 0 },
          { path: '/test/image2.jpg', x: 100, y: 0 },
        ],
        canvasWidth: 400,
        canvasHeight: 300,
        outputPath: '/test/combined.jpg',
      });

      expect(result.success).toBe(true);
      expect(mockSharpInstance.composite).toHaveBeenCalled();
    });

    it('should use custom background color', async () => {
      await imageToolsModule.combineImages({
        images: [{ path: '/test/image.jpg', x: 0, y: 0 }],
        canvasWidth: 400,
        canvasHeight: 300,
        backgroundColor: '#FF0000',
        outputPath: '/test/combined.jpg',
      });

      expect(mockSharp).toHaveBeenCalledWith({
        create: {
          width: 400,
          height: 300,
          channels: 4,
          background: '#FF0000',
        },
      });
    });

    it('should resize images if dimensions specified', async () => {
      await imageToolsModule.combineImages({
        images: [{ path: '/test/image.jpg', x: 0, y: 0, width: 100, height: 100 }],
        canvasWidth: 400,
        canvasHeight: 300,
        outputPath: '/test/combined.jpg',
      });

      expect(mockSharpInstance.resize).toHaveBeenCalledWith(100, 100, { fit: 'cover' });
    });
  });

  describe('removeBackground', () => {
    it('should process image for background removal', async () => {
      const result = await imageToolsModule.removeBackground({
        inputPath: '/test/image.jpg',
      });

      expect(result.success).toBe(true);
      expect(mockSharpInstance.removeAlpha).toHaveBeenCalled();
      expect(mockSharpInstance.ensureAlpha).toHaveBeenCalled();
    });

    it('should use PNG output extension', async () => {
      const result = await imageToolsModule.removeBackground({
        inputPath: '/test/image.jpg',
      });

      expect(result.outputPath).toContain('-nobg.png');
    });
  });

  describe('generateThumbnail', () => {
    it('should generate thumbnail with default size', async () => {
      const result = await imageToolsModule.generateThumbnail({
        inputPath: '/test/image.jpg',
      });

      expect(result.success).toBe(true);
      expect(result.size).toBe(200);
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(200, 200, {
        fit: 'cover',
        position: 'center',
      });
    });

    it('should generate thumbnail with custom size', async () => {
      const result = await imageToolsModule.generateThumbnail({
        inputPath: '/test/image.jpg',
        size: 150,
      });

      expect(result.size).toBe(150);
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(150, 150, {
        fit: 'cover',
        position: 'center',
      });
    });
  });

  describe('optimizeImage', () => {
    it('should optimize JPEG image', async () => {
      const result = await imageToolsModule.optimizeImage({
        inputPath: '/test/image.jpg',
        quality: 75,
      });

      expect(result.success).toBe(true);
      expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({ quality: 75 });
    });

    it('should convert to different format', async () => {
      await imageToolsModule.optimizeImage({
        inputPath: '/test/image.jpg',
        format: 'webp',
        quality: 80,
      });

      expect(mockSharpInstance.webp).toHaveBeenCalledWith({ quality: 80 });
    });

    it('should return file size information', async () => {
      const result = await imageToolsModule.optimizeImage({
        inputPath: '/test/image.jpg',
      });

      expect(result.originalSize).toBeDefined();
      expect(result.newSize).toBeDefined();
      expect(result.savings).toBeDefined();
    });
  });

  describe('rotateImage', () => {
    it('should rotate image by angle', async () => {
      const result = await imageToolsModule.rotateImage({
        inputPath: '/test/image.jpg',
        angle: 90,
      });

      expect(result.success).toBe(true);
      expect(mockSharpInstance.rotate).toHaveBeenCalledWith(90, { background: '#FFFFFF' });
    });

    it('should use custom background color', async () => {
      await imageToolsModule.rotateImage({
        inputPath: '/test/image.jpg',
        angle: 45,
        backgroundColor: '#000000',
      });

      expect(mockSharpInstance.rotate).toHaveBeenCalledWith(45, { background: '#000000' });
    });
  });

  describe('addBorder', () => {
    it('should add border to image', async () => {
      const result = await imageToolsModule.addBorder({
        inputPath: '/test/image.jpg',
        width: 10,
      });

      expect(result.success).toBe(true);
      expect(mockSharpInstance.extend).toHaveBeenCalledWith({
        top: 10,
        bottom: 10,
        left: 10,
        right: 10,
        background: '#000000',
      });
    });

    it('should use custom border color', async () => {
      await imageToolsModule.addBorder({
        inputPath: '/test/image.jpg',
        width: 5,
        color: '#FF0000',
      });

      expect(mockSharpInstance.extend).toHaveBeenCalledWith({
        top: 5,
        bottom: 5,
        left: 5,
        right: 5,
        background: '#FF0000',
      });
    });
  });

  describe('getImageInfo', () => {
    it('should return image metadata', async () => {
      const result = await imageToolsModule.getImageInfo({
        inputPath: '/test/image.jpg',
      });

      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(result.format).toBe('jpeg');
      expect(result.hasAlpha).toBe(false);
    });

    it('should calculate aspect ratio', async () => {
      const result = await imageToolsModule.getImageInfo({
        inputPath: '/test/image.jpg',
      });

      expect(result.aspectRatio).toContain('800:600');
    });

    it('should return file size', async () => {
      const result = await imageToolsModule.getImageInfo({
        inputPath: '/test/image.jpg',
      });

      expect(result.size).toBe(100000);
    });

    it('should handle missing metadata', async () => {
      mockSharpInstance.metadata.mockResolvedValue({});

      const result = await imageToolsModule.getImageInfo({
        inputPath: '/test/image.jpg',
      });

      expect(result.width).toBe(0);
      expect(result.height).toBe(0);
      expect(result.format).toBe('unknown');
    });
  });

  describe('Output path generation', () => {
    it('should generate correct resize output path', async () => {
      const result = await imageToolsModule.resizeImage({
        inputPath: '/test/photo.jpg',
        width: 500,
      });

      expect(result.outputPath).toBe('/test/photo-resized500.jpg');
    });

    it('should generate correct crop output path', async () => {
      const result = await imageToolsModule.cropImage({
        inputPath: '/test/photo.png',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      });

      expect(result.outputPath).toBe('/test/photo-cropped.png');
    });

    it('should generate correct filter output path', async () => {
      const result = await imageToolsModule.applyFilter({
        inputPath: '/test/photo.jpg',
        filter: 'grayscale',
      });

      expect(result.outputPath).toBe('/test/photo-grayscale.jpg');
    });

    it('should generate correct rotate output path', async () => {
      const result = await imageToolsModule.rotateImage({
        inputPath: '/test/photo.jpg',
        angle: 180,
      });

      expect(result.outputPath).toBe('/test/photo-rotated180.jpg');
    });
  });

  describe('Error handling', () => {
    it('should throw on crop error', async () => {
      mockSharpInstance.toFile.mockRejectedValue(new Error('Crop failed'));

      await expect(
        imageToolsModule.cropImage({
          inputPath: '/test/image.jpg',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        })
      ).rejects.toThrow('Crop failed');
    });

    it('should throw on filter error', async () => {
      mockSharpInstance.toFile.mockRejectedValue(new Error('Filter failed'));

      await expect(
        imageToolsModule.applyFilter({
          inputPath: '/test/image.jpg',
          filter: 'grayscale',
        })
      ).rejects.toThrow('Filter failed');
    });

    it('should throw on combine error', async () => {
      mockSharpInstance.toFile.mockRejectedValue(new Error('Combine failed'));

      await expect(
        imageToolsModule.combineImages({
          images: [{ path: '/test/image.jpg', x: 0, y: 0 }],
          canvasWidth: 400,
          canvasHeight: 300,
          outputPath: '/test/output.jpg',
        })
      ).rejects.toThrow('Combine failed');
    });

    it('should throw on optimize error', async () => {
      mockSharpInstance.toFile.mockRejectedValue(new Error('Optimize failed'));

      await expect(
        imageToolsModule.optimizeImage({
          inputPath: '/test/image.jpg',
        })
      ).rejects.toThrow('Optimize failed');
    });
  });

  describe('Fit options', () => {
    it('should use cover fit', async () => {
      await imageToolsModule.resizeImage({
        inputPath: '/test/image.jpg',
        width: 400,
        height: 300,
        fit: 'cover',
      });

      expect(mockSharpInstance.resize).toHaveBeenCalledWith(400, 300, { fit: 'cover' });
    });

    it('should use contain fit', async () => {
      await imageToolsModule.resizeImage({
        inputPath: '/test/image.jpg',
        width: 400,
        height: 300,
        fit: 'contain',
      });

      expect(mockSharpInstance.resize).toHaveBeenCalledWith(400, 300, { fit: 'contain' });
    });

    it('should use fill fit', async () => {
      await imageToolsModule.resizeImage({
        inputPath: '/test/image.jpg',
        width: 400,
        height: 300,
        fit: 'fill',
      });

      expect(mockSharpInstance.resize).toHaveBeenCalledWith(400, 300, { fit: 'fill' });
    });
  });
});
