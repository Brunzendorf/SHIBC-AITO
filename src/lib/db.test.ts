import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock pg
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

const mockPool = {
  connect: vi.fn(() => Promise.resolve(mockClient)),
  query: vi.fn(),
  end: vi.fn(() => Promise.resolve()),
  on: vi.fn(),
};

vi.mock('pg', () => ({
  Pool: vi.fn(() => mockPool),
}));

// Mock logger
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

describe('Database', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockPool.connect.mockReset();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  describe('agentRepo', () => {
    describe('findAll', () => {
      it('should return all agents', async () => {
        const mockAgents = [
          { id: '1', type: 'ceo', name: 'CEO Agent' },
          { id: '2', type: 'dao', name: 'DAO Agent' },
        ];
        mockClient.query.mockResolvedValueOnce({ rows: mockAgents });

        const { agentRepo } = await import('./db.js');
        const result = await agentRepo.findAll();

        expect(result).toEqual(mockAgents);
        expect(mockClient.query).toHaveBeenCalled();
        expect(mockClient.release).toHaveBeenCalled();
      });
    });

    describe('findById', () => {
      it('should return agent by id', async () => {
        const mockAgent = { id: '1', type: 'ceo', name: 'CEO Agent' };
        mockClient.query.mockResolvedValueOnce({ rows: [mockAgent] });

        const { agentRepo } = await import('./db.js');
        const result = await agentRepo.findById('1');

        expect(result).toEqual(mockAgent);
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('WHERE id = $1'),
          ['1']
        );
      });

      it('should return null when agent not found', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { agentRepo } = await import('./db.js');
        const result = await agentRepo.findById('nonexistent');

        expect(result).toBeNull();
      });
    });

    describe('findByType', () => {
      it('should return agent by type', async () => {
        const mockAgent = { id: '1', type: 'ceo', name: 'CEO Agent' };
        mockClient.query.mockResolvedValueOnce({ rows: [mockAgent] });

        const { agentRepo } = await import('./db.js');
        const result = await agentRepo.findByType('ceo');

        expect(result).toEqual(mockAgent);
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('WHERE type = $1'),
          ['ceo']
        );
      });
    });

    describe('create', () => {
      it('should create new agent', async () => {
        const newAgent = {
          type: 'ceo' as const,
          name: 'CEO Agent',
          profilePath: '/profiles/ceo.md',
          loopInterval: 3600,
          status: 'inactive' as const,
        };
        const createdAgent = { id: 'new-id', ...newAgent };
        mockClient.query.mockResolvedValueOnce({ rows: [createdAgent] });

        const { agentRepo } = await import('./db.js');
        const result = await agentRepo.create(newAgent);

        expect(result).toEqual(createdAgent);
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO agents'),
          expect.arrayContaining(['ceo', 'CEO Agent'])
        );
      });
    });

    describe('updateStatus', () => {
      it('should update agent status', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { agentRepo } = await import('./db.js');
        await agentRepo.updateStatus('1', 'active', 'container-123');

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE agents SET status'),
          ['1', 'active', 'container-123']
        );
      });
    });

    describe('updateHeartbeat', () => {
      it('should update agent heartbeat', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { agentRepo } = await import('./db.js');
        await agentRepo.updateHeartbeat('1');

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('last_heartbeat = NOW()'),
          ['1']
        );
      });
    });
  });

  describe('stateRepo', () => {
    describe('get', () => {
      it('should get state value', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [{ stateValue: { key: 'value' } }],
        });

        const { stateRepo } = await import('./db.js');
        const result = await stateRepo.get('agent-1', 'test_key');

        expect(result).toEqual({ key: 'value' });
      });

      it('should return null when state not found', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { stateRepo } = await import('./db.js');
        const result = await stateRepo.get('agent-1', 'nonexistent');

        expect(result).toBeNull();
      });
    });

    describe('set', () => {
      it('should set state value', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { stateRepo } = await import('./db.js');
        await stateRepo.set('agent-1', 'test_key', { value: 123 });

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO agent_state'),
          expect.arrayContaining(['agent-1', 'test_key'])
        );
      });
    });

    describe('getAll', () => {
      it('should get all state for agent', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [
            { stateKey: 'key1', stateValue: 'value1' },
            { stateKey: 'key2', stateValue: 'value2' },
          ],
        });

        const { stateRepo } = await import('./db.js');
        const result = await stateRepo.getAll('agent-1');

        expect(result).toEqual({ key1: 'value1', key2: 'value2' });
      });
    });

    describe('delete', () => {
      it('should delete state', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { stateRepo } = await import('./db.js');
        await stateRepo.delete('agent-1', 'test_key');

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('DELETE FROM agent_state'),
          ['agent-1', 'test_key']
        );
      });
    });
  });

  describe('historyRepo', () => {
    describe('add', () => {
      it('should add history entry', async () => {
        const entry = {
          agentId: 'agent-1',
          actionType: 'decision' as const,
          summary: 'Made a decision',
          details: { result: 'approved' },
        };
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: 'history-1', ...entry }],
        });

        const { historyRepo } = await import('./db.js');
        const result = await historyRepo.add(entry);

        expect(result.id).toBe('history-1');
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO agent_history'),
          expect.any(Array)
        );
      });
    });

    describe('getRecent', () => {
      it('should get recent history', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [
            { id: '1', summary: 'Action 1' },
            { id: '2', summary: 'Action 2' },
          ],
        });

        const { historyRepo } = await import('./db.js');
        const result = await historyRepo.getRecent('agent-1', 10);

        expect(result).toHaveLength(2);
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('LIMIT $2'),
          ['agent-1', 10]
        );
      });
    });
  });

  describe('decisionRepo', () => {
    describe('create', () => {
      it('should create decision', async () => {
        const decision = {
          title: 'Test Decision',
          proposedBy: 'cmo-id',
          decisionType: 'major' as const,
          status: 'pending' as const,
          vetoRound: 0,
        };
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: 'decision-1', ...decision }],
        });

        const { decisionRepo } = await import('./db.js');
        const result = await decisionRepo.create(decision);

        expect(result.id).toBe('decision-1');
      });
    });

    describe('findById', () => {
      it('should find decision by id', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: 'decision-1', title: 'Test' }],
        });

        const { decisionRepo } = await import('./db.js');
        const result = await decisionRepo.findById('decision-1');

        expect(result?.id).toBe('decision-1');
      });
    });

    describe('findPending', () => {
      it('should find pending decisions', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: '1' }, { id: '2' }],
        });

        const { decisionRepo } = await import('./db.js');
        const result = await decisionRepo.findPending();

        expect(result).toHaveLength(2);
      });
    });

    describe('updateVote', () => {
      it('should update CEO vote', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { decisionRepo } = await import('./db.js');
        await decisionRepo.updateVote('decision-1', 'ceo', 'approve');

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('ceo_vote'),
          ['decision-1', 'approve']
        );
      });

      it('should update DAO vote', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { decisionRepo } = await import('./db.js');
        await decisionRepo.updateVote('decision-1', 'dao', 'veto');

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('dao_vote'),
          ['decision-1', 'veto']
        );
      });
    });

    describe('updateStatus', () => {
      it('should update decision status', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { decisionRepo } = await import('./db.js');
        await decisionRepo.updateStatus('decision-1', 'approved', new Date());

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE decisions SET status'),
          expect.any(Array)
        );
      });
    });

    describe('incrementVetoRound', () => {
      it('should increment veto round', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { decisionRepo } = await import('./db.js');
        await decisionRepo.incrementVetoRound('decision-1');

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('veto_round = veto_round + 1'),
          ['decision-1']
        );
      });
    });
  });

  describe('taskRepo', () => {
    describe('create', () => {
      it('should create task', async () => {
        const task = {
          title: 'Test Task',
          assignedTo: 'cmo-id',
          createdBy: 'ceo-id',
          status: 'pending' as const,
          priority: 2 as const,
        };
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: 'task-1', ...task }],
        });

        const { taskRepo } = await import('./db.js');
        const result = await taskRepo.create(task);

        expect(result.id).toBe('task-1');
      });
    });

    describe('findByAgent', () => {
      it('should find tasks by agent', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: '1' }, { id: '2' }],
        });

        const { taskRepo } = await import('./db.js');
        const result = await taskRepo.findByAgent('agent-1');

        expect(result).toHaveLength(2);
      });

      it('should filter by status', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: '1', status: 'pending' }],
        });

        const { taskRepo } = await import('./db.js');
        const result = await taskRepo.findByAgent('agent-1', 'pending');

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('status = $2'),
          ['agent-1', 'pending']
        );
      });
    });

    describe('updateStatus', () => {
      it('should update task status', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { taskRepo } = await import('./db.js');
        await taskRepo.updateStatus('task-1', 'completed', { success: true });

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE tasks SET status'),
          expect.any(Array)
        );
      });
    });
  });

  describe('eventRepo', () => {
    describe('log', () => {
      it('should log event', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: 'event-1', eventType: 'agent_started' }],
        });

        const { eventRepo } = await import('./db.js');
        const result = await eventRepo.log({
          eventType: 'agent_started',
          sourceAgent: 'agent-1',
          payload: {},
        });

        expect(result.id).toBe('event-1');
      });
    });

    describe('getRecent', () => {
      it('should get recent events', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: '1' }, { id: '2' }],
        });

        const { eventRepo } = await import('./db.js');
        const result = await eventRepo.getRecent(50);

        expect(result).toHaveLength(2);
      });
    });

    describe('getByAgent', () => {
      it('should get events by agent', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: '1' }],
        });

        const { eventRepo } = await import('./db.js');
        const result = await eventRepo.getByAgent('agent-1', 10);

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('source_agent = $1 OR target_agent = $1'),
          ['agent-1', 10]
        );
      });
    });
  });

  describe('escalationRepo', () => {
    describe('create', () => {
      it('should create escalation', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: 'escalation-1' }],
        });

        const { escalationRepo } = await import('./db.js');
        const result = await escalationRepo.create({
          decisionId: 'decision-1',
          reason: 'Deadlock',
          channelsNotified: ['telegram'],
          status: 'pending',
        });

        expect(result.id).toBe('escalation-1');
      });
    });

    describe('findPending', () => {
      it('should find pending escalations', async () => {
        mockClient.query.mockResolvedValueOnce({
          rows: [{ id: '1' }],
        });

        const { escalationRepo } = await import('./db.js');
        const result = await escalationRepo.findPending();

        expect(result).toHaveLength(1);
      });
    });

    describe('respond', () => {
      it('should record response', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { escalationRepo } = await import('./db.js');
        await escalationRepo.respond('escalation-1', 'Approved');

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining("status = 'responded'"),
          ['escalation-1', 'Approved']
        );
      });
    });

    describe('timeout', () => {
      it('should mark as timeout', async () => {
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const { escalationRepo } = await import('./db.js');
        await escalationRepo.timeout('escalation-1');

        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining("status = 'timeout'"),
          ['escalation-1']
        );
      });
    });
  });

  describe('checkConnection', () => {
    it('should return true when connected', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const { checkConnection } = await import('./db.js');
      const result = await checkConnection();

      expect(result).toBe(true);
    });

    it('should return false when disconnected', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('Connection failed'));

      const { checkConnection } = await import('./db.js');
      const result = await checkConnection();

      expect(result).toBe(false);
    });
  });

  describe('closePool', () => {
    it('should close pool', async () => {
      const { closePool } = await import('./db.js');
      await closePool();

      expect(mockPool.end).toHaveBeenCalled();
    });
  });
});
