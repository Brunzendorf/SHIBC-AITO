import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track fetch calls for assertions
let fetchCalls: { url: string; options?: RequestInit }[] = [];
let fetchResponses: Map<string, { ok: boolean; status: number; body: unknown }> = new Map();

// Default fetch implementation for Portainer API
function defaultFetchImpl(url: string, options?: RequestInit) {
  fetchCalls.push({ url, options });

  // Find matching response
  for (const [pattern, response] of fetchResponses) {
    if (url.includes(pattern)) {
      return Promise.resolve({
        ok: response.ok,
        status: response.status,
        text: async () => JSON.stringify(response.body),
      });
    }
  }

  // Default: return empty success
  return Promise.resolve({
    ok: true,
    status: 200,
    text: async () => '{}',
  });
}

// Mock global fetch for Portainer API
const mockFetch = vi.fn(defaultFetchImpl);

vi.stubGlobal('fetch', mockFetch);

// Mock logger
vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock config with Portainer settings
vi.mock('../lib/config.js', () => ({
  config: {
    PORTAINER_URL: 'http://portainer:9000',
    PORTAINER_API_KEY: 'test-api-key',
    PORTAINER_ENV_ID: '1',
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
  findByType: vi.fn<any, any>(() => Promise.resolve(null)),
  findAll: vi.fn<any, any>(() => Promise.resolve([])),
  create: vi.fn<any, any>((data: any) => Promise.resolve({
    id: 'agent-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastHeartbeat: undefined,
    containerId: undefined,
    ...data
  })),
  updateStatus: vi.fn<any, any>(() => Promise.resolve()),
};

const mockEventRepo = {
  log: vi.fn<any, any>(() => Promise.resolve({
    id: 'event-1',
    eventType: 'agent_started' as const,
    payload: {},
    createdAt: new Date()
  })),
};

vi.mock('../lib/db.js', () => ({
  agentRepo: mockAgentRepo,
  eventRepo: mockEventRepo,
}));

// Mock redis
const mockSetAgentStatus = vi.fn<any, any>(() => Promise.resolve());
const mockAcquireLock = vi.fn<any, any>(() => Promise.resolve(true));
const mockReleaseLock = vi.fn<any, any>(() => Promise.resolve());

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

// Helper to set up Portainer API responses
function setPortainerResponse(pathPattern: string, body: unknown, ok = true, status = 200) {
  fetchResponses.set(pathPattern, { ok, status, body });
}

describe('Container (Portainer API)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCalls = [];
    fetchResponses = new Map();
    mockAcquireLock.mockResolvedValue(true);
    mockAgentRepo.findByType.mockResolvedValue(null);

    // Reset fetch to default implementation
    mockFetch.mockImplementation(defaultFetchImpl);

    // Default: no containers exist
    setPortainerResponse('/containers/json', []);
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('startAgent', () => {
    it('should start a new agent container via Portainer', async () => {
      mockAgentRepo.findByType.mockResolvedValue(null);
      mockAgentRepo.create.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'starting',
      });

      // No existing containers
      setPortainerResponse('/containers/json', []);
      // Container create response
      setPortainerResponse('/containers/create', { Id: 'container-123' });
      // Container start response
      setPortainerResponse('/start', {});

      const { startAgent } = await import('./container.js');
      const containerId = await startAgent('ceo');

      expect(containerId).toBe('container-123');
      expect(mockAcquireLock).toHaveBeenCalledWith('lock:container:ceo', 120);
      expect(mockAgentRepo.updateStatus).toHaveBeenCalledWith('agent-1', 'active', 'container-123');
      expect(mockSetAgentStatus).toHaveBeenCalled();
      expect(mockEventRepo.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'agent_started' })
      );
      expect(mockReleaseLock).toHaveBeenCalledWith('lock:container:ceo');

      // Verify Portainer API was called
      expect(fetchCalls.some(c => c.url.includes('/containers/create'))).toBe(true);
      expect(fetchCalls.some(c => c.url.includes('/start'))).toBe(true);
    });

    it('should return existing running container id', async () => {
      setPortainerResponse('/containers/json', [
        { Id: 'existing-123', Names: ['/aito-ceo'], State: 'running', Status: 'Up', Labels: {} },
      ]);

      const { startAgent } = await import('./container.js');
      const containerId = await startAgent('ceo');

      expect(containerId).toBe('existing-123');
      // Should not create new container
      expect(fetchCalls.some(c => c.url.includes('/containers/create'))).toBe(false);
    });

    it('should remove stopped container before starting new one', async () => {
      setPortainerResponse('/containers/json', [
        { Id: 'stopped-123', Names: ['/aito-ceo'], State: 'exited', Status: 'Exited', Labels: {} },
      ]);
      setPortainerResponse('stopped-123?force=true', {});
      setPortainerResponse('/containers/create', { Id: 'new-container' });
      setPortainerResponse('/start', {});

      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'inactive',
      });

      const { startAgent } = await import('./container.js');
      await startAgent('ceo');

      // Verify DELETE was called for old container
      expect(fetchCalls.some(c =>
        c.url.includes('stopped-123') && c.options?.method === 'DELETE'
      )).toBe(true);
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
      setPortainerResponse('/containers/json', []);
      setPortainerResponse('/containers/create', { Id: 'container-123' });
      setPortainerResponse('/start', {});

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
      setPortainerResponse('/containers/json', []);
      setPortainerResponse('/containers/create', { Id: 'container-123' });
      setPortainerResponse('/start', {});

      const { startAgent } = await import('./container.js');
      await startAgent('cmo');

      // Find the create call and check Env contains GIT_FILTER
      const createCall = fetchCalls.find(c => c.url.includes('/containers/create'));
      expect(createCall).toBeDefined();
      const body = JSON.parse(createCall!.options?.body as string);
      expect(body.Env).toContain('GIT_FILTER=marketing');
    });

    it('should release lock even on error', async () => {
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'inactive',
      });
      setPortainerResponse('/containers/json', []);
      setPortainerResponse('/containers/create', { message: 'Error' }, false, 500);

      const { startAgent } = await import('./container.js');

      await expect(startAgent('ceo')).rejects.toThrow();
      expect(mockReleaseLock).toHaveBeenCalledWith('lock:container:ceo');
    });
  });

  describe('stopAgent', () => {
    it('should stop a running container via Portainer', async () => {
      setPortainerResponse('/containers/json', [
        { Id: 'running-123', Names: ['/aito-ceo'], State: 'running', Status: 'Up', Labels: {} },
      ]);
      setPortainerResponse('/stop', {});
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'active',
      });

      const { stopAgent } = await import('./container.js');
      await stopAgent('ceo');

      // Verify stop API was called
      expect(fetchCalls.some(c =>
        c.url.includes('/stop') && c.options?.method === 'POST'
      )).toBe(true);
      expect(mockAgentRepo.updateStatus).toHaveBeenCalledWith('agent-1', 'inactive');
      expect(mockEventRepo.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'agent_stopped' })
      );
    });

    it('should do nothing when container not found', async () => {
      setPortainerResponse('/containers/json', []);

      const { stopAgent } = await import('./container.js');
      await stopAgent('ceo');

      expect(fetchCalls.some(c => c.url.includes('/stop'))).toBe(false);
    });

    it('should not stop if container already stopped', async () => {
      setPortainerResponse('/containers/json', [
        { Id: 'stopped-123', Names: ['/aito-ceo'], State: 'exited', Status: 'Exited', Labels: {} },
      ]);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'inactive',
      });

      const { stopAgent } = await import('./container.js');
      await stopAgent('ceo');

      expect(fetchCalls.some(c => c.url.includes('/stop'))).toBe(false);
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
      setPortainerResponse('/containers/json', [
        { Id: 'running-123', Names: ['/aito-ceo'], State: 'running', Status: 'Up', Labels: {} },
      ]);
      setPortainerResponse('/stop', {});
      mockAgentRepo.findByType.mockResolvedValue(null);

      const { stopAgent } = await import('./container.js');
      await stopAgent('ceo');

      expect(mockAgentRepo.updateStatus).not.toHaveBeenCalled();
      expect(mockEventRepo.log).not.toHaveBeenCalled();
    });
  });

  describe('restartAgent', () => {
    it('should stop and start agent', async () => {
      // First call (stop): container exists
      // Second call (start): no container
      let callCount = 0;
      mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
        fetchCalls.push({ url, options });

        if (url.includes('/containers/json')) {
          callCount++;
          if (callCount === 1) {
            return {
              ok: true,
              status: 200,
              text: async () => JSON.stringify([
                { Id: 'running-123', Names: ['/aito-ceo'], State: 'running', Status: 'Up', Labels: {} }
              ]),
            };
          }
          return { ok: true, status: 200, text: async () => '[]' };
        }
        if (url.includes('/containers/create')) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ Id: 'new-container' }) };
        }
        return { ok: true, status: 200, text: async () => '{}' };
      });

      mockAgentRepo.findByType
        .mockResolvedValueOnce({ id: 'agent-1', type: 'ceo', status: 'active' })
        .mockResolvedValueOnce({ id: 'agent-1', type: 'ceo', status: 'inactive' });

      const { restartAgent } = await import('./container.js');
      const containerId = await restartAgent('ceo');

      expect(containerId).toBe('new-container');
    });
  });

  describe('getAgentContainerStatus', () => {
    it('should return null when container not found', async () => {
      setPortainerResponse('/containers/json', []);

      const { getAgentContainerStatus } = await import('./container.js');
      const status = await getAgentContainerStatus('ceo');

      expect(status).toBeNull();
    });

    it('should return null when agent not in database', async () => {
      setPortainerResponse('/containers/json', [
        { Id: 'container-123', Names: ['/aito-ceo'], State: 'running', Status: 'Up', Labels: {} },
      ]);
      mockAgentRepo.findByType.mockResolvedValue(null);

      const { getAgentContainerStatus } = await import('./container.js');
      const status = await getAgentContainerStatus('ceo');

      expect(status).toBeNull();
    });

    it('should return healthy status for running container', async () => {
      setPortainerResponse('/containers/json', [
        { Id: 'container-123', Names: ['/aito-ceo'], State: 'running', Status: 'Up', Labels: {} },
      ]);
      setPortainerResponse('/stats', {
        memory_stats: { usage: 100000000 },
        cpu_stats: {
          cpu_usage: { total_usage: 1000000000 },
          system_cpu_usage: 10000000000,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 900000000 },
          system_cpu_usage: 9000000000,
        },
      });
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
      setPortainerResponse('/containers/json', [
        { Id: 'container-123', Names: ['/aito-ceo'], State: 'exited', Status: 'Exited', Labels: {} },
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
      setPortainerResponse('/containers/json', [
        { Id: 'container-123', Names: ['/aito-ceo'], State: 'running', Status: 'Up', Labels: {} },
      ]);
      setPortainerResponse('/stats', { message: 'Error' }, false, 500);
      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'active',
      });

      const { getAgentContainerStatus } = await import('./container.js');
      const status = await getAgentContainerStatus('ceo');

      expect(status?.status).toBe('healthy');
      expect(status?.memoryUsage).toBeUndefined();
      expect(status?.cpuUsage).toBeUndefined();
    });
  });

  describe('listManagedContainers', () => {
    it('should list containers with aito.managed label via Portainer', async () => {
      const containers = [
        { Id: 'c1', Names: ['/aito-ceo'], State: 'running', Labels: { 'aito.managed': 'true' } },
        { Id: 'c2', Names: ['/aito-cmo'], State: 'running', Labels: { 'aito.managed': 'true' } },
      ];
      setPortainerResponse('/containers/json', containers);

      const { listManagedContainers } = await import('./container.js');
      const result = await listManagedContainers();

      expect(result).toEqual(containers);
      // Verify the filter was included in the URL
      expect(fetchCalls.some(c =>
        c.url.includes('/containers/json') && c.url.includes('aito.managed')
      )).toBe(true);
    });
  });

  describe('checkContainerHealth', () => {
    it('should return true for healthy container', async () => {
      setPortainerResponse('/containers/json', [
        { Id: 'container-123', Names: ['/aito-ceo'], State: 'running', Status: 'Up', Labels: {} },
      ]);
      setPortainerResponse('/stats', {
        memory_stats: { usage: 100 },
        cpu_stats: { cpu_usage: { total_usage: 100 } },
      });
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
      setPortainerResponse('/containers/json', [
        { Id: 'container-123', Names: ['/aito-ceo'], State: 'exited', Status: 'Exited', Labels: {} },
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
      setPortainerResponse('/containers/json', []);

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

      let callCount = 0;
      mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
        fetchCalls.push({ url, options });

        if (url.includes('/containers/json')) {
          callCount++;
          // First call: unhealthy container for health check
          // Second call: container for stop
          // Third call: no container for start
          if (callCount <= 2) {
            return {
              ok: true,
              status: 200,
              text: async () => JSON.stringify([
                { Id: 'container-123', Names: ['/aito-ceo'], State: 'exited', Status: 'Exited', Labels: {} }
              ]),
            };
          }
          return { ok: true, status: 200, text: async () => '[]' };
        }
        if (url.includes('/containers/create')) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ Id: 'new-container' }) };
        }
        return { ok: true, status: 200, text: async () => '{}' };
      });

      mockAgentRepo.findByType.mockResolvedValue({
        id: 'agent-1',
        type: 'ceo',
        status: 'inactive',
      });

      const { autoRestartUnhealthy } = await import('./container.js');
      await autoRestartUnhealthy();

      // Should have called restart (acquire lock)
      expect(mockAcquireLock).toHaveBeenCalled();
    });

    it('should skip inactive agents', async () => {
      mockAgentRepo.findAll.mockResolvedValue([
        { id: 'agent-1', type: 'ceo', status: 'inactive' },
      ]);

      const { autoRestartUnhealthy } = await import('./container.js');
      await autoRestartUnhealthy();

      // Should not have called Portainer API
      expect(fetchCalls.length).toBe(0);
    });
  });

  describe('initialize', () => {
    it('should check Portainer connection on init', async () => {
      setPortainerResponse('/api/status', { Version: '2.0' });

      const { initialize } = await import('./container.js');
      await initialize();

      expect(fetchCalls.some(c => c.url.includes('/api/status'))).toBe(true);
    });

    it('should throw on Portainer connection failure', async () => {
      setPortainerResponse('/api/status', { message: 'Unauthorized' }, false, 401);

      const { initialize } = await import('./container.js');

      await expect(initialize()).rejects.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should process running containers', async () => {
      setPortainerResponse('/containers/json', [
        { Id: 'c1', Names: ['/aito-ceo'], State: 'running', Status: 'Up', Labels: {} },
        { Id: 'c2', Names: ['/aito-cmo'], State: 'running', Status: 'Up', Labels: {} },
      ]);
      setPortainerResponse('/stop', {});

      const { cleanup } = await import('./container.js');
      await expect(cleanup()).resolves.toBeUndefined();
    });

    it('should handle empty container list', async () => {
      setPortainerResponse('/containers/json', []);

      const { cleanup } = await import('./container.js');
      await expect(cleanup()).resolves.toBeUndefined();
    });
  });

  describe('portainer exports', () => {
    it('should export portainer helpers', async () => {
      const { isPortainerConfigured, portainerFetch } = await import('./container.js');
      expect(isPortainerConfigured).toBe(true);
      expect(portainerFetch).toBeDefined();
    });
  });
});
