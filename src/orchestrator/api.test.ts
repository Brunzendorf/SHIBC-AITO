import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

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
  numericConfig: {
    port: 3000,
  },
}));

// Mock db
const mockAgentRepo = {
  findAll: vi.fn(() => Promise.resolve([])),
  findByType: vi.fn(() => Promise.resolve(null)),
};

const mockEventRepo = {
  getRecent: vi.fn(() => Promise.resolve([])),
  getByAgent: vi.fn(() => Promise.resolve([])),
};

const mockTaskRepo = {
  findByAgent: vi.fn(() => Promise.resolve([])),
  create: vi.fn((data: any) => Promise.resolve({ id: 'task-1', ...data })),
  updateStatus: vi.fn(() => Promise.resolve()),
};

const mockDecisionRepo = {
  findPending: vi.fn(() => Promise.resolve([])),
  findById: vi.fn(() => Promise.resolve(null)),
};

const mockEscalationRepo = {
  findPending: vi.fn(() => Promise.resolve([])),
  respond: vi.fn(() => Promise.resolve()),
};

vi.mock('../lib/db.js', () => ({
  agentRepo: mockAgentRepo,
  eventRepo: mockEventRepo,
  taskRepo: mockTaskRepo,
  decisionRepo: mockDecisionRepo,
  escalationRepo: mockEscalationRepo,
}));

// Mock container
const mockStartAgent = vi.fn(() => Promise.resolve('container-123'));
const mockStopAgent = vi.fn(() => Promise.resolve());
const mockRestartAgent = vi.fn(() => Promise.resolve('container-456'));
const mockGetAgentContainerStatus = vi.fn(() => Promise.resolve(null));
const mockListManagedContainers = vi.fn(() => Promise.resolve([]));

vi.mock('./container.js', () => ({
  startAgent: (...args: unknown[]) => mockStartAgent(...args),
  stopAgent: (...args: unknown[]) => mockStopAgent(...args),
  restartAgent: (...args: unknown[]) => mockRestartAgent(...args),
  getAgentContainerStatus: (...args: unknown[]) => mockGetAgentContainerStatus(...args),
  listManagedContainers: () => mockListManagedContainers(),
}));

// Mock scheduler
const mockGetScheduledJobs = vi.fn(() => []);
const mockPauseJob = vi.fn(() => true);
const mockResumeJob = vi.fn(() => true);

vi.mock('./scheduler.js', () => ({
  getScheduledJobs: () => mockGetScheduledJobs(),
  pauseJob: (...args: unknown[]) => mockPauseJob(...args),
  resumeJob: (...args: unknown[]) => mockResumeJob(...args),
}));

// Mock health
const mockIsAlive = vi.fn(() => Promise.resolve(true));
const mockIsReady = vi.fn(() => Promise.resolve(true));
const mockGetSystemHealth = vi.fn(() => Promise.resolve({
  status: 'healthy',
  uptime: 1000,
  components: {
    database: { status: 'healthy' },
    redis: { status: 'healthy' },
    docker: { status: 'healthy' },
    agents: { total: 0, healthy: 0, unhealthy: 0, inactive: 0, details: {} },
  },
  timestamp: new Date(),
}));
const mockGetAgentHealth = vi.fn(() => Promise.resolve(null));

vi.mock('./health.js', () => ({
  isAlive: () => mockIsAlive(),
  isReady: () => mockIsReady(),
  getSystemHealth: () => mockGetSystemHealth(),
  getAgentHealth: (...args: unknown[]) => mockGetAgentHealth(...args),
}));

// Mock events
const mockTriggerEscalation = vi.fn(() => Promise.resolve('escalation-1'));

vi.mock('./events.js', () => ({
  triggerEscalation: (...args: unknown[]) => mockTriggerEscalation(...args),
}));

describe('API', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const apiModule = await import('./api.js');
    app = apiModule.app;
  });

  describe('Health Endpoints', () => {
    describe('GET /health', () => {
      it('should return ok when alive', async () => {
        mockIsAlive.mockResolvedValue(true);

        const res = await request(app).get('/health');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
      });

      it('should return error when not alive', async () => {
        mockIsAlive.mockResolvedValue(false);

        const res = await request(app).get('/health');

        expect(res.status).toBe(503);
        expect(res.body.status).toBe('error');
      });
    });

    describe('GET /ready', () => {
      it('should return ok when ready', async () => {
        mockIsReady.mockResolvedValue(true);

        const res = await request(app).get('/ready');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
      });

      it('should return not ready when not ready', async () => {
        mockIsReady.mockResolvedValue(false);

        const res = await request(app).get('/ready');

        expect(res.status).toBe(503);
        expect(res.body.status).toBe('not ready');
      });
    });

    describe('GET /health/full', () => {
      it('should return full health status', async () => {
        const res = await request(app).get('/health/full');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('healthy');
      });

      it('should return 200 for degraded status', async () => {
        mockGetSystemHealth.mockResolvedValue({
          status: 'degraded',
          uptime: 1000,
          components: {},
          timestamp: new Date(),
        });

        const res = await request(app).get('/health/full');

        expect(res.status).toBe(200);
      });

      it('should return 503 for unhealthy status', async () => {
        mockGetSystemHealth.mockResolvedValue({
          status: 'unhealthy',
          uptime: 1000,
          components: {},
          timestamp: new Date(),
        });

        const res = await request(app).get('/health/full');

        expect(res.status).toBe(503);
      });
    });
  });

  describe('Agent Endpoints', () => {
    describe('GET /agents', () => {
      it('should return list of agents', async () => {
        mockAgentRepo.findAll.mockResolvedValue([
          { id: 'agent-1', type: 'ceo', status: 'active' },
        ]);

        const res = await request(app).get('/agents');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
      });
    });

    describe('GET /agents/:type', () => {
      it('should return agent by type', async () => {
        mockAgentRepo.findByType.mockResolvedValue({
          id: 'agent-1',
          type: 'ceo',
          status: 'active',
        });

        const res = await request(app).get('/agents/ceo');

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('ceo');
      });

      it('should return 404 when agent not found', async () => {
        mockAgentRepo.findByType.mockResolvedValue(null);

        const res = await request(app).get('/agents/ceo');

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
      });
    });

    describe('POST /agents/:type/start', () => {
      it('should start agent', async () => {
        mockStartAgent.mockResolvedValue('container-123');

        const res = await request(app).post('/agents/ceo/start');

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('started');
        expect(res.body.data.containerId).toBe('container-123');
      });

      it('should handle start error', async () => {
        mockStartAgent.mockRejectedValue(new Error('Start failed'));

        const res = await request(app).post('/agents/ceo/start');

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
      });
    });

    describe('POST /agents/:type/stop', () => {
      it('should stop agent', async () => {
        mockStopAgent.mockResolvedValue(undefined);

        const res = await request(app).post('/agents/ceo/stop');

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('stopped');
      });

      it('should handle stop error', async () => {
        mockStopAgent.mockRejectedValue(new Error('Stop failed'));

        const res = await request(app).post('/agents/ceo/stop');

        expect(res.status).toBe(500);
      });
    });

    describe('POST /agents/:type/restart', () => {
      it('should restart agent', async () => {
        mockRestartAgent.mockResolvedValue('container-456');

        const res = await request(app).post('/agents/ceo/restart');

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('restarted');
      });

      it('should handle restart error', async () => {
        mockRestartAgent.mockRejectedValue(new Error('Restart failed'));

        const res = await request(app).post('/agents/ceo/restart');

        expect(res.status).toBe(500);
      });
    });

    describe('GET /agents/:type/health', () => {
      it('should return agent health', async () => {
        mockGetAgentHealth.mockResolvedValue({
          agentId: 'agent-1',
          status: 'healthy',
          lastCheck: new Date(),
        });

        const res = await request(app).get('/agents/ceo/health');

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('healthy');
      });

      it('should return 404 when health not available', async () => {
        mockGetAgentHealth.mockResolvedValue(null);

        const res = await request(app).get('/agents/ceo/health');

        expect(res.status).toBe(404);
      });
    });
  });

  describe('Container Endpoints', () => {
    describe('GET /containers', () => {
      it('should return managed containers', async () => {
        mockListManagedContainers.mockResolvedValue([
          { Id: 'c1', Name: '/aito-ceo' },
        ]);

        const res = await request(app).get('/containers');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
      });
    });
  });

  describe('Event Endpoints', () => {
    describe('GET /events', () => {
      it('should return recent events', async () => {
        mockEventRepo.getRecent.mockResolvedValue([
          { id: 'event-1', eventType: 'agent_started' },
        ]);

        const res = await request(app).get('/events');

        expect(res.status).toBe(200);
        expect(mockEventRepo.getRecent).toHaveBeenCalledWith(100);
      });

      it('should respect limit parameter', async () => {
        const res = await request(app).get('/events?limit=50');

        expect(mockEventRepo.getRecent).toHaveBeenCalledWith(50);
      });
    });

    describe('GET /events/agent/:id', () => {
      it('should return events for agent', async () => {
        mockEventRepo.getByAgent.mockResolvedValue([]);

        const res = await request(app).get('/events/agent/agent-1');

        expect(res.status).toBe(200);
        expect(mockEventRepo.getByAgent).toHaveBeenCalledWith('agent-1', 50);
      });
    });
  });

  describe('Task Endpoints', () => {
    describe('GET /tasks/agent/:id', () => {
      it('should return tasks for agent', async () => {
        mockTaskRepo.findByAgent.mockResolvedValue([
          { id: 'task-1', title: 'Test task' },
        ]);

        const res = await request(app).get('/tasks/agent/agent-1');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
      });

      it('should filter by status', async () => {
        await request(app).get('/tasks/agent/agent-1?status=pending');

        expect(mockTaskRepo.findByAgent).toHaveBeenCalledWith('agent-1', 'pending');
      });
    });

    describe('POST /tasks', () => {
      it('should create task', async () => {
        mockTaskRepo.create.mockResolvedValue({
          id: 'task-1',
          title: 'New task',
          status: 'pending',
        });

        const res = await request(app)
          .post('/tasks')
          .send({
            title: 'New task',
            description: 'Task description',
            assignedTo: 'agent-1',
          });

        expect(res.status).toBe(201);
        expect(res.body.data.title).toBe('New task');
      });

      it('should use defaults for optional fields', async () => {
        await request(app)
          .post('/tasks')
          .send({ title: 'Task' });

        expect(mockTaskRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            createdBy: 'api',
            status: 'pending',
            priority: 3,
          })
        );
      });
    });

    describe('PATCH /tasks/:id/status', () => {
      it('should update task status', async () => {
        const res = await request(app)
          .patch('/tasks/task-1/status')
          .send({ status: 'completed', result: 'Done' });

        expect(res.status).toBe(200);
        expect(mockTaskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'completed', 'Done');
      });
    });
  });

  describe('Decision Endpoints', () => {
    describe('GET /decisions/pending', () => {
      it('should return pending decisions', async () => {
        mockDecisionRepo.findPending.mockResolvedValue([
          { id: 'dec-1', title: 'Decision 1' },
        ]);

        const res = await request(app).get('/decisions/pending');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
      });
    });

    describe('GET /decisions/:id', () => {
      it('should return decision by id', async () => {
        mockDecisionRepo.findById.mockResolvedValue({
          id: 'dec-1',
          title: 'Decision 1',
        });

        const res = await request(app).get('/decisions/dec-1');

        expect(res.status).toBe(200);
        expect(res.body.data.title).toBe('Decision 1');
      });

      it('should return 404 when decision not found', async () => {
        mockDecisionRepo.findById.mockResolvedValue(null);

        const res = await request(app).get('/decisions/nonexistent');

        expect(res.status).toBe(404);
      });
    });
  });

  describe('Escalation Endpoints', () => {
    describe('GET /escalations/pending', () => {
      it('should return pending escalations', async () => {
        mockEscalationRepo.findPending.mockResolvedValue([]);

        const res = await request(app).get('/escalations/pending');

        expect(res.status).toBe(200);
      });
    });

    describe('POST /escalate', () => {
      it('should trigger escalation', async () => {
        mockTriggerEscalation.mockResolvedValue('escalation-1');

        const res = await request(app)
          .post('/escalate')
          .send({
            reason: 'Manual escalation',
            decisionId: 'dec-1',
            channels: ['telegram', 'email'],
          });

        expect(res.status).toBe(201);
        expect(res.body.data.escalationId).toBe('escalation-1');
      });

      it('should use default channel', async () => {
        await request(app)
          .post('/escalate')
          .send({ reason: 'Test' });

        expect(mockTriggerEscalation).toHaveBeenCalledWith(
          expect.objectContaining({
            channels: ['telegram'],
          })
        );
      });
    });

    describe('POST /escalations/:id/respond', () => {
      it('should respond to escalation', async () => {
        const res = await request(app)
          .post('/escalations/esc-1/respond')
          .send({ response: 'Approved' });

        expect(res.status).toBe(200);
        expect(mockEscalationRepo.respond).toHaveBeenCalledWith('esc-1', 'Approved');
      });
    });
  });

  describe('Scheduler Endpoints', () => {
    describe('GET /scheduler/jobs', () => {
      it('should return scheduled jobs', async () => {
        mockGetScheduledJobs.mockReturnValue([
          { id: 'job-1', type: 'health-check' },
        ]);

        const res = await request(app).get('/scheduler/jobs');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
      });
    });

    describe('POST /scheduler/jobs/:id/pause', () => {
      it('should pause job', async () => {
        mockPauseJob.mockReturnValue(true);

        const res = await request(app).post('/scheduler/jobs/job-1/pause');

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('paused');
      });

      it('should return 404 when job not found', async () => {
        mockPauseJob.mockReturnValue(false);

        const res = await request(app).post('/scheduler/jobs/nonexistent/pause');

        expect(res.status).toBe(404);
      });
    });

    describe('POST /scheduler/jobs/:id/resume', () => {
      it('should resume job', async () => {
        mockResumeJob.mockReturnValue(true);

        const res = await request(app).post('/scheduler/jobs/job-1/resume');

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('resumed');
      });

      it('should return 404 when job not found', async () => {
        mockResumeJob.mockReturnValue(false);

        const res = await request(app).post('/scheduler/jobs/nonexistent/resume');

        expect(res.status).toBe(404);
      });
    });
  });

  describe('Metrics Endpoint', () => {
    describe('GET /metrics', () => {
      it('should return prometheus metrics', async () => {
        mockAgentRepo.findAll.mockResolvedValue([
          { id: 'agent-1', type: 'ceo' },
        ]);
        mockGetSystemHealth.mockResolvedValue({
          status: 'healthy',
          uptime: 60000,
          components: {
            agents: {
              total: 1,
              healthy: 1,
              unhealthy: 0,
              inactive: 0,
              details: {
                ceo: { status: 'healthy' },
              },
            },
          },
          timestamp: new Date(),
        });

        const res = await request(app).get('/metrics');

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(res.text).toContain('aito_system_status 1');
        expect(res.text).toContain('aito_uptime_seconds 60');
        expect(res.text).toContain('aito_agents_total 1');
        expect(res.text).toContain('aito_agent_status{type="ceo"');
      });

      it('should return 0.5 for degraded status', async () => {
        mockGetSystemHealth.mockResolvedValue({
          status: 'degraded',
          uptime: 1000,
          components: { agents: { total: 0, healthy: 0, unhealthy: 0, inactive: 0, details: {} } },
          timestamp: new Date(),
        });
        mockAgentRepo.findAll.mockResolvedValue([]);

        const res = await request(app).get('/metrics');

        expect(res.text).toContain('aito_system_status 0.5');
      });

      it('should return 0 for unhealthy status', async () => {
        mockGetSystemHealth.mockResolvedValue({
          status: 'unhealthy',
          uptime: 1000,
          components: { agents: { total: 0, healthy: 0, unhealthy: 0, inactive: 0, details: {} } },
          timestamp: new Date(),
        });
        mockAgentRepo.findAll.mockResolvedValue([]);

        const res = await request(app).get('/metrics');

        expect(res.text).toContain('aito_system_status 0');
      });

      it('should handle agents without status', async () => {
        mockAgentRepo.findAll.mockResolvedValue([
          { id: 'agent-1', type: 'cto' },
        ]);
        mockGetSystemHealth.mockResolvedValue({
          status: 'healthy',
          uptime: 1000,
          components: { agents: { total: 1, healthy: 0, unhealthy: 1, inactive: 0, details: {} } },
          timestamp: new Date(),
        });

        const res = await request(app).get('/metrics');

        expect(res.text).toContain('aito_agent_status{type="cto"');
        expect(res.text).toContain('} 0');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle async errors', async () => {
      mockAgentRepo.findAll.mockRejectedValue(new Error('Database error'));

      const res = await request(app).get('/agents');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Database error');
    });
  });

  describe('startServer', () => {
    it('should export startServer function', async () => {
      const { startServer } = await import('./api.js');
      expect(typeof startServer).toBe('function');
    });
  });
});
