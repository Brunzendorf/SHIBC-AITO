/**
 * TASK-034: Secrets Manager - Abstraction for Secret Storage
 *
 * Supports multiple backends:
 * - Environment variables (default)
 * - Docker Secrets (/run/secrets/<name>)
 * - File-based secrets (for development)
 * - Future: HashiCorp Vault, AWS Secrets Manager, etc.
 *
 * Usage:
 *   const token = await secrets.get('GITHUB_TOKEN');
 *   const apiKey = await secrets.get('ANTHROPIC_API_KEY', { required: true });
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const logger = createLogger('secrets');

// =============================================================================
// Types
// =============================================================================

export interface SecretOptions {
  required?: boolean;
  defaultValue?: string;
  // Future: ttl for caching, refreshCallback for rotation
}

export interface SecretBackend {
  name: string;
  get(key: string): Promise<string | undefined>;
  has(key: string): Promise<boolean>;
}

// =============================================================================
// Backends
// =============================================================================

/**
 * Environment variable backend (default)
 */
class EnvBackend implements SecretBackend {
  name = 'env';

  async get(key: string): Promise<string | undefined> {
    return process.env[key];
  }

  async has(key: string): Promise<boolean> {
    return key in process.env && !!process.env[key];
  }
}

/**
 * Docker Secrets backend
 * Reads secrets from /run/secrets/<key>
 */
class DockerSecretsBackend implements SecretBackend {
  name = 'docker-secrets';
  private readonly secretsPath = '/run/secrets';
  private cache = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    // Check cache first
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    // Docker secrets use lowercase filenames
    const secretFile = join(this.secretsPath, key.toLowerCase());

    if (!existsSync(secretFile)) {
      return undefined;
    }

    try {
      const value = (await readFile(secretFile, 'utf-8')).trim();
      this.cache.set(key, value);
      return value;
    } catch (err) {
      logger.warn({ key, error: err instanceof Error ? err.message : String(err) },
        'Failed to read Docker secret');
      return undefined;
    }
  }

  async has(key: string): Promise<boolean> {
    const secretFile = join(this.secretsPath, key.toLowerCase());
    return existsSync(secretFile);
  }
}

/**
 * File-based secrets backend
 * Reads secrets from a secrets directory (useful for development)
 */
class FileBackend implements SecretBackend {
  name = 'file';
  private readonly secretsPath: string;
  private cache = new Map<string, string>();

  constructor(secretsPath?: string) {
    this.secretsPath = secretsPath || process.env.SECRETS_PATH || './.secrets';
  }

  async get(key: string): Promise<string | undefined> {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const secretFile = join(this.secretsPath, key);

    if (!existsSync(secretFile)) {
      return undefined;
    }

    try {
      const value = (await readFile(secretFile, 'utf-8')).trim();
      this.cache.set(key, value);
      return value;
    } catch {
      return undefined;
    }
  }

  async has(key: string): Promise<boolean> {
    return existsSync(join(this.secretsPath, key));
  }
}

// =============================================================================
// Secrets Manager
// =============================================================================

class SecretsManager {
  private backends: SecretBackend[] = [];
  private cache = new Map<string, { value: string; expiresAt: number }>();
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Initialize backends in priority order
    // Docker Secrets have highest priority, then file, then env
    if (existsSync('/run/secrets')) {
      this.backends.push(new DockerSecretsBackend());
      logger.info('Docker Secrets backend enabled');
    }

    if (process.env.SECRETS_PATH && existsSync(process.env.SECRETS_PATH)) {
      this.backends.push(new FileBackend());
      logger.info({ path: process.env.SECRETS_PATH }, 'File-based secrets backend enabled');
    }

    // Environment variables are always available as fallback
    this.backends.push(new EnvBackend());
  }

  /**
   * Get a secret value
   */
  async get(key: string, options: SecretOptions = {}): Promise<string | undefined> {
    // Check cache
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // Try each backend in order
    for (const backend of this.backends) {
      const value = await backend.get(key);
      if (value !== undefined) {
        // Cache the value
        this.cache.set(key, {
          value,
          expiresAt: Date.now() + this.cacheTTL,
        });
        logger.debug({ key, backend: backend.name }, 'Secret loaded');
        return value;
      }
    }

    // Handle missing secret
    if (options.required && !options.defaultValue) {
      throw new Error(`Required secret not found: ${key}`);
    }

    return options.defaultValue;
  }

  /**
   * Get a required secret (throws if not found)
   */
  async getRequired(key: string): Promise<string> {
    const value = await this.get(key, { required: true });
    return value!;
  }

  /**
   * Check if a secret exists
   */
  async has(key: string): Promise<boolean> {
    for (const backend of this.backends) {
      if (await backend.has(key)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Clear the cache (useful for rotation)
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Secrets cache cleared');
  }

  /**
   * Invalidate a specific secret (for rotation)
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    logger.info({ key }, 'Secret invalidated');
  }

  /**
   * Get all configured backends
   */
  getBackends(): string[] {
    return this.backends.map(b => b.name);
  }
}

// Singleton instance
export const secrets = new SecretsManager();

// =============================================================================
// Helper functions for common secrets
// =============================================================================

/**
 * Get GitHub token
 */
export async function getGitHubToken(): Promise<string | undefined> {
  return secrets.get('GITHUB_TOKEN');
}

/**
 * Get database URL
 */
export async function getDatabaseUrl(): Promise<string> {
  return secrets.getRequired('POSTGRES_URL');
}

/**
 * Get Redis URL
 */
export async function getRedisUrl(): Promise<string> {
  return secrets.get('REDIS_URL', { defaultValue: 'redis://localhost:6379' }) as Promise<string>;
}

/**
 * Get Telegram bot token
 */
export async function getTelegramToken(): Promise<string | undefined> {
  return secrets.get('TELEGRAM_BOT_TOKEN');
}

/**
 * Get API keys for external services
 */
export async function getApiKey(service: string): Promise<string | undefined> {
  const keyNames: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    coingecko: 'COINGECKO_API_KEY',
    etherscan: 'ETHERSCAN_API_KEY',
    sendgrid: 'SENDGRID_API_KEY',
    newsapi: 'NEWS_API_KEY',
    directus: 'DIRECTUS_TOKEN',
  };

  const key = keyNames[service.toLowerCase()];
  if (!key) {
    throw new Error(`Unknown service: ${service}`);
  }

  return secrets.get(key);
}
