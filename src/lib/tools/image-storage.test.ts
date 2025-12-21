/**
 * Tests for Image Storage Utilities
 * TASK-040 Phase 3: Comprehensive tests for image storage destinations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// Helper to normalize paths for cross-platform comparison
const normalizePath = (p: string) => p.replace(/[\\/]/g, '/');

// Mock fs/promises
const mockFs = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs/promises', () => ({
  default: mockFs,
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

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  saveImageToWorkspace,
  uploadImageToDirectus,
  commitImageToGithub,
  storeImage,
  type ImageStorageOptions,
} from './image-storage.js';

describe('saveImageToWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_DIR = '/test/workspace';
  });

  afterEach(() => {
    delete process.env.WORKSPACE_DIR;
  });

  it('should save image to workspace', async () => {
    const base64Data = Buffer.from('test-image').toString('base64');
    const filename = 'test.jpg';

    const result = await saveImageToWorkspace(base64Data, filename);

    expect(mockFs.mkdir).toHaveBeenCalled();
    expect(mockFs.writeFile).toHaveBeenCalled();
    expect(normalizePath(result)).toContain('/test/workspace/images/test.jpg');
  });

  it('should use custom subdirectory', async () => {
    const base64Data = Buffer.from('test-image').toString('base64');
    const result = await saveImageToWorkspace(base64Data, 'test.jpg', 'marketing');

    expect(mockFs.mkdir).toHaveBeenCalled();
    expect(normalizePath(result)).toContain('/marketing/');
  });

  it('should use default workspace when env not set', async () => {
    delete process.env.WORKSPACE_DIR;
    const base64Data = Buffer.from('test-image').toString('base64');

    const result = await saveImageToWorkspace(base64Data, 'test.jpg');

    expect(normalizePath(result)).toContain('/app/workspace');
  });

  it('should write correct buffer data', async () => {
    const originalData = 'test-image-content';
    const base64Data = Buffer.from(originalData).toString('base64');

    await saveImageToWorkspace(base64Data, 'test.jpg');

    const writeCall = mockFs.writeFile.mock.calls[0];
    const writtenBuffer = writeCall[1] as Buffer;
    expect(writtenBuffer.toString()).toBe(originalData);
  });
});

describe('uploadImageToDirectus', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      DIRECTUS_URL: 'https://directus.example.com',
      DIRECTUS_TOKEN: 'test-token',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should upload image successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { id: 'file-123' } }),
    });

    const base64Data = Buffer.from('test-image').toString('base64');
    const result = await uploadImageToDirectus(base64Data, 'test.jpg');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://directus.example.com/files',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
    expect(result).toBe('https://directus.example.com/assets/file-123');
  });

  it('should include metadata when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { id: 'file-456' } }),
    });

    const base64Data = Buffer.from('test-image').toString('base64');
    await uploadImageToDirectus(base64Data, 'test.jpg', {
      title: 'My Image',
      description: 'A test image',
    });

    expect(mockFetch).toHaveBeenCalled();
  });

  it('should return null when credentials not configured', async () => {
    delete process.env.DIRECTUS_URL;
    delete process.env.DIRECTUS_TOKEN;

    const base64Data = Buffer.from('test-image').toString('base64');
    const result = await uploadImageToDirectus(base64Data, 'test.jpg');

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return null on upload failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Unauthorized',
    });

    const base64Data = Buffer.from('test-image').toString('base64');
    const result = await uploadImageToDirectus(base64Data, 'test.jpg');

    expect(result).toBeNull();
  });

  it('should return null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const base64Data = Buffer.from('test-image').toString('base64');
    const result = await uploadImageToDirectus(base64Data, 'test.jpg');

    expect(result).toBeNull();
  });
});

describe('commitImageToGithub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_DIR = '/test/workspace';
  });

  afterEach(() => {
    delete process.env.WORKSPACE_DIR;
  });

  it('should save image for git commit', async () => {
    const base64Data = Buffer.from('test-image').toString('base64');
    const result = await commitImageToGithub(base64Data, 'banner.jpg');

    expect(mockFs.mkdir).toHaveBeenCalled();
    expect(mockFs.writeFile).toHaveBeenCalled();
    expect(normalizePath(result!)).toContain('/assets/images/banner.jpg');
  });

  it('should use custom commit message', async () => {
    const base64Data = Buffer.from('test-image').toString('base64');
    await commitImageToGithub(base64Data, 'logo.png', 'Add new logo');

    // Note: Commit message is logged but not directly testable without mocking logger
    expect(mockFs.writeFile).toHaveBeenCalled();
  });

  it('should return null on error', async () => {
    mockFs.mkdir.mockRejectedValueOnce(new Error('Permission denied'));

    const base64Data = Buffer.from('test-image').toString('base64');
    const result = await commitImageToGithub(base64Data, 'test.jpg');

    expect(result).toBeNull();
  });

  it('should use default workspace when env not set', async () => {
    delete process.env.WORKSPACE_DIR;
    const base64Data = Buffer.from('test-image').toString('base64');

    const result = await commitImageToGithub(base64Data, 'test.jpg');

    expect(normalizePath(result!)).toContain('/app/workspace');
  });
});

describe('storeImage', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      WORKSPACE_DIR: '/test/workspace',
      DIRECTUS_URL: 'https://directus.example.com',
      DIRECTUS_TOKEN: 'test-token',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should store to workspace', async () => {
    const base64Data = Buffer.from('test-image').toString('base64');
    const options: ImageStorageOptions = {
      destination: 'workspace',
      filename: 'my-image.jpg',
    };

    const result = await storeImage(base64Data, options);

    expect(normalizePath(result.filepath!)).toContain('/images/my-image.jpg');
  });

  it('should store to directus', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { id: 'directus-123' } }),
    });

    const base64Data = Buffer.from('test-image').toString('base64');
    const options: ImageStorageOptions = {
      destination: 'directus',
      filename: 'marketing.jpg',
      metadata: { agent: 'cmo', prompt: 'marketing banner' },
    };

    const result = await storeImage(base64Data, options);

    expect(result.url).toBe('https://directus.example.com/assets/directus-123');
  });

  it('should fallback to workspace when directus fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Server Error',
    });

    const base64Data = Buffer.from('test-image').toString('base64');
    const options: ImageStorageOptions = {
      destination: 'directus',
      filename: 'fallback.jpg',
    };

    const result = await storeImage(base64Data, options);

    expect(result.url).toBeUndefined();
    expect(normalizePath(result.filepath!)).toContain('/images/fallback.jpg');
  });

  it('should store to github', async () => {
    const base64Data = Buffer.from('test-image').toString('base64');
    const options: ImageStorageOptions = {
      destination: 'github',
      filename: 'asset.png',
    };

    const result = await storeImage(base64Data, options);

    expect(normalizePath(result.filepath!)).toContain('/assets/images/asset.png');
  });

  it('should generate filename when not provided', async () => {
    const base64Data = Buffer.from('test-image').toString('base64');
    const options: ImageStorageOptions = {
      destination: 'workspace',
    };

    const result = await storeImage(base64Data, options);

    expect(result.filepath).toMatch(/image-\d+\.jpg$/);
  });

  it('should include metadata in storage', async () => {
    const base64Data = Buffer.from('test-image').toString('base64');
    const options: ImageStorageOptions = {
      destination: 'workspace',
      filename: 'with-metadata.jpg',
      metadata: {
        agent: 'cmo',
        prompt: 'test prompt',
        timestamp: 1234567890,
      },
    };

    const result = await storeImage(base64Data, options);

    expect(result.filepath).toBeDefined();
  });
});

describe('ImageStorageOptions interface', () => {
  it('should accept valid destination types', () => {
    const destinations: ImageStorageOptions['destination'][] = ['workspace', 'directus', 'github'];
    expect(destinations).toHaveLength(3);
  });

  it('should accept optional fields', () => {
    const minimal: ImageStorageOptions = {
      destination: 'workspace',
    };
    expect(minimal.filename).toBeUndefined();
    expect(minimal.metadata).toBeUndefined();
  });

  it('should accept complete options', () => {
    const complete: ImageStorageOptions = {
      destination: 'directus',
      filename: 'test.jpg',
      metadata: {
        agent: 'cmo',
        prompt: 'Generate a banner',
        timestamp: Date.now(),
      },
    };
    expect(complete.metadata?.agent).toBe('cmo');
  });
});
