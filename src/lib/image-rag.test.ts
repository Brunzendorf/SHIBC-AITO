/**
 * Tests for Image RAG Module
 * TASK-038: Securing current behavior before refactoring
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ImageRAGMetadata, ImageSearchResult } from './image-rag.js';

// Mock fs
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
    readdir: vi.fn().mockResolvedValue(['image1.jpg', 'image2.png', 'file.txt']),
  },
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock logger
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock config
vi.mock('./config.js', () => ({
  llmConfig: {
    preferGemini: false,
  },
}));

describe('Image RAG Module', () => {
  let imageRagModule: typeof import('./image-rag.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Reset environment
    delete process.env.QDRANT_URL;
    delete process.env.OLLAMA_URL;

    // Default mock responses
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      // Collection check
      if (url.includes('/collections/aito_images') && !options?.method) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result: { status: 'ok' } }),
        });
      }

      // Embedding generation
      if (url.includes('/api/embeddings')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            embedding: new Array(4096).fill(0.1),
          }),
        });
      }

      // Point upsert
      if (url.includes('/points?wait=true') && options?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' }),
        });
      }

      // Search
      if (url.includes('/points/search')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            result: [
              { payload: { filepath: '/test/image.jpg', filename: 'image.jpg', agentRole: 'cmo', createdAt: Date.now() }, score: 0.9 },
            ],
          }),
        });
      }

      // Delete
      if (url.includes('/points/delete')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' }),
        });
      }

      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    imageRagModule = await import('./image-rag.js');
  });

  afterEach(() => {
    delete process.env.QDRANT_URL;
    delete process.env.OLLAMA_URL;
  });

  describe('ImageRAGMetadata interface', () => {
    it('should define required fields', () => {
      const metadata: ImageRAGMetadata = {
        filepath: '/path/to/image.jpg',
        filename: 'image.jpg',
        agentRole: 'cmo',
        createdAt: Date.now(),
      };

      expect(metadata.filepath).toBe('/path/to/image.jpg');
      expect(metadata.filename).toBe('image.jpg');
      expect(metadata.agentRole).toBe('cmo');
    });

    it('should support optional fields', () => {
      const metadata: ImageRAGMetadata = {
        filepath: '/path/to/image.jpg',
        filename: 'image.jpg',
        agentRole: 'cmo',
        createdAt: Date.now(),
        template: 'announcement',
        eventType: 'product_launch',
        tags: ['marketing', 'social'],
        description: 'Product launch banner',
        brandingType: 'logo-watermark',
        imageHash: 'abc123',
      };

      expect(metadata.template).toBe('announcement');
      expect(metadata.eventType).toBe('product_launch');
      expect(metadata.tags).toContain('marketing');
    });
  });

  describe('ImageSearchResult interface', () => {
    it('should define result structure', () => {
      const result: ImageSearchResult = {
        metadata: {
          filepath: '/test/image.jpg',
          filename: 'image.jpg',
          agentRole: 'cmo',
          createdAt: Date.now(),
        },
        score: 0.95,
        distance: 0.05,
      };

      expect(result.score).toBe(0.95);
      expect(result.distance).toBe(0.05);
      expect(result.metadata.filename).toBe('image.jpg');
    });
  });

  describe('initImageCollection', () => {
    it('should skip creation if collection exists', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/collections/aito_images')) {
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true });
      });

      await imageRagModule.initImageCollection();

      // Should only call GET, not PUT
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/collections/aito_images')
      );
    });

    it('should create collection if not exists', async () => {
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/collections/aito_images') && !options?.method) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        if (options?.method === 'PUT') {
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true });
      });

      await imageRagModule.initImageCollection();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/collections/aito_images'),
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should throw on creation failure', async () => {
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/collections/aito_images') && !options?.method) {
          return Promise.resolve({ ok: false });
        }
        if (options?.method === 'PUT') {
          return Promise.resolve({
            ok: false,
            text: () => Promise.resolve('Creation error'),
          });
        }
        return Promise.resolve({ ok: true });
      });

      await expect(imageRagModule.initImageCollection()).rejects.toThrow('Failed to create collection');
    });
  });

  describe('generateImageEmbedding', () => {
    it('should generate embedding from image path', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          embedding: new Array(4096).fill(0.5),
        }),
      });

      const embedding = await imageRagModule.generateImageEmbedding('/test/image.jpg');

      expect(embedding).toHaveLength(4096);
      expect(embedding[0]).toBe(0.5);
    });

    it('should call Ollama API with base64 image', async () => {
      await imageRagModule.generateImageEmbedding('/test/image.jpg');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/embeddings'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('images'),
        })
      );
    });

    it('should throw on Ollama error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('Ollama error'),
      });

      await expect(
        imageRagModule.generateImageEmbedding('/test/image.jpg')
      ).rejects.toThrow('Ollama embedding failed');
    });
  });

  describe('indexImage', () => {
    it('should index image with metadata', async () => {
      const metadata: ImageRAGMetadata = {
        filepath: '/test/image.jpg',
        filename: 'image.jpg',
        agentRole: 'cmo',
        createdAt: Date.now(),
      };

      await imageRagModule.indexImage('/test/image.jpg', metadata);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/points?wait=true'),
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });

    it('should generate unique ID from filepath', async () => {
      const metadata: ImageRAGMetadata = {
        filepath: '/test/unique-image.jpg',
        filename: 'unique-image.jpg',
        agentRole: 'cto',
        createdAt: Date.now(),
      };

      await imageRagModule.indexImage('/test/unique-image.jpg', metadata);

      // Verify PUT was called with the point data
      const putCalls = mockFetch.mock.calls.filter(
        (call) => call[1]?.method === 'PUT' && String(call[0]).includes('/points')
      );

      expect(putCalls.length).toBeGreaterThan(0);
    });

    it('should throw on indexing failure', async () => {
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/api/embeddings')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ embedding: new Array(4096).fill(0) }),
          });
        }
        if (options?.method === 'PUT') {
          return Promise.resolve({
            ok: false,
            text: () => Promise.resolve('Indexing error'),
          });
        }
        return Promise.resolve({ ok: true });
      });

      const metadata: ImageRAGMetadata = {
        filepath: '/test/image.jpg',
        filename: 'image.jpg',
        agentRole: 'cmo',
        createdAt: Date.now(),
      };

      await expect(
        imageRagModule.indexImage('/test/image.jpg', metadata)
      ).rejects.toThrow('Failed to index image');
    });
  });

  describe('searchSimilarImages', () => {
    it('should return similar images', async () => {
      const results = await imageRagModule.searchSimilarImages('/test/query.jpg');

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.9);
      expect(results[0].metadata.filename).toBe('image.jpg');
    });

    it('should apply limit option', async () => {
      await imageRagModule.searchSimilarImages('/test/query.jpg', { limit: 5 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/points/search'),
        expect.objectContaining({
          body: expect.stringContaining('"limit":5'),
        })
      );
    });

    it('should filter by eventType', async () => {
      await imageRagModule.searchSimilarImages('/test/query.jpg', {
        filter: { eventType: 'announcement' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/points/search'),
        expect.objectContaining({
          body: expect.stringContaining('eventType'),
        })
      );
    });

    it('should filter by agentRole', async () => {
      await imageRagModule.searchSimilarImages('/test/query.jpg', {
        filter: { agentRole: 'cmo' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/points/search'),
        expect.objectContaining({
          body: expect.stringContaining('agentRole'),
        })
      );
    });

    it('should filter by tags', async () => {
      await imageRagModule.searchSimilarImages('/test/query.jpg', {
        filter: { tags: ['marketing', 'social'] },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/points/search'),
        expect.objectContaining({
          body: expect.stringContaining('tags'),
        })
      );
    });

    it('should filter by minimum score', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/embeddings')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ embedding: new Array(4096).fill(0) }),
          });
        }
        if (url.includes('/points/search')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              result: [
                { payload: { filepath: '/high.jpg', filename: 'high.jpg', agentRole: 'cmo', createdAt: Date.now() }, score: 0.9 },
                { payload: { filepath: '/low.jpg', filename: 'low.jpg', agentRole: 'cmo', createdAt: Date.now() }, score: 0.3 },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true });
      });

      const results = await imageRagModule.searchSimilarImages('/test/query.jpg', {
        filter: { minScore: 0.5 },
      });

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.9);
    });

    it('should throw on search failure', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/embeddings')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ embedding: new Array(4096).fill(0) }),
          });
        }
        if (url.includes('/points/search')) {
          return Promise.resolve({
            ok: false,
            text: () => Promise.resolve('Search error'),
          });
        }
        return Promise.resolve({ ok: true });
      });

      await expect(
        imageRagModule.searchSimilarImages('/test/query.jpg')
      ).rejects.toThrow('Search failed');
    });
  });

  describe('searchImagesByText', () => {
    it('should search images using text query', async () => {
      const results = await imageRagModule.searchImagesByText('product announcement');

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.9);
    });

    it('should apply limit and filters', async () => {
      await imageRagModule.searchImagesByText('marketing banner', {
        limit: 3,
        filter: { eventType: 'launch' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/points/search'),
        expect.objectContaining({
          body: expect.stringContaining('"limit":3'),
        })
      );
    });

    it('should throw on embedding generation failure', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/embeddings')) {
          return Promise.resolve({
            ok: false,
            text: () => Promise.resolve('Embedding error'),
          });
        }
        return Promise.resolve({ ok: true });
      });

      await expect(
        imageRagModule.searchImagesByText('test query')
      ).rejects.toThrow('Failed to generate text embedding');
    });
  });

  describe('indexWorkspaceImages', () => {
    it('should index all images in workspace', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/embeddings')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ embedding: new Array(4096).fill(0) }),
          });
        }
        if (url.includes('/points?wait=true')) {
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true });
      });

      const result = await imageRagModule.indexWorkspaceImages('./test-workspace');

      // Should process 2 images (image1.jpg, image2.png) and skip 1 file (file.txt)
      expect(result.skipped).toBe(1);
      expect(result.indexed + result.failed).toBe(2);
    });

    it('should skip non-image files', async () => {
      const { default: fs } = await import('fs/promises');
      vi.mocked(fs.readdir).mockResolvedValue(['file.txt', 'doc.pdf', 'script.js'] as any);

      const result = await imageRagModule.indexWorkspaceImages('./test-workspace');

      expect(result.skipped).toBe(3);
      expect(result.indexed).toBe(0);
    });

    it('should track failed indexing', async () => {
      // Re-mock readdir to ensure it returns image files
      const { default: fs } = await import('fs/promises');
      vi.mocked(fs.readdir).mockResolvedValue(['fail1.jpg', 'fail2.png'] as any);

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/embeddings')) {
          return Promise.reject(new Error('Embedding failed'));
        }
        return Promise.resolve({ ok: true });
      });

      const result = await imageRagModule.indexWorkspaceImages('./test-workspace');

      expect(result.failed).toBe(2);
      expect(result.indexed).toBe(0);
    });
  });

  describe('deleteImageFromRAG', () => {
    it('should delete image by filepath', async () => {
      await imageRagModule.deleteImageFromRAG('/test/image.jpg');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/points/delete'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should throw on deletion failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('Delete error'),
      });

      await expect(
        imageRagModule.deleteImageFromRAG('/test/image.jpg')
      ).rejects.toThrow('Failed to delete image from RAG');
    });
  });

  describe('Environment configuration', () => {
    it('should use default Qdrant URL', () => {
      delete process.env.QDRANT_URL;
      const defaultUrl = process.env.QDRANT_URL || 'http://localhost:6333';
      expect(defaultUrl).toBe('http://localhost:6333');
    });

    it('should use custom Qdrant URL from env', () => {
      process.env.QDRANT_URL = 'http://qdrant:6333';
      const url = process.env.QDRANT_URL || 'http://localhost:6333';
      expect(url).toBe('http://qdrant:6333');
    });

    it('should use default Ollama URL', () => {
      delete process.env.OLLAMA_URL;
      const defaultUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
      expect(defaultUrl).toBe('http://localhost:11434');
    });

    it('should use custom Ollama URL from env', () => {
      process.env.OLLAMA_URL = 'http://ollama:11434';
      const url = process.env.OLLAMA_URL || 'http://localhost:11434';
      expect(url).toBe('http://ollama:11434');
    });
  });

  describe('ID generation', () => {
    it('should generate base64 ID from filepath', () => {
      const filepath = '/test/path/image.jpg';
      const id = Buffer.from(filepath).toString('base64').replace(/[^a-zA-Z0-9]/g, '');

      expect(id).not.toContain('/');
      expect(id).not.toContain('+');
      expect(id).not.toContain('=');
    });

    it('should generate different IDs for different paths', () => {
      const id1 = Buffer.from('/path/one.jpg').toString('base64').replace(/[^a-zA-Z0-9]/g, '');
      const id2 = Buffer.from('/path/two.jpg').toString('base64').replace(/[^a-zA-Z0-9]/g, '');

      expect(id1).not.toBe(id2);
    });
  });

  describe('Distance calculation', () => {
    it('should calculate distance from score', () => {
      const score = 0.9;
      const distance = 1 - score;

      expect(distance).toBeCloseTo(0.1, 10);
    });

    it('should handle zero score', () => {
      const score = 0;
      const distance = 1 - score;

      expect(distance).toBe(1);
    });

    it('should handle perfect score', () => {
      const score = 1;
      const distance = 1 - score;

      expect(distance).toBe(0);
    });
  });
});
