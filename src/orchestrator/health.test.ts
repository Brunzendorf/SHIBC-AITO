import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockCheckDbConnection = vi.fn();
vi.mock('../lib/db.js', () => ({
  checkConnection: () => mockCheckDbConnection(),
  agentRepo: {
    findAll: vi.fn(() => Promise.resolve([])),
  },
}));

const mockCheckRedisConnection = vi.fn();
const mockSetAgentStatus = vi.fn();
const mockGetAllAgentStatuses = vi.fn();
vi.mock('../lib/redis.js', () => ({
  checkConnection: () => mockCheckRedisConnection(),
  setAgentStatus: (...args: unknown[]) => mockSetAgentStatus(...args),
  getAllAgentStatuses: () => mockGetAllAgentStatuses(),
}));

const mockGetAgentContainerStatus = vi.fn();
const mockCheckContainerHealth = vi.fn();
const mockDocker = { ping: vi.fn() };
vi.mock('./container.js', () => ({
  getAgentContainerStatus: (...args: unknown[]) => mockGetAgentContainerStatus(...args),
  checkContainerHealth: (...args: unknown[]) => mockCheckContainerHealth(...args),
  docker: mockDocker,
}));

describe('Health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckDbConnection.mockResolvedValue(true);
    mockCheckRedisConnection.mockResolvedValue(true);
    mockDocker.ping.mockResolvedValue({});
    mockGetAllAgentStatuses.mockResolvedValue({});
  });

  describe('isAlive', () => {
    it('should return true', async () => {
      const { isAlive } = await import('./health.js');
      const result = await isAlive();
      expect(result).toBe(true);
    });
  });

  describe('isReady', () => {
    it('should return true when db and redis are connected', async () => {
      mockCheckDbConnection.mockResolvedValue(true);
      mockCheckRedisConnection.mockResolvedValue(true);

      const { isReady } = await import('./health.js');
      const result = await isReady();

      expect(result).toBe(true);
    });

    it('should return false when db is not connected', async () => {
      mockCheckDbConnection.mockResolvedValue(false);
      mockCheckRedisConnection.mockResolvedValue(true);

      const { isReady } = await import('./health.js');
      const result = await isReady();

      expect(result).toBe(false);
    });

    it('should return false when redis is not connected', async () => {
      mockCheckDbConnection.mockResolvedValue(true);
      mockCheckRedisConnection.mockResolvedValue(false);

      const { isReady } = await import('./health.js');
      const result = await isReady();

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockCheckDbConnection.mockRejectedValue(new Error('Connection failed'));

      const { isReady } = await import('./health.js');
      const result = await isReady();

      expect(result).toBe(false);
    });
  });

  describe('getSystemHealth', () => {
    it('should return healthy status when all components are healthy', async () => {
      mockCheckDbConnection.mockResolvedValue(true);
      mockCheckRedisConnection.mockResolvedValue(true);
      mockDocker.ping.mockResolvedValue({});

      const { agentRepo } = await import('../lib/db.js');
      (agentRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { getSystemHealth } = await import('./health.js');
      const result = await getSystemHealth();

      expect(result.status).toBe('healthy');
      expect(result.components.database.status).toBe('healthy');
      expect(result.components.redis.status).toBe('healthy');
      expect(result.components.docker.status).toBe('healthy');
    });

    it('should return unhealthy when database is down', async () => {
      mockCheckDbConnection.mockResolvedValue(false);
      mockCheckRedisConnection.mockResolvedValue(true);
      mockDocker.ping.mockResolvedValue({});

      const { agentRepo } = await import('../lib/db.js');
      (agentRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { getSystemHealth } = await import('./health.js');
      const result = await getSystemHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.components.database.status).toBe('unhealthy');
    });

    it('should return unhealthy when redis is down', async () => {
      mockCheckDbConnection.mockResolvedValue(true);
      mockCheckRedisConnection.mockResolvedValue(false);
      mockDocker.ping.mockResolvedValue({});

      const { agentRepo } = await import('../lib/db.js');
      (agentRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { getSystemHealth } = await import('./health.js');
      const result = await getSystemHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.components.redis.status).toBe('unhealthy');
    });

    it('should return degraded when docker is down', async () => {
      mockCheckDbConnection.mockResolvedValue(true);
      mockCheckRedisConnection.mockResolvedValue(true);
      mockDocker.ping.mockRejectedValue(new Error('Docker down'));

      const { agentRepo } = await import('../lib/db.js');
      (agentRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { getSystemHealth } = await import('./health.js');
      const result = await getSystemHealth();

      expect(result.status).toBe('degraded');
      expect(result.components.docker.status).toBe('unhealthy');
    });

    it('should return degraded when some agents are unhealthy', async () => {
      mockCheckDbConnection.mockResolvedValue(true);
      mockCheckRedisConnection.mockResolvedValue(true);
      mockDocker.ping.mockResolvedValue({});

      const { agentRepo } = await import('../lib/db.js');
      (agentRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: '1', type: 'ceo', status: 'active' },
      ]);
      mockGetAgentContainerStatus.mockResolvedValue({
        agentId: '1',
        status: 'unhealthy',
        lastCheck: new Date(),
      });

      const { getSystemHealth } = await import('./health.js');
      const result = await getSystemHealth();

      expect(result.status).toBe('degraded');
      expect(result.components.agents.unhealthy).toBe(1);
    });

    it('should handle inactive agents', async () => {
      mockCheckDbConnection.mockResolvedValue(true);
      mockCheckRedisConnection.mockResolvedValue(true);
      mockDocker.ping.mockResolvedValue({});

      const { agentRepo } = await import('../lib/db.js');
      (agentRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: '1', type: 'ceo', status: 'inactive' },
      ]);

      const { getSystemHealth } = await import('./health.js');
      const result = await getSystemHealth();

      expect(result.components.agents.inactive).toBe(1);
      expect(result.components.agents.total).toBe(1);
    });

    it('should include uptime', async () => {
      mockCheckDbConnection.mockResolvedValue(true);
      mockCheckRedisConnection.mockResolvedValue(true);
      mockDocker.ping.mockResolvedValue({});

      const { agentRepo } = await import('../lib/db.js');
      (agentRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { getSystemHealth } = await import('./health.js');
      const result = await getSystemHealth();

      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should include timestamp', async () => {
      mockCheckDbConnection.mockResolvedValue(true);
      mockCheckRedisConnection.mockResolvedValue(true);
      mockDocker.ping.mockResolvedValue({});

      const { agentRepo } = await import('../lib/db.js');
      (agentRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { getSystemHealth } = await import('./health.js');
      const result = await getSystemHealth();

      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should handle database check error', async () => {
      mockCheckDbConnection.mockRejectedValue(new Error('DB Error'));
      mockCheckRedisConnection.mockResolvedValue(true);
      mockDocker.ping.mockResolvedValue({});

      const { agentRepo } = await import('../lib/db.js');
      (agentRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { getSystemHealth } = await import('./health.js');
      const result = await getSystemHealth();

      expect(result.components.database.status).toBe('unhealthy');
      expect(result.components.database.error).toBeDefined();
    });

    it('should handle redis check error', async () => {
      mockCheckDbConnection.mockResolvedValue(true);
      mockCheckRedisConnection.mockRejectedValue(new Error('Redis Error'));
      mockDocker.ping.mockResolvedValue({});

      const { agentRepo } = await import('../lib/db.js');
      (agentRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { getSystemHealth } = await import('./health.js');
      const result = await getSystemHealth();

      expect(result.components.redis.status).toBe('unhealthy');
      expect(result.components.redis.error).toBeDefined();
    });
  });

  describe('getAgentHealth', () => {
    it('should return agent health status', async () => {
      const mockStatus = {
        agentId: '1',
        status: 'healthy' as const,
        lastCheck: new Date(),
      };
      mockGetAgentContainerStatus.mockResolvedValue(mockStatus);

      const { getAgentHealth } = await import('./health.js');
      const result = await getAgentHealth('ceo');

      expect(result).toEqual(mockStatus);
      expect(mockGetAgentContainerStatus).toHaveBeenCalledWith('ceo');
    });

    it('should return null when agent not found', async () => {
      mockGetAgentContainerStatus.mockResolvedValue(null);

      const { getAgentHealth } = await import('./health.js');
      const result = await getAgentHealth('nonexistent' as any);

      expect(result).toBeNull();
    });
  });

  describe('runHealthCheck', () => {
    it('should run health check and update statuses', async () => {
      mockCheckDbConnection.mockResolvedValue(true);
      mockCheckRedisConnection.mockResolvedValue(true);
      mockDocker.ping.mockResolvedValue({});

      const { agentRepo } = await import('../lib/db.js');
      (agentRepo.findAll as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: '1', type: 'ceo', status: 'active' },
      ]);
      mockGetAgentContainerStatus.mockResolvedValue({
        agentId: '1',
        status: 'healthy',
        lastCheck: new Date(),
      });

      const { runHealthCheck } = await import('./health.js');
      await runHealthCheck();

      expect(mockSetAgentStatus).toHaveBeenCalled();
    });
  });

  describe('getCachedAgentStatuses', () => {
    it('should return cached statuses', async () => {
      const cached = {
        'agent-1': { agentId: 'agent-1', status: 'healthy' },
      };
      mockGetAllAgentStatuses.mockResolvedValue(cached);

      const { getCachedAgentStatuses } = await import('./health.js');
      const result = await getCachedAgentStatuses();

      expect(result).toEqual(cached);
    });
  });
});
