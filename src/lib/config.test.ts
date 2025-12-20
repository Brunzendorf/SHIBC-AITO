import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load valid configuration', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';
      process.env.REDIS_URL = 'redis://localhost:6379';

      const { config } = await import('./config.js');

      expect(config.POSTGRES_URL).toBe('postgresql://test:test@localhost:5432/test');
      expect(config.REDIS_URL).toBe('redis://localhost:6379');
    });

    it('should use default values', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';

      const { config } = await import('./config.js');

      expect(config.PORT).toBe('8080');
      expect(config.NODE_ENV).toBe('test'); // Set in setup.ts
      expect(config.DOCKER_SOCKET).toBe('/var/run/docker.sock');
      expect(config.OLLAMA_URL).toBe('http://localhost:11434');
      expect(config.GITHUB_ORG).toBe('test-org'); // Set in setup.ts
      expect(config.DEFAULT_LOOP_INTERVAL).toBe('3600');
      expect(config.HEALTH_CHECK_INTERVAL).toBe('30');
      expect(config.MAX_VETO_ROUNDS).toBe('3');
    });

    it('should parse numeric values correctly', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';

      const { numericConfig } = await import('./config.js');

      expect(numericConfig.port).toBe(8080);
      expect(numericConfig.defaultLoopInterval).toBe(3600);
      expect(numericConfig.healthCheckInterval).toBe(30);
      expect(numericConfig.maxVetoRounds).toBe(3);
      expect(numericConfig.escalationTimeouts.critical).toBe(14400);
      expect(numericConfig.escalationTimeouts.high).toBe(43200);
      expect(numericConfig.escalationTimeouts.normal).toBe(86400);
    });
  });

  describe('agentConfigs', () => {
    it('should have correct CEO config', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';

      const { agentConfigs } = await import('./config.js');

      expect(agentConfigs.ceo.name).toBe('CEO Agent');
      expect(agentConfigs.ceo.loopInterval).toBe(1800); // 30 min - frequent oversight
      expect(agentConfigs.ceo.tier).toBe('head');
    });

    it('should have correct DAO config', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';

      const { agentConfigs } = await import('./config.js');

      expect(agentConfigs.dao.name).toBe('DAO Agent');
      expect(agentConfigs.dao.loopInterval).toBe(14400); // 4 hours - governance
      expect(agentConfigs.dao.tier).toBe('head');
    });

    it('should have correct CMO config', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';

      const { agentConfigs } = await import('./config.js');

      expect(agentConfigs.cmo.name).toBe('CMO Agent');
      expect(agentConfigs.cmo.loopInterval).toBe(7200); // 2 hours - marketing reactivity
      expect(agentConfigs.cmo.tier).toBe('clevel');
      expect(agentConfigs.cmo.gitFilter).toBe('content/*');
    });

    it('should have correct CTO config', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';

      const { agentConfigs } = await import('./config.js');

      expect(agentConfigs.cto.name).toBe('CTO Agent');
      expect(agentConfigs.cto.loopInterval).toBe(3600);
      expect(agentConfigs.cto.tier).toBe('clevel');
      expect(agentConfigs.cto.gitFilter).toBe('website/*');
    });

    it('should have correct CFO config', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';

      const { agentConfigs } = await import('./config.js');

      expect(agentConfigs.cfo.name).toBe('CFO Agent');
      expect(agentConfigs.cfo.loopInterval).toBe(14400); // 4 hours - treasury monitoring
      expect(agentConfigs.cfo.tier).toBe('clevel');
      expect(agentConfigs.cfo.gitFilter).toBe('treasury/*');
    });

    it('should have correct COO config', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';

      const { agentConfigs } = await import('./config.js');

      expect(agentConfigs.coo.name).toBe('COO Agent');
      expect(agentConfigs.coo.loopInterval).toBe(3600); // 1 hour - quick operations response
      expect(agentConfigs.coo.tier).toBe('clevel');
      expect(agentConfigs.coo.gitFilter).toBe('community/*');
    });

    it('should have correct CCO config', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';

      const { agentConfigs } = await import('./config.js');

      expect(agentConfigs.cco.name).toBe('CCO Agent');
      expect(agentConfigs.cco.loopInterval).toBe(43200); // 12 hours - compliance less time-critical
      expect(agentConfigs.cco.tier).toBe('clevel');
      expect(agentConfigs.cco.gitFilter).toBe('legal/*');
    });

    it('should have all 7 agent types', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';

      const { agentConfigs } = await import('./config.js');

      const agentTypes = Object.keys(agentConfigs);
      expect(agentTypes).toHaveLength(7);
      expect(agentTypes).toContain('ceo');
      expect(agentTypes).toContain('dao');
      expect(agentTypes).toContain('cmo');
      expect(agentTypes).toContain('cto');
      expect(agentTypes).toContain('cfo');
      expect(agentTypes).toContain('coo');
      expect(agentTypes).toContain('cco');
    });
  });

  describe('optional fields', () => {
    it('should handle optional TELEGRAM_BOT_TOKEN', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';

      const { config } = await import('./config.js');

      expect(config.TELEGRAM_BOT_TOKEN).toBe('test-token');
    });

    it('should handle optional SENDGRID_API_KEY', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';
      process.env.SENDGRID_API_KEY = 'sg-test-key';

      const { config } = await import('./config.js');

      expect(config.SENDGRID_API_KEY).toBe('sg-test-key');
    });

    it('should handle optional GITHUB_TOKEN', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';
      process.env.GITHUB_TOKEN = 'ghp_test';

      const { config } = await import('./config.js');

      expect(config.GITHUB_TOKEN).toBe('ghp_test');
    });
  });

  describe('NODE_ENV validation', () => {
    it('should accept development', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';
      process.env.NODE_ENV = 'development';

      const { config } = await import('./config.js');

      expect(config.NODE_ENV).toBe('development');
    });

    it('should accept production', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';
      process.env.NODE_ENV = 'production';

      const { config } = await import('./config.js');

      expect(config.NODE_ENV).toBe('production');
    });

    it('should accept test', async () => {
      process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';
      process.env.NODE_ENV = 'test';

      const { config } = await import('./config.js');

      expect(config.NODE_ENV).toBe('test');
    });
  });
});
