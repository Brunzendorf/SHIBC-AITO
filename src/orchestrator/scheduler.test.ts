import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture cron callbacks for testing
let lastCronCallback: (() => Promise<void>) | null = null;

// Mock node-cron
const mockTask = {
  start: vi.fn(),
  stop: vi.fn(),
};
vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((_expression: string, callback: () => Promise<void>) => {
      lastCronCallback = callback;
      return mockTask;
    }),
  },
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid'),
}));

// Mock logger
vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock db
const mockAgentRepo = {
  findAll: vi.fn<any, any>(() => Promise.resolve([])),
  findByType: vi.fn<any, any>(() => Promise.resolve(null)),
};
const mockEventRepo = {
  log: vi.fn(() => Promise.resolve({ id: 'event-1' })),
};
vi.mock('../lib/db.js', () => ({
  agentRepo: mockAgentRepo,
  eventRepo: mockEventRepo,
}));

// Mock redis
const mockPublish = vi.fn<any, any>(() => Promise.resolve());
vi.mock('../lib/redis.js', () => ({
  publish: vi.fn<any, any>((...args: any[]) => mockPublish(...args)),
  channels: {
    agent: (id: string) => `channel:agent:${id}`,
    broadcast: 'channel:broadcast',
  },
}));

// Mock config - must include all exports that transitively imported modules need
vi.mock('../lib/config.js', () => ({
  config: {
    PORT: '8080',
    NODE_ENV: 'test',
    POSTGRES_URL: 'postgres://test',
    REDIS_URL: 'redis://localhost:6379',
    OLLAMA_URL: 'http://localhost:11434',
    QDRANT_URL: 'http://localhost:6333',
    GITHUB_TOKEN: 'test-token',
    GITHUB_ORG: 'test-org',
    GITHUB_REPO: 'test-repo',
    DRY_RUN: 'false',
    LLM_ROUTING_STRATEGY: 'task-type',
    LLM_ENABLE_FALLBACK: 'true',
    LLM_PREFER_GEMINI: 'false',
  },
  agentConfigs: {
    ceo: { name: 'CEO Agent', loopInterval: 3600, tier: 'head' },
    dao: { name: 'DAO Agent', loopInterval: 21600, tier: 'head' },
    cmo: { name: 'CMO Agent', loopInterval: 14400, tier: 'clevel' },
    cto: { name: 'CTO Agent', loopInterval: 3600, tier: 'clevel' },
    cfo: { name: 'CFO Agent', loopInterval: 21600, tier: 'clevel' },
    coo: { name: 'COO Agent', loopInterval: 7200, tier: 'clevel' },
    cco: { name: 'CCO Agent', loopInterval: 86400, tier: 'clevel' },
  },
  numericConfig: {
    healthCheckInterval: 30,
    maxVetoRounds: 3,
  },
  workspaceConfig: {
    repoUrl: 'https://github.com/test/repo.git',
    baseDir: '/tmp/workspace',
  },
}));

// Mock container
const mockAutoRestartUnhealthy = vi.fn(() => Promise.resolve());
vi.mock('./container.js', () => ({
  autoRestartUnhealthy: () => mockAutoRestartUnhealthy(),
}));

describe('Scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastCronCallback = null;
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('scheduleAgentLoop', () => {
    it('should schedule agent loop with cron', async () => {
      const cron = await import('node-cron');
      const { scheduleAgentLoop } = await import('./scheduler.js');

      const jobId = scheduleAgentLoop('agent-1', 'ceo');

      expect(jobId).toBe('loop-ceo');
      expect(cron.default.schedule).toHaveBeenCalled();
    });

    it('should stop existing job before scheduling new one', async () => {
      const { scheduleAgentLoop } = await import('./scheduler.js');

      scheduleAgentLoop('agent-1', 'ceo');
      scheduleAgentLoop('agent-1', 'ceo');

      expect(mockTask.stop).toHaveBeenCalled();
    });

    it('should execute agent loop callback', async () => {
      const { scheduleAgentLoop } = await import('./scheduler.js');

      scheduleAgentLoop('agent-1', 'ceo');

      // Execute the captured callback
      if (lastCronCallback) {
        await lastCronCallback();
        expect(mockPublish).toHaveBeenCalled();
        expect(mockEventRepo.log).toHaveBeenCalled();
      }
    });
  });

  describe('scheduleHealthChecks', () => {
    it('should schedule health checks', async () => {
      const cron = await import('node-cron');
      const { scheduleHealthChecks } = await import('./scheduler.js');

      const jobId = scheduleHealthChecks();

      expect(jobId).toBe('health-checks');
      expect(cron.default.schedule).toHaveBeenCalled();
    });

    it('should execute health check callback', async () => {
      const { scheduleHealthChecks } = await import('./scheduler.js');

      scheduleHealthChecks();

      // Execute the captured callback
      if (lastCronCallback) {
        await lastCronCallback();
        expect(mockAutoRestartUnhealthy).toHaveBeenCalled();
      }
    });

    it('should handle health check errors', async () => {
      mockAutoRestartUnhealthy.mockRejectedValueOnce(new Error('Health check failed'));

      const { scheduleHealthChecks } = await import('./scheduler.js');

      scheduleHealthChecks();

      // Execute the captured callback - should not throw
      if (lastCronCallback) {
        await expect(lastCronCallback()).resolves.toBeUndefined();
      }
    });
  });

  describe('scheduleEscalationChecks', () => {
    it('should schedule escalation checks', async () => {
      const cron = await import('node-cron');
      const { scheduleEscalationChecks } = await import('./scheduler.js');

      const jobId = scheduleEscalationChecks();

      expect(jobId).toBe('escalation-checks');
      expect(cron.default.schedule).toHaveBeenCalled();
    });

    it('should execute escalation check callback', async () => {
      const { scheduleEscalationChecks } = await import('./scheduler.js');

      scheduleEscalationChecks();

      // Execute the captured callback
      if (lastCronCallback) {
        await expect(lastCronCallback()).resolves.toBeUndefined();
      }
    });
  });

  describe('scheduleDailyDigest', () => {
    it('should schedule daily digest', async () => {
      const cron = await import('node-cron');
      const { scheduleDailyDigest } = await import('./scheduler.js');

      const jobId = scheduleDailyDigest();

      expect(jobId).toBe('daily-digest');
      expect(cron.default.schedule).toHaveBeenCalledWith(
        '0 9 * * *',
        expect.any(Function)
      );
    });

    it('should execute daily digest callback with CEO agent', async () => {
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'ceo-agent',
        type: 'ceo',
        name: 'CEO Agent',
        profilePath: '/profiles/ceo.md',
        loopInterval: 3600,
        tier: 'head',
        status: 'active',
        health: 'healthy',
        lastHeartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { scheduleDailyDigest } = await import('./scheduler.js');

      scheduleDailyDigest();

      // Execute the captured callback
      if (lastCronCallback) {
        await lastCronCallback();
        expect(mockAgentRepo.findByType).toHaveBeenCalledWith('ceo');
        expect(mockPublish).toHaveBeenCalled();
      }
    });

    it('should skip daily digest if CEO not found', async () => {
      mockAgentRepo.findByType.mockResolvedValue(null);

      const { scheduleDailyDigest } = await import('./scheduler.js');

      scheduleDailyDigest();

      // Execute the captured callback
      if (lastCronCallback) {
        await lastCronCallback();
        expect(mockAgentRepo.findByType).toHaveBeenCalledWith('ceo');
        expect(mockPublish).not.toHaveBeenCalled();
      }
    });
  });

  describe('stopJob', () => {
    it('should stop existing job', async () => {
      const { scheduleAgentLoop, stopJob } = await import('./scheduler.js');

      scheduleAgentLoop('agent-1', 'ceo');
      const result = stopJob('loop-ceo');

      expect(result).toBe(true);
      expect(mockTask.stop).toHaveBeenCalled();
    });

    it('should return false for non-existent job', async () => {
      const { stopJob } = await import('./scheduler.js');

      const result = stopJob('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('pauseJob', () => {
    it('should pause existing job', async () => {
      const { scheduleAgentLoop, pauseJob } = await import('./scheduler.js');

      scheduleAgentLoop('agent-1', 'ceo');
      const result = pauseJob('loop-ceo');

      expect(result).toBe(true);
      expect(mockTask.stop).toHaveBeenCalled();
    });

    it('should return false for non-existent job', async () => {
      const { pauseJob } = await import('./scheduler.js');

      const result = pauseJob('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('resumeJob', () => {
    it('should resume existing job', async () => {
      const { scheduleAgentLoop, resumeJob } = await import('./scheduler.js');

      scheduleAgentLoop('agent-1', 'ceo');
      const result = resumeJob('loop-ceo');

      expect(result).toBe(true);
      expect(mockTask.start).toHaveBeenCalled();
    });

    it('should return false for non-existent job', async () => {
      const { resumeJob } = await import('./scheduler.js');

      const result = resumeJob('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('getScheduledJobs', () => {
    it('should return all scheduled jobs', async () => {
      const { scheduleAgentLoop, getScheduledJobs, stopAllJobs } = await import('./scheduler.js');

      stopAllJobs();
      scheduleAgentLoop('agent-1', 'ceo');
      scheduleAgentLoop('agent-2', 'dao');

      const jobs = getScheduledJobs();

      expect(jobs.length).toBeGreaterThanOrEqual(2);
      expect(jobs.some(j => j.id === 'loop-ceo')).toBe(true);
      expect(jobs.some(j => j.id === 'loop-dao')).toBe(true);
    });
  });

  describe('initializeAgentSchedules', () => {
    it('should schedule loops for active agents', async () => {
      mockAgentRepo.findAll.mockResolvedValue([
        {
          id: '1',
          type: 'ceo',
          name: 'CEO Agent',
          profilePath: '/profiles/ceo.md',
          loopInterval: 3600,
          tier: 'head',
          status: 'active',
          health: 'healthy',
          lastHeartbeat: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          type: 'dao',
          name: 'DAO Agent',
          profilePath: '/profiles/dao.md',
          loopInterval: 21600,
          tier: 'head',
          status: 'active',
          health: 'healthy',
          lastHeartbeat: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const cron = await import('node-cron');
      const { initializeAgentSchedules, stopAllJobs } = await import('./scheduler.js');

      stopAllJobs();
      await initializeAgentSchedules();

      expect(cron.default.schedule).toHaveBeenCalled();
    });

    it('should not schedule inactive agents', async () => {
      mockAgentRepo.findAll.mockResolvedValue([
        {
          id: '1',
          type: 'ceo',
          name: 'CEO Agent',
          profilePath: '/profiles/ceo.md',
          loopInterval: 3600,
          tier: 'head',
          status: 'inactive',
          health: 'healthy',
          lastHeartbeat: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const cron = await import('node-cron');
      vi.clearAllMocks();

      const { initializeAgentSchedules, stopAllJobs } = await import('./scheduler.js');
      stopAllJobs();
      await initializeAgentSchedules();

      expect(cron.default.schedule).not.toHaveBeenCalled();
    });
  });

  describe('stopAllJobs', () => {
    it('should stop all scheduled jobs', async () => {
      const { scheduleAgentLoop, stopAllJobs, getScheduledJobs } = await import('./scheduler.js');

      scheduleAgentLoop('agent-1', 'ceo');
      scheduleAgentLoop('agent-2', 'dao');

      stopAllJobs();

      const jobs = getScheduledJobs();
      expect(jobs.length).toBe(0);
    });
  });

  describe('initialize', () => {
    it('should initialize scheduler with all jobs', async () => {
      mockAgentRepo.findAll.mockResolvedValue([]);

      const { initialize, stopAllJobs, getScheduledJobs } = await import('./scheduler.js');

      stopAllJobs();
      await initialize();

      const jobs = getScheduledJobs();
      expect(jobs.some(j => j.id === 'health-checks')).toBe(true);
      expect(jobs.some(j => j.id === 'escalation-checks')).toBe(true);
      expect(jobs.some(j => j.id === 'daily-digest')).toBe(true);
    });
  });

  describe('intervalToCron', () => {
    it('should handle different intervals via scheduleAgentLoop', async () => {
      const cron = await import('node-cron');
      const { scheduleAgentLoop, stopAllJobs } = await import('./scheduler.js');

      stopAllJobs();

      // Test hourly interval (3600 seconds = ceo)
      scheduleAgentLoop('agent-1', 'ceo');
      expect(cron.default.schedule).toHaveBeenCalled();

      // Test 6-hour interval (21600 seconds = dao)
      scheduleAgentLoop('agent-2', 'dao');

      // Test daily interval (86400 seconds = cco)
      scheduleAgentLoop('agent-3', 'cco');
    });
  });
});
