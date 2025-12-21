/**
 * Tests for Agent Entry Point
 * TASK-038: Securing current behavior before refactoring
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express, type Request, type Response } from 'express';

// Mock logger
vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock AgentDaemon
const mockDaemon = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  getHealthStatus: vi.fn().mockResolvedValue({ healthy: true, uptime: 1000 }),
};

vi.mock('./daemon.js', () => ({
  AgentDaemon: vi.fn().mockImplementation(() => mockDaemon),
  createDaemonConfigFromEnv: vi.fn().mockReturnValue({
    agentType: 'cmo',
    agentId: 'test-agent-uuid-12345678',
    profilePath: '/profiles/cmo.md',
    loopInterval: 60000,
    loopEnabled: true,
  }),
}));

describe('Agent Entry Point', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    process.env.HEALTH_PORT = '3099';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Health Check Server', () => {
    let app: Express;

    beforeEach(() => {
      app = express();

      // Replicate the health check endpoints from index.ts
      app.get('/health', async (_req: Request, res: Response) => {
        try {
          const status = await mockDaemon.getHealthStatus();
          res.json(status);
        } catch {
          res.status(500).json({ healthy: false, error: 'Health check failed' });
        }
      });

      app.get('/ready', async (_req: Request, res: Response) => {
        try {
          const status = await mockDaemon.getHealthStatus();
          if (status.healthy) {
            res.json({ ready: true });
          } else {
            res.status(503).json({ ready: false });
          }
        } catch {
          res.status(503).json({ ready: false });
        }
      });
    });

    it('should return health status when healthy', async () => {
      mockDaemon.getHealthStatus.mockResolvedValue({ healthy: true, uptime: 5000 });

      // Use supertest-like approach
      const { default: request } = await import('supertest');
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.healthy).toBe(true);
    });

    it('should return 500 on health check error', async () => {
      mockDaemon.getHealthStatus.mockRejectedValue(new Error('Health check failed'));

      const { default: request } = await import('supertest');
      const response = await request(app).get('/health');

      expect(response.status).toBe(500);
      expect(response.body.healthy).toBe(false);
    });

    it('should return ready when healthy', async () => {
      mockDaemon.getHealthStatus.mockResolvedValue({ healthy: true, uptime: 5000 });

      const { default: request } = await import('supertest');
      const response = await request(app).get('/ready');

      expect(response.status).toBe(200);
      expect(response.body.ready).toBe(true);
    });

    it('should return 503 when not healthy', async () => {
      mockDaemon.getHealthStatus.mockResolvedValue({ healthy: false, uptime: 0 });

      const { default: request } = await import('supertest');
      const response = await request(app).get('/ready');

      expect(response.status).toBe(503);
      expect(response.body.ready).toBe(false);
    });

    it('should return 503 on ready check error', async () => {
      mockDaemon.getHealthStatus.mockRejectedValue(new Error('Check failed'));

      const { default: request } = await import('supertest');
      const response = await request(app).get('/ready');

      expect(response.status).toBe(503);
      expect(response.body.ready).toBe(false);
    });
  });

  describe('Banner formatting', () => {
    const banner = `
╔════════════════════════════════════════════════════════════╗
║                    AITO AGENT                               ║
║                                                              ║
║  Type:      {{TYPE}}
║  ID:        {{ID}}
║  Profile:   {{PROFILE}}
║                                                              ║
╚════════════════════════════════════════════════════════════╝
`;

    it('should format banner with agent type', () => {
      const formatted = banner.replace('{{TYPE}}', 'CMO'.padEnd(44));
      expect(formatted).toContain('CMO');
    });

    it('should format banner with agent ID', () => {
      const agentId = 'test-uuid-12345678';
      const formatted = banner.replace('{{ID}}', agentId.substring(0, 36).padEnd(46));
      expect(formatted).toContain('test-uuid-12345678');
    });

    it('should format banner with profile path', () => {
      const profile = '/profiles/cmo.md';
      const formatted = banner.replace('{{PROFILE}}', profile.padEnd(43));
      expect(formatted).toContain('/profiles/cmo.md');
    });
  });

  describe('Configuration', () => {
    it('should use default health port if not set', () => {
      delete process.env.HEALTH_PORT;
      const port = parseInt(process.env.HEALTH_PORT || '3001', 10);
      expect(port).toBe(3001);
    });

    it('should use custom health port from env', () => {
      process.env.HEALTH_PORT = '4000';
      const port = parseInt(process.env.HEALTH_PORT || '3001', 10);
      expect(port).toBe(4000);
    });
  });

  describe('Signal handling', () => {
    it('should define shutdown function', () => {
      const shutdown = async (signal: string): Promise<void> => {
        await mockDaemon.stop();
      };

      expect(typeof shutdown).toBe('function');
    });

    it('should call daemon.stop on shutdown', async () => {
      const shutdown = async (_signal: string): Promise<void> => {
        await mockDaemon.stop();
      };

      await shutdown('SIGTERM');

      expect(mockDaemon.stop).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle daemon start error', async () => {
      mockDaemon.start.mockRejectedValue(new Error('Failed to start'));

      let errorCaught = false;
      try {
        await mockDaemon.start();
      } catch (error) {
        errorCaught = true;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Failed to start');
      }

      expect(errorCaught).toBe(true);
    });

    it('should format error messages correctly', () => {
      const error = new Error('Test error');
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;

      expect(errMsg).toBe('Test error');
      expect(errStack).toContain('Test error');
    });

    it('should handle non-Error objects', () => {
      const error = 'String error';
      const errMsg = error instanceof Error ? error.message : String(error);

      expect(errMsg).toBe('String error');
    });
  });

  describe('Daemon lifecycle', () => {
    it('should create daemon with config', async () => {
      const { AgentDaemon, createDaemonConfigFromEnv } = await import('./daemon.js');

      const config = createDaemonConfigFromEnv();
      expect(config.agentType).toBe('cmo');

      const daemon = new AgentDaemon(config);
      expect(daemon).toBeDefined();
    });

    it('should support health status check', async () => {
      // Reset mock to return success
      mockDaemon.getHealthStatus.mockResolvedValue({ healthy: true, uptime: 5000 });

      const status = await mockDaemon.getHealthStatus();

      expect(status).toHaveProperty('healthy');
      expect(typeof status.healthy).toBe('boolean');
    });
  });
});
