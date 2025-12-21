/**
 * Tests for Imagen Tools
 * TASK-040 Phase 3: Comprehensive tests for Imagen MCP integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs/promises
const mockFs = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: mockFs,
  readFile: mockFs.readFile,
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  listImagenModels,
  getImagenPromptGuide,
  generateImageWithImagen,
  type ImagenModelInfo,
  type ImagenPromptGuide,
  type GenerateImageResponse,
} from './imagen-tools.js';

describe('Imagen Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock mcp.json config
    mockFs.readFile.mockResolvedValue(JSON.stringify({
      imagen: {
        url: 'http://localhost:8081',
      },
    }));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('listImagenModels', () => {
    it('should return list of models on success', async () => {
      const mockModels: ImagenModelInfo[] = [
        {
          model_id: 'imagen-4-ultra',
          name: 'Imagen 4 Ultra',
          feature: 'High quality',
          input: 'text',
          output: 'image',
          price_per_image: 0.06,
          technical_id: 'imagen-4.0-generate-001',
        },
        {
          model_id: 'imagen-4-fast',
          name: 'Imagen 4 Fast',
          feature: 'Fast generation',
          input: 'text',
          output: 'image',
          price_per_image: 0.02,
          technical_id: 'imagen-4.0-fast-001',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockModels),
      });

      const result = await listImagenModels();

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8081/models');
      expect(result).toEqual(mockModels);
      expect(result).toHaveLength(2);
    });

    it('should throw error when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(listImagenModels()).rejects.toThrow('Failed to fetch Imagen models');
    });

    it('should throw error when mcp.json is missing imagen config', async () => {
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({}));

      await expect(listImagenModels()).rejects.toThrow("Could not find 'imagen' service");
    });

    it('should throw error when mcp.json is invalid', async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error('File not found'));

      await expect(listImagenModels()).rejects.toThrow('Failed to get Imagen base URL');
    });
  });

  describe('getImagenPromptGuide', () => {
    it('should return prompt guide on success', async () => {
      const mockGuide: ImagenPromptGuide = {
        general_tips: [
          'Be specific and detailed',
          'Use descriptive adjectives',
          'Specify art style',
        ],
        model_specific_tips: {
          'imagen-4-ultra': 'Best for photorealistic images',
          'imagen-4-fast': 'Good for quick iterations',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGuide),
      });

      const result = await getImagenPromptGuide();

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8081/prompt-guide');
      expect(result.general_tips).toHaveLength(3);
      expect(result.model_specific_tips['imagen-4-ultra']).toBeDefined();
    });

    it('should throw error when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      });

      await expect(getImagenPromptGuide()).rejects.toThrow('Failed to fetch Imagen prompt guide');
    });
  });

  describe('generateImageWithImagen', () => {
    it('should generate image with minimal params', async () => {
      const mockResponse: GenerateImageResponse = {
        message: 'Image generated successfully',
        model_used: 'imagen-4-fast',
        images_base64: ['base64encodedimage=='],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await generateImageWithImagen(
        'imagen-4-fast',
        'A beautiful sunset over mountains'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8081/generate',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      expect(result.images_base64).toHaveLength(1);
    });

    it('should include negative prompt', async () => {
      const mockResponse: GenerateImageResponse = {
        message: 'Success',
        model_used: 'imagen-4-ultra',
        images_base64: ['image1=='],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await generateImageWithImagen(
        'imagen-4-ultra',
        'Professional cryptocurrency banner',
        'blurry, low quality, ugly'
      );

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.negative_prompt).toBe('blurry, low quality, ugly');
    });

    it('should request multiple images', async () => {
      const mockResponse: GenerateImageResponse = {
        message: 'Success',
        model_used: 'imagen-4-fast',
        images_base64: ['image1==', 'image2==', 'image3=='],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await generateImageWithImagen(
        'imagen-4-fast',
        'A cat',
        undefined,
        3
      );

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.number_of_images).toBe(3);
      expect(result.images_base64).toHaveLength(3);
    });

    it('should throw error when generation fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      });

      await expect(
        generateImageWithImagen('imagen-4-ultra', 'test prompt')
      ).rejects.toThrow('Failed to generate image with Imagen');
    });

    it('should default to 1 image', async () => {
      const mockResponse: GenerateImageResponse = {
        message: 'Success',
        model_used: 'imagen-4-fast',
        images_base64: ['image1=='],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await generateImageWithImagen('imagen-4-fast', 'test');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.number_of_images).toBe(1);
    });
  });
});

describe('Type Definitions', () => {
  it('should have correct ImagenModelInfo structure', () => {
    const model: ImagenModelInfo = {
      model_id: 'test',
      name: 'Test Model',
      feature: 'Testing',
      input: 'text',
      output: 'image',
      price_per_image: 0.05,
      technical_id: 'test-001',
    };

    expect(model.model_id).toBe('test');
    expect(model.price_per_image).toBe(0.05);
  });

  it('should have correct ImagenPromptGuide structure', () => {
    const guide: ImagenPromptGuide = {
      general_tips: ['tip1', 'tip2'],
      model_specific_tips: { model1: 'tip' },
    };

    expect(guide.general_tips).toHaveLength(2);
    expect(guide.model_specific_tips.model1).toBe('tip');
  });

  it('should have correct GenerateImageResponse structure', () => {
    const response: GenerateImageResponse = {
      message: 'ok',
      model_used: 'model1',
      images_base64: ['data'],
    };

    expect(response.images_base64).toHaveLength(1);
  });
});
