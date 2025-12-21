/**
 * Tests for Secrets Manager (TASK-034)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs modules
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

// Mock logger
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Secrets Manager', () => {
  let existsSync: any;
  let readFile: any;
  let secretsModule: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Import mocks
    const fs = await import('fs');
    const fsPromises = await import('fs/promises');
    existsSync = vi.mocked(fs.existsSync);
    readFile = vi.mocked(fsPromises.readFile);

    // Default: no docker secrets or file secrets, just env
    existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('EnvBackend', () => {
    beforeEach(async () => {
      existsSync.mockReturnValue(false);
      secretsModule = await import('./secrets.js');
    });

    it('should get value from environment variable', async () => {
      process.env.TEST_SECRET = 'test-value';

      const value = await secretsModule.secrets.get('TEST_SECRET');

      expect(value).toBe('test-value');
      delete process.env.TEST_SECRET;
    });

    it('should return undefined for missing env var', async () => {
      delete process.env.MISSING_VAR;

      const value = await secretsModule.secrets.get('MISSING_VAR');

      expect(value).toBeUndefined();
    });

    it('should check if secret exists in env', async () => {
      process.env.EXISTS_SECRET = 'exists';

      const exists = await secretsModule.secrets.has('EXISTS_SECRET');

      expect(exists).toBe(true);
      delete process.env.EXISTS_SECRET;
    });

    it('should return false for missing secret in has()', async () => {
      delete process.env.NOT_EXISTS;

      const exists = await secretsModule.secrets.has('NOT_EXISTS');

      expect(exists).toBe(false);
    });
  });

  describe('SecretsManager.get', () => {
    beforeEach(async () => {
      existsSync.mockReturnValue(false);
      secretsModule = await import('./secrets.js');
    });

    it('should return default value when secret not found', async () => {
      delete process.env.OPTIONAL_SECRET;

      const value = await secretsModule.secrets.get('OPTIONAL_SECRET', {
        defaultValue: 'default',
      });

      expect(value).toBe('default');
    });

    it('should throw when required secret not found', async () => {
      delete process.env.REQUIRED_SECRET;

      await expect(
        secretsModule.secrets.get('REQUIRED_SECRET', { required: true })
      ).rejects.toThrow('Required secret not found: REQUIRED_SECRET');
    });

    it('should not throw for required secret with default value', async () => {
      delete process.env.REQUIRED_WITH_DEFAULT;

      const value = await secretsModule.secrets.get('REQUIRED_WITH_DEFAULT', {
        required: true,
        defaultValue: 'fallback',
      });

      expect(value).toBe('fallback');
    });

    it('should cache values', async () => {
      process.env.CACHED_SECRET = 'cached';

      // First call
      const value1 = await secretsModule.secrets.get('CACHED_SECRET');
      expect(value1).toBe('cached');

      // Change env (should still get cached value)
      process.env.CACHED_SECRET = 'changed';
      const value2 = await secretsModule.secrets.get('CACHED_SECRET');
      expect(value2).toBe('cached'); // Still cached

      delete process.env.CACHED_SECRET;
    });
  });

  describe('SecretsManager.getRequired', () => {
    beforeEach(async () => {
      existsSync.mockReturnValue(false);
      secretsModule = await import('./secrets.js');
    });

    it('should return value for existing secret', async () => {
      process.env.REQUIRED_EXISTS = 'value';

      const value = await secretsModule.secrets.getRequired('REQUIRED_EXISTS');

      expect(value).toBe('value');
      delete process.env.REQUIRED_EXISTS;
    });

    it('should throw for missing required secret', async () => {
      delete process.env.MISSING_REQUIRED;

      await expect(
        secretsModule.secrets.getRequired('MISSING_REQUIRED')
      ).rejects.toThrow('Required secret not found');
    });
  });

  describe('SecretsManager cache operations', () => {
    beforeEach(async () => {
      existsSync.mockReturnValue(false);
      secretsModule = await import('./secrets.js');
    });

    it('should clear cache', async () => {
      process.env.CACHE_TEST = 'original';

      // Cache the value
      await secretsModule.secrets.get('CACHE_TEST');

      // Clear cache
      secretsModule.secrets.clearCache();

      // Change value and get again
      process.env.CACHE_TEST = 'new-value';
      const value = await secretsModule.secrets.get('CACHE_TEST');

      expect(value).toBe('new-value');
      delete process.env.CACHE_TEST;
    });

    it('should invalidate specific key', async () => {
      process.env.INVALIDATE_TEST = 'first';

      // Cache the value
      await secretsModule.secrets.get('INVALIDATE_TEST');

      // Invalidate this key
      secretsModule.secrets.invalidate('INVALIDATE_TEST');

      // Change and get again
      process.env.INVALIDATE_TEST = 'second';
      const value = await secretsModule.secrets.get('INVALIDATE_TEST');

      expect(value).toBe('second');
      delete process.env.INVALIDATE_TEST;
    });
  });

  describe('SecretsManager.getBackends', () => {
    it('should list env backend when no docker or file secrets', async () => {
      existsSync.mockReturnValue(false);
      secretsModule = await import('./secrets.js');

      const backends = secretsModule.secrets.getBackends();

      expect(backends).toContain('env');
    });
  });

  describe('Helper functions', () => {
    beforeEach(async () => {
      existsSync.mockReturnValue(false);
      secretsModule = await import('./secrets.js');
    });

    it('getGitHubToken should return GITHUB_TOKEN', async () => {
      process.env.GITHUB_TOKEN = 'gh-token-123';

      const token = await secretsModule.getGitHubToken();

      expect(token).toBe('gh-token-123');
      delete process.env.GITHUB_TOKEN;
    });

    it('getDatabaseUrl should throw when POSTGRES_URL missing', async () => {
      delete process.env.POSTGRES_URL;

      await expect(secretsModule.getDatabaseUrl()).rejects.toThrow();
    });

    it('getDatabaseUrl should return POSTGRES_URL', async () => {
      process.env.POSTGRES_URL = 'postgres://localhost/db';

      const url = await secretsModule.getDatabaseUrl();

      expect(url).toBe('postgres://localhost/db');
      delete process.env.POSTGRES_URL;
    });

    it('getRedisUrl should return default if not set', async () => {
      delete process.env.REDIS_URL;

      const url = await secretsModule.getRedisUrl();

      expect(url).toBe('redis://localhost:6379');
    });

    it('getRedisUrl should return REDIS_URL if set', async () => {
      process.env.REDIS_URL = 'redis://custom:6380';

      const url = await secretsModule.getRedisUrl();

      expect(url).toBe('redis://custom:6380');
      delete process.env.REDIS_URL;
    });

    it('getTelegramToken should return TELEGRAM_BOT_TOKEN', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'tg-token';

      const token = await secretsModule.getTelegramToken();

      expect(token).toBe('tg-token');
      delete process.env.TELEGRAM_BOT_TOKEN;
    });

    describe('getApiKey', () => {
      it('should return API key for known service', async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-123';

        const key = await secretsModule.getApiKey('anthropic');

        expect(key).toBe('sk-ant-123');
        delete process.env.ANTHROPIC_API_KEY;
      });

      it('should throw for unknown service', async () => {
        await expect(secretsModule.getApiKey('unknown-service')).rejects.toThrow(
          'Unknown service: unknown-service'
        );
      });

      it('should be case-insensitive', async () => {
        process.env.OPENAI_API_KEY = 'sk-openai';

        const key = await secretsModule.getApiKey('OpenAI');

        expect(key).toBe('sk-openai');
        delete process.env.OPENAI_API_KEY;
      });

      it('should support all defined services', async () => {
        const services = [
          'anthropic',
          'openai',
          'gemini',
          'coingecko',
          'etherscan',
          'sendgrid',
          'newsapi',
          'directus',
        ];

        for (const service of services) {
          // Should not throw for valid service
          await expect(secretsModule.getApiKey(service)).resolves.not.toThrow();
        }
      });
    });
  });
});
