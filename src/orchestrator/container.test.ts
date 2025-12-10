import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Docker
const mockContainer = {
  start: vi.fn(() => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
  stats: vi.fn(() => Promise.resolve({
    memory_stats: { usage: 100000000 },
    cpu_stats: {
      cpu_usage: { total_usage: 1000000000 },
      system_cpu_usage: 10000000000,
    },
    precpu_stats: {
      cpu_usage: { total_usage: 900000000 },
      system_cpu_usage: 9000000000,
    },
  })),
  id: 'container-123',
};

const mockDocker = {
  listContainers: vi.fn(() => Promise.resolve([])),
  getContainer: vi.fn(() => mockContainer),
  createContainer: vi.fn(() => Promise.resolve(mockContainer)),
  listNetworks: vi.fn(() => Promise.resolve([])),
  createNetwork: vi.fn(() => Promise.resolve({})),
  ping: vi.fn(() => Promise.resolve({})),
};

vi.mock('dockerode', () => ({
  default: vi.fn(() => mockDocker),
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

// Mock config
vi.mock('../lib/config.js', () => ({
  config: {
    DOCKER_SOCKET: '/var/run/docker.sock',
    POSTGRES_URL: 'postgres://localhost/test',
    REDIS_URL: 'redis://localhost',
    OLLAMA_URL: 'http://localhost:11434',
    GITHUB_TOKEN: 'test-token',
    GITHUB_ORG: 'test-org',
  },
  agentConfigs: {
    ceo: { name: 'CEO Agent', loopInterval: 3600, tier: 'head' },
    dao: { name: 'DAO Agent', loopInterval: 21600, tier: 'head' },
    cmo: { name: 'CMO Agent', loopInterval: 14400, tier: 'clevel', gitFilter: 'marketing' },
    cto: { name: 'CTO Agent', loopInterval: 3600, tier: 'clevel' },
  },
}));

// Mock db
const mockAgentRepo = {
  findByType: vi.fn(() => Promise.resolve(null)),
  findAll: vi.fn(() => Promise.resolve([])),
  create: vi.fn((data: any) => Promise.resolve({ id: 'agent-1', ...data })),
  updateStatus: vi.fn(() => Promise.resolve({ id: 'agent-1' })),
};

const mockEventRepo = {
  log: vi.fn(() => Promise.resolve({ id: 'event-1' })),
};

vi.mock('../lib/db.js', () => ({
  agentRepo: mockAgentRepo,
  eventRepo: mockEventRepo,
}));

// Mock redis
const mockSetAgentStatus = vi.fn(() => Promise.resolve());
const mockAcquireLock = vi.fn(() => Promise.resolve(true));
const mockReleaseLock = vi.fn(() => Promise.resolve());

vi.mock('../lib/redis.js', () => ({
  setAgentStatus: (...args: unknown[]) => mockSetAgentStatus(...args),
  acquireLock: (...args: unknown[]) => mockAcquireLock(...args),
  releaseLock: (...args: unknown[]) => mockReleaseLock(...args),
  keys: {
    lock: {
      container: (id: string) => `lock:container:${id}`,
    },
  },
}));

describe('Container', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquireLock.mockResolvedValue(true);
    mockAgentRepo.findByType.mockResolvedValue(null);
    mockDocker.listContainers.mockResolvedValue([]);
  });

  describe('startAgent', () => {
    it('should start a new agent container', async () => {
      mockAgentRepo.findByType.mockResolvedValue(null);
      mockAgentRepo.create.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'starting',
      });
      mockDocker.listContainers.mockResolvedValue([]);

      const { startAgent } = await import('./container.js');
      const containerId = await startAgent('ceo');

      expect(containerId).toBe('container-123');
      expect(mockAcquireLock).toHaveBeenCalledWith('lock:container:ceo', 120);
      expect(mockDocker.createContainer).toHaveBeenCalled();
      expect(mockContainer.start).toHaveBeenCalled();
      expect(mockAgentRepo.updateStatus).toHaveBeenCalledWith('agent-1', 'active', 'container-123');
      expect(mockSetAgentStatus).toHaveBeenCalled();
      expect(mockEventRepo.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'agent_started' })
      );
      expect(mockReleaseLock).toHaveBeenCalledWith('lock:container:ceo');
    });

    it('should return existing running container id', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'existing-123', State: 'running' },
      ]);

      const { startAgent } = await import('./container.js');
      const containerId = await startAgent('ceo');

      expect(containerId).toBe('existing-123');
      expect(mockDocker.createContainer).not.toHaveBeenCalled();
    });

    it('should remove stopped container before starting new one', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'stopped-123', State: 'exited' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'inactive',
      });

      const { startAgent } = await import('./container.js');
      await startAgent('ceo');

      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
      expect(mockDocker.createContainer).toHaveBeenCalled();
    });

    it('should throw when lock is not available', async () => {
      mockAcquireLock.mockResolvedValue(false);

      const { startAgent } = await import('./container.js');

      await expect(startAgent('ceo')).rejects.toThrow(
        'Container ceo is already being modified'
      );
    });

    it('should use existing agent from database', async () => {
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'existing-agent',
        type: 'ceo',
        status: 'inactive',
      });

      const { startAgent } = await import('./container.js');
      await startAgent('ceo');

      expect(mockAgentRepo.create).not.toHaveBeenCalled();
      expect(mockAgentRepo.updateStatus).toHaveBeenCalledWith('existing-agent', 'starting');
    });

    it('should include gitFilter in container config for agents with filter', async () => {
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'cmo-agent',
        type: 'cmo',
        status: 'inactive',
      });

      const { startAgent } = await import('./container.js');
      await startAgent('cmo');

      expect(mockDocker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: expect.arrayContaining(['GIT_FILTER=marketing']),
        })
      );
    });

    it('should release lock even on error', async () => {
      mockDocker.createContainer.mockRejectedValueOnce(new Error('Docker error'));
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'inactive',
      });

      const { startAgent } = await import('./container.js');

      await expect(startAgent('ceo')).rejects.toThrow('Docker error');
      expect(mockReleaseLock).toHaveBeenCalledWith('lock:container:ceo');
    });
  });

  describe('stopAgent', () => {
    it('should stop a running container', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'running-123', State: 'running' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'active',
      });

      const { stopAgent } = await import('./container.js');
      await stopAgent('ceo');

      expect(mockContainer.stop).toHaveBeenCalledWith({ t: 30 });
      expect(mockAgentRepo.updateStatus).toHaveBeenCalledWith('agent-1', 'inactive');
      expect(mockEventRepo.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'agent_stopped' })
      );
    });

    it('should do nothing when container not found', async () => {
      mockDocker.listContainers.mockResolvedValue([]);

      const { stopAgent } = await import('./container.js');
      await stopAgent('ceo');

      expect(mockContainer.stop).not.toHaveBeenCalled();
    });

    it('should not stop if container already stopped', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'stopped-123', State: 'exited' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'inactive',
      });

      const { stopAgent } = await import('./container.js');
      await stopAgent('ceo');

      expect(mockContainer.stop).not.toHaveBeenCalled();
      expect(mockAgentRepo.updateStatus).toHaveBeenCalled();
    });

    it('should throw when lock is not available', async () => {
      mockAcquireLock.mockResolvedValue(false);

      const { stopAgent } = await import('./container.js');

      await expect(stopAgent('ceo')).rejects.toThrow(
        'Container ceo is already being modified'
      );
    });

    it('should not update db if agent not found', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'running-123', State: 'running' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue(null);

      const { stopAgent } = await import('./container.js');
      await stopAgent('ceo');

      expect(mockAgentRepo.updateStatus).not.toHaveBeenCalled();
      expect(mockEventRepo.log).not.toHaveBeenCalled();
    });
  });

  describe('restartAgent', () => {
    it('should stop and start agent', async () => {
      mockDocker.listContainers
        .mockResolvedValueOnce([{ Id: 'running-123', State: 'running' }])
        .mockResolvedValueOnce([]);
      mockAgentRepo.findByType
        .mockResolvedValueOnce({ id: 'agent-1', type: 'ceo', status: 'active' })
        .mockResolvedValueOnce({ id: 'agent-1', type: 'ceo', status: 'inactive' });

      const { restartAgent } = await import('./container.js');
      const containerId = await restartAgent('ceo');

      expect(containerId).toBe('container-123');
    });
  });

  describe('getAgentContainerStatus', () => {
    it('should return null when container not found', async () => {
      mockDocker.listContainers.mockResolvedValue([]);

      const { getAgentContainerStatus } = await import('./container.js');
      const status = await getAgentContainerStatus('ceo');

      expect(status).toBeNull();
    });

    it('should return null when agent not in database', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'container-123', State: 'running' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue(null);

      const { getAgentContainerStatus } = await import('./container.js');
      const status = await getAgentContainerStatus('ceo');

      expect(status).toBeNull();
    });

    it('should return healthy status for running container', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'container-123', State: 'running' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'active',
      });

      const { getAgentContainerStatus } = await import('./container.js');
      const status = await getAgentContainerStatus('ceo');

      expect(status).toEqual({
        agentId: 'agent-1',
        status: 'healthy',
        lastCheck: expect.any(Date),
        containerId: 'container-123',
        containerStatus: 'running',
        memoryUsage: 100000000,
        cpuUsage: expect.any(Number),
      });
    });

    it('should return unhealthy status for stopped container', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'container-123', State: 'exited' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'inactive',
      });

      const { getAgentContainerStatus } = await import('./container.js');
      const status = await getAgentContainerStatus('ceo');

      expect(status?.status).toBe('unhealthy');
      expect(status?.memoryUsage).toBeUndefined();
      expect(status?.cpuUsage).toBeUndefined();
    });

    it('should handle stats error gracefully', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'container-123', State: 'running' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'active',
      });
      mockContainer.stats.mockRejectedValueOnce(new Error('Stats error'));

      const { getAgentContainerStatus } = await import('./container.js');
      const status = await getAgentContainerStatus('ceo');

      expect(status?.status).toBe('healthy');
      expect(status?.memoryUsage).toBeUndefined();
      expect(status?.cpuUsage).toBeUndefined();
    });

    it('should handle missing memory stats', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'container-123', State: 'running' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'active',
      });
      mockContainer.stats.mockResolvedValueOnce({
        cpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 10000 },
        precpu_stats: { cpu_usage: { total_usage: 900 }, system_cpu_usage: 9000 },
      });

      const { getAgentContainerStatus } = await import('./container.js');
      const status = await getAgentContainerStatus('ceo');

      expect(status?.memoryUsage).toBeUndefined();
    });

    it('should handle missing cpu stats', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'container-123', State: 'running' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'active',
      });
      mockContainer.stats.mockResolvedValueOnce({
        memory_stats: { usage: 100 },
      });

      const { getAgentContainerStatus } = await import('./container.js');
      const status = await getAgentContainerStatus('ceo');

      expect(status?.cpuUsage).toBeUndefined();
    });
  });

  describe('listManagedContainers', () => {
    it('should list containers with aito.managed label', async () => {
      const containers = [{ Id: 'c1' }, { Id: 'c2' }];
      mockDocker.listContainers.mockResolvedValue(containers);

      const { listManagedContainers } = await import('./container.js');
      const result = await listManagedContainers();

      expect(result).toEqual(containers);
      expect(mockDocker.listContainers).toHaveBeenCalledWith({
        all: true,
        filters: { label: ['aito.managed=true'] },
      });
    });
  });

  describe('checkContainerHealth', () => {
    it('should return true for healthy container', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'container-123', State: 'running' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'active',
      });

      const { checkContainerHealth } = await import('./container.js');
      const result = await checkContainerHealth('ceo');

      expect(result).toBe(true);
    });

    it('should return false for unhealthy container', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'container-123', State: 'exited' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'inactive',
      });

      const { checkContainerHealth } = await import('./container.js');
      const result = await checkContainerHealth('ceo');

      expect(result).toBe(false);
    });

    it('should return false when container not found', async () => {
      mockDocker.listContainers.mockResolvedValue([]);

      const { checkContainerHealth } = await import('./container.js');
      const result = await checkContainerHealth('ceo');

      expect(result).toBe(false);
    });
  });

  describe('autoRestartUnhealthy', () => {
    it('should restart unhealthy active agents', async () => {
      mockAgentRepo.findAll.mockResolvedValue([
        { id: 'agent-1', type: 'ceo', status: 'active' },
      ]);
      mockDocker.listContainers
        .mockResolvedValueOnce([{ Id: 'container-123', State: 'exited' }]) // health check
        .mockResolvedValueOnce([{ Id: 'container-123', State: 'exited' }]) // stop
        .mockResolvedValueOnce([]); // start
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'inactive',
      });

      const { autoRestartUnhealthy } = await import('./container.js');
      await autoRestartUnhealthy();

      // Should have called restart (stop + start)
      expect(mockAcquireLock).toHaveBeenCalled();
    });

    it('should not restart healthy containers', async () => {
      mockAgentRepo.findAll.mockResolvedValue([
        { id: 'agent-1', type: 'ceo', status: 'active' },
      ]);
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'container-123', State: 'running' },
      ]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'active',
      });

      const { autoRestartUnhealthy } = await import('./container.js');
      await autoRestartUnhealthy();

      // Should not have tried to restart
      expect(mockContainer.stop).not.toHaveBeenCalled();
    });

    it('should skip inactive agents', async () => {
      mockAgentRepo.findAll.mockResolvedValue([
        { id: 'agent-1', type: 'ceo', status: 'inactive' },
      ]);

      const { autoRestartUnhealthy } = await import('./container.js');
      await autoRestartUnhealthy();

      expect(mockDocker.listContainers).not.toHaveBeenCalled();
    });

    it('should handle restart errors', async () => {
      mockAgentRepo.findAll.mockResolvedValue([
        { id: 'agent-1', type: 'ceo', status: 'active' },
      ]);
      mockDocker.listContainers
        .mockResolvedValueOnce([{ Id: 'container-123', State: 'exited' }])
        .mockResolvedValueOnce([]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'inactive',
      });
      mockAcquireLock.mockResolvedValueOnce(false); // Lock fails

      const { autoRestartUnhealthy } = await import('./container.js');
      await autoRestartUnhealthy();

      // Should log error event
      expect(mockAgentRepo.updateStatus).toHaveBeenCalledWith('agent-1', 'error');
      expect(mockEventRepo.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'agent_error' })
      );
    });
  });

  describe('ensureNetwork', () => {
    it('should create network if not exists', async () => {
      mockDocker.listNetworks.mockResolvedValue([]);

      const { ensureNetwork } = await import('./container.js');
      await ensureNetwork();

      expect(mockDocker.createNetwork).toHaveBeenCalledWith({
        Name: 'aito-network',
        Driver: 'bridge',
      });
    });

    it('should not create network if exists', async () => {
      mockDocker.listNetworks.mockResolvedValue([{ Name: 'aito-network' }]);

      const { ensureNetwork } = await import('./container.js');
      await ensureNetwork();

      expect(mockDocker.createNetwork).not.toHaveBeenCalled();
    });
  });

  describe('initialize', () => {
    it('should ensure network and check docker connection', async () => {
      mockDocker.listNetworks.mockResolvedValue([]);

      const { initialize } = await import('./container.js');
      await initialize();

      expect(mockDocker.ping).toHaveBeenCalled();
      expect(mockDocker.createNetwork).toHaveBeenCalled();
    });

    it('should throw on docker connection failure', async () => {
      mockDocker.listNetworks.mockResolvedValue([]);
      mockDocker.ping.mockRejectedValueOnce(new Error('Connection refused'));

      const { initialize } = await import('./container.js');

      await expect(initialize()).rejects.toThrow('Connection refused');
    });
  });

  describe('cleanup', () => {
    it('should process running containers', async () => {
      mockDocker.listContainers.mockResolvedValue([
        { Id: 'c1', State: 'running' },
        { Id: 'c2', State: 'running' },
        { Id: 'c3', State: 'exited' },
      ]);

      const { cleanup } = await import('./container.js');

      // Should complete without throwing
      await expect(cleanup()).resolves.toBeUndefined();
    });

    it('should handle empty container list', async () => {
      mockDocker.listContainers.mockResolvedValue([]);

      const { cleanup } = await import('./container.js');
      await expect(cleanup()).resolves.toBeUndefined();
    });
  });

  describe('docker export', () => {
    it('should export docker instance', async () => {
      const { docker } = await import('./container.js');
      expect(docker).toBeDefined();
    });
  });
});
