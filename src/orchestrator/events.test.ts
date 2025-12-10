import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture subscribe handler for testing
let messageHandler: ((msg: any) => Promise<void>) | null = null;

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

// Mock config
vi.mock('../lib/config.js', () => ({
  numericConfig: {
    maxVetoRounds: 3,
  },
}));

// Mock db
const mockEventRepo = {
  log: vi.fn(() => Promise.resolve({ id: 'event-1' })),
};

const mockDecisionRepo = {
  create: vi.fn((data: any) => Promise.resolve({ id: 'decision-1', ...data, vetoRound: 0 })),
  findById: vi.fn(() => Promise.resolve(null)),
  updateVote: vi.fn(() => Promise.resolve()),
  updateStatus: vi.fn(() => Promise.resolve()),
  incrementVetoRound: vi.fn(() => Promise.resolve()),
};

const mockEscalationRepo = {
  create: vi.fn((data: any) => Promise.resolve({ id: 'escalation-1', ...data })),
};

const mockAgentRepo = {
  findById: vi.fn(() => Promise.resolve(null)),
};

vi.mock('../lib/db.js', () => ({
  eventRepo: mockEventRepo,
  decisionRepo: mockDecisionRepo,
  escalationRepo: mockEscalationRepo,
  agentRepo: mockAgentRepo,
}));

// Mock redis with handler capture
const mockSubscribe = vi.fn((channel: string, handler: (msg: any) => Promise<void>) => {
  messageHandler = handler;
  return Promise.resolve();
});
const mockPublish = vi.fn(() => Promise.resolve());
const mockPushTask = vi.fn(() => Promise.resolve());
const mockPushUrgent = vi.fn(() => Promise.resolve());

vi.mock('../lib/redis.js', () => ({
  subscribe: (channel: string, handler: (msg: any) => Promise<void>) => mockSubscribe(channel, handler),
  publish: (...args: unknown[]) => mockPublish(...args),
  pushTask: (...args: unknown[]) => mockPushTask(...args),
  pushUrgent: (...args: unknown[]) => mockPushUrgent(...args),
  channels: {
    broadcast: 'channel:broadcast',
    head: 'channel:head',
    clevel: 'channel:clevel',
    agent: (id: string) => `channel:agent:${id}`,
  },
}));

describe('Events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageHandler = null;
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('registerHandler', () => {
    it('should register a message handler', async () => {
      const { registerHandler, initialize } = await import('./events.js');
      const handler = vi.fn();

      registerHandler('custom_event', handler);
      await initialize();

      // Now test that the handler gets called
      if (messageHandler) {
        await messageHandler({
          id: 'msg-1',
          type: 'custom_event',
          from: 'test',
          to: 'orchestrator',
          payload: { test: true },
          priority: 'normal',
          timestamp: new Date(),
          requiresResponse: false,
        });

        expect(handler).toHaveBeenCalled();
      }
    });
  });

  describe('initialize', () => {
    it('should subscribe to all channels', async () => {
      const { initialize } = await import('./events.js');

      await initialize();

      expect(mockSubscribe).toHaveBeenCalledWith('channel:broadcast', expect.any(Function));
      expect(mockSubscribe).toHaveBeenCalledWith('channel:head', expect.any(Function));
      expect(mockSubscribe).toHaveBeenCalledWith('channel:clevel', expect.any(Function));
      expect(mockSubscribe).toHaveBeenCalledWith('channel:orchestrator', expect.any(Function));
    });
  });

  describe('sendToAgent', () => {
    it('should send message to specific agent channel', async () => {
      const { sendToAgent } = await import('./events.js');

      const messageId = await sendToAgent('agent-1', 'test_message', { data: 'test' });

      expect(messageId).toBe('test-uuid');
      expect(mockPublish).toHaveBeenCalledWith(
        'channel:agent:agent-1',
        expect.objectContaining({
          type: 'test_message',
          from: 'orchestrator',
          to: 'agent-1',
          payload: { data: 'test' },
          priority: 'normal',
          requiresResponse: false,
        })
      );
    });

    it('should use custom options', async () => {
      const { sendToAgent } = await import('./events.js');
      const deadline = new Date();

      await sendToAgent('agent-1', 'urgent_task', { urgent: true }, {
        priority: 'urgent',
        requiresResponse: true,
        responseDeadline: deadline,
      });

      expect(mockPublish).toHaveBeenCalledWith(
        'channel:agent:agent-1',
        expect.objectContaining({
          priority: 'urgent',
          requiresResponse: true,
          responseDeadline: deadline,
        })
      );
    });
  });

  describe('broadcast', () => {
    it('should broadcast to all agents', async () => {
      const { broadcast } = await import('./events.js');

      const messageId = await broadcast('announcement', { message: 'Hello' });

      expect(messageId).toBe('test-uuid');
      expect(mockPublish).toHaveBeenCalledWith(
        'channel:broadcast',
        expect.objectContaining({
          type: 'announcement',
          to: 'all',
        })
      );
    });

    it('should broadcast to head layer', async () => {
      const { broadcast } = await import('./events.js');

      await broadcast('head_only', { secret: true }, 'head');

      expect(mockPublish).toHaveBeenCalledWith(
        'channel:head',
        expect.objectContaining({
          to: 'head',
        })
      );
    });

    it('should broadcast to clevel layer', async () => {
      const { broadcast } = await import('./events.js');

      await broadcast('clevel_update', {}, 'clevel');

      expect(mockPublish).toHaveBeenCalledWith(
        'channel:clevel',
        expect.objectContaining({
          to: 'clevel',
        })
      );
    });
  });

  describe('triggerEscalation', () => {
    it('should create escalation record', async () => {
      const { triggerEscalation } = await import('./events.js');

      const escalationId = await triggerEscalation({
        reason: 'Test escalation',
        decisionId: 'dec-1',
        channels: ['telegram', 'email'],
      });

      expect(escalationId).toBe('escalation-1');
      expect(mockEscalationRepo.create).toHaveBeenCalledWith({
        decisionId: 'dec-1',
        reason: 'Test escalation',
        channelsNotified: ['telegram', 'email'],
        status: 'pending',
      });
    });

    it('should handle missing decisionId', async () => {
      const { triggerEscalation } = await import('./events.js');

      await triggerEscalation({
        reason: 'Alert escalation',
        channels: ['dashboard'],
      });

      expect(mockEscalationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionId: '',
        })
      );
    });
  });

  describe('Built-in Handlers', () => {
    describe('status_request handler', () => {
      it('should push status request task to agent queue', async () => {
        const { initialize } = await import('./events.js');
        await initialize();

        mockAgentRepo.findById.mockResolvedValue({
          id: 'agent-1',
          type: 'ceo',
          status: 'active',
        });

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'status_request',
            from: 'orchestrator',
            to: 'agent-1',
            payload: { include: ['metrics'] },
            priority: 'normal',
            timestamp: new Date(),
            requiresResponse: true,
          });

          expect(mockPushTask).toHaveBeenCalledWith(
            'agent-1',
            expect.objectContaining({
              type: 'status_request',
              include: ['metrics'],
            })
          );
        }
      });

      it('should use default includes', async () => {
        const { initialize } = await import('./events.js');
        await initialize();

        mockAgentRepo.findById.mockResolvedValue({
          id: 'agent-1',
          type: 'ceo',
          status: 'active',
        });

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'status_request',
            from: 'orchestrator',
            to: 'agent-1',
            payload: {},
            priority: 'normal',
            timestamp: new Date(),
            requiresResponse: true,
          });

          expect(mockPushTask).toHaveBeenCalledWith(
            'agent-1',
            expect.objectContaining({
              include: ['metrics', 'tasks', 'blockers'],
            })
          );
        }
      });

      it('should do nothing if agent not found', async () => {
        const { initialize } = await import('./events.js');
        await initialize();

        mockAgentRepo.findById.mockResolvedValue(null);

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'status_request',
            from: 'orchestrator',
            to: 'nonexistent',
            payload: {},
            priority: 'normal',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockPushTask).not.toHaveBeenCalled();
        }
      });
    });

    describe('task handler', () => {
      it('should push task to agent queue', async () => {
        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'task',
            from: 'ceo',
            to: 'cto',
            payload: {
              title: 'Review code',
              description: 'Review PR #123',
            },
            priority: 'normal',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockPushTask).toHaveBeenCalledWith(
            'cto',
            expect.objectContaining({
              type: 'task',
              title: 'Review code',
              description: 'Review PR #123',
            })
          );
        }
      });

      it('should push urgent tasks to urgent queue', async () => {
        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'task',
            from: 'ceo',
            to: 'cto',
            payload: {
              task_id: 'urgent-task-1',
              title: 'Security fix',
            },
            priority: 'urgent',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockPushUrgent).toHaveBeenCalledWith(
            expect.objectContaining({
              agentId: 'cto',
              taskId: 'urgent-task-1',
              priority: 'urgent',
            })
          );
        }
      });
    });

    describe('decision handler', () => {
      it('should create decision and notify HEAD', async () => {
        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'decision',
            from: 'cfo',
            to: 'orchestrator',
            payload: {
              title: 'Budget increase',
              description: 'Increase marketing budget by 20%',
              type: 'major',
            },
            priority: 'high',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockDecisionRepo.create).toHaveBeenCalledWith(
            expect.objectContaining({
              title: 'Budget increase',
              proposedBy: 'cfo',
              decisionType: 'major',
              status: 'pending',
            })
          );

          expect(mockPublish).toHaveBeenCalledWith(
            'channel:head',
            expect.objectContaining({
              type: 'vote',
              payload: expect.objectContaining({
                decisionId: 'decision-1',
                round: 1,
              }),
            })
          );
        }
      });

      it('should use default decision type', async () => {
        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'decision',
            from: 'cfo',
            to: 'orchestrator',
            payload: {
              title: 'Minor change',
              description: 'Small adjustment',
            },
            priority: 'normal',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockDecisionRepo.create).toHaveBeenCalledWith(
            expect.objectContaining({
              decisionType: 'major',
            })
          );
        }
      });
    });

    describe('vote handler', () => {
      it('should record vote', async () => {
        mockDecisionRepo.findById.mockResolvedValue({
          id: 'decision-1',
          title: 'Test',
          status: 'pending',
          vetoRound: 0,
        });

        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'vote',
            from: 'ceo',
            to: 'orchestrator',
            payload: {
              decisionId: 'decision-1',
              voterType: 'ceo',
              vote: 'approve',
            },
            priority: 'high',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockDecisionRepo.updateVote).toHaveBeenCalledWith(
            'decision-1',
            'ceo',
            'approve'
          );
        }
      });

      it('should do nothing if decision not found', async () => {
        mockDecisionRepo.findById.mockResolvedValue(null);

        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'vote',
            from: 'ceo',
            to: 'orchestrator',
            payload: {
              decisionId: 'nonexistent',
              voterType: 'ceo',
              vote: 'approve',
            },
            priority: 'high',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockDecisionRepo.updateVote).not.toHaveBeenCalled();
        }
      });

      it('should approve decision when both approve', async () => {
        mockDecisionRepo.findById
          .mockResolvedValueOnce({
            id: 'decision-1',
            title: 'Test',
            status: 'pending',
            vetoRound: 0,
          })
          .mockResolvedValueOnce({
            id: 'decision-1',
            title: 'Test',
            status: 'pending',
            ceoVote: 'approve',
            daoVote: 'approve',
            vetoRound: 0,
          });

        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'vote',
            from: 'dao',
            to: 'orchestrator',
            payload: {
              decisionId: 'decision-1',
              voterType: 'dao',
              vote: 'approve',
            },
            priority: 'high',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockDecisionRepo.updateStatus).toHaveBeenCalledWith(
            'decision-1',
            'approved',
            expect.any(Date)
          );
          expect(mockPublish).toHaveBeenCalledWith(
            'channel:broadcast',
            expect.objectContaining({
              payload: expect.objectContaining({
                result: 'approved',
              }),
            })
          );
        }
      });

      it('should veto decision when both veto', async () => {
        mockDecisionRepo.findById
          .mockResolvedValueOnce({
            id: 'decision-1',
            title: 'Test',
            status: 'pending',
            vetoRound: 0,
          })
          .mockResolvedValueOnce({
            id: 'decision-1',
            title: 'Test',
            status: 'pending',
            ceoVote: 'veto',
            daoVote: 'veto',
            vetoRound: 0,
          });

        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'vote',
            from: 'ceo',
            to: 'orchestrator',
            payload: {
              decisionId: 'decision-1',
              voterType: 'ceo',
              vote: 'veto',
            },
            priority: 'high',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockDecisionRepo.updateStatus).toHaveBeenCalledWith(
            'decision-1',
            'vetoed',
            expect.any(Date)
          );
        }
      });

      it('should start C-Level round on split vote', async () => {
        mockDecisionRepo.findById
          .mockResolvedValueOnce({
            id: 'decision-1',
            title: 'Test',
            description: 'Test desc',
            status: 'pending',
            vetoRound: 0,
          })
          .mockResolvedValueOnce({
            id: 'decision-1',
            title: 'Test',
            description: 'Test desc',
            status: 'pending',
            ceoVote: 'approve',
            daoVote: 'veto',
            vetoRound: 0,
          });

        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'vote',
            from: 'dao',
            to: 'orchestrator',
            payload: {
              decisionId: 'decision-1',
              voterType: 'dao',
              vote: 'veto',
            },
            priority: 'high',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockDecisionRepo.incrementVetoRound).toHaveBeenCalledWith('decision-1');
          expect(mockPublish).toHaveBeenCalledWith(
            'channel:clevel',
            expect.objectContaining({
              type: 'vote',
              payload: expect.objectContaining({
                action: 'provide_analysis',
              }),
            })
          );
        }
      });

      it('should escalate to human after max rounds', async () => {
        mockDecisionRepo.findById
          .mockResolvedValueOnce({
            id: 'decision-1',
            title: 'Test',
            status: 'pending',
            vetoRound: 3,
          })
          .mockResolvedValueOnce({
            id: 'decision-1',
            title: 'Test',
            status: 'pending',
            ceoVote: 'approve',
            daoVote: 'veto',
            vetoRound: 3,
          });

        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'vote',
            from: 'ceo',
            to: 'orchestrator',
            payload: {
              decisionId: 'decision-1',
              voterType: 'ceo',
              vote: 'approve',
            },
            priority: 'high',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockDecisionRepo.updateStatus).toHaveBeenCalledWith(
            'decision-1',
            'escalated'
          );
          expect(mockEscalationRepo.create).toHaveBeenCalled();
        }
      });

      it('should handle partial votes (only CEO voted)', async () => {
        mockDecisionRepo.findById
          .mockResolvedValueOnce({
            id: 'decision-1',
            title: 'Test',
            status: 'pending',
            vetoRound: 0,
          })
          .mockResolvedValueOnce({
            id: 'decision-1',
            title: 'Test',
            status: 'pending',
            ceoVote: 'approve',
            // daoVote is undefined
            vetoRound: 0,
          });

        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'vote',
            from: 'ceo',
            to: 'orchestrator',
            payload: {
              decisionId: 'decision-1',
              voterType: 'ceo',
              vote: 'approve',
            },
            priority: 'high',
            timestamp: new Date(),
            requiresResponse: false,
          });

          // Should not process result yet
          expect(mockDecisionRepo.updateStatus).not.toHaveBeenCalled();
        }
      });
    });

    describe('alert handler', () => {
      it('should log alerts', async () => {
        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'alert',
            from: 'cto',
            to: 'orchestrator',
            payload: {
              type: 'security',
              severity: 'warning',
              message: 'Unusual activity detected',
            },
            priority: 'high',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockEventRepo.log).toHaveBeenCalled();
        }
      });

      it('should escalate critical alerts', async () => {
        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'alert',
            from: 'cto',
            to: 'orchestrator',
            payload: {
              type: 'security',
              severity: 'critical',
              message: 'Security breach detected!',
              relatedDecisionId: 'dec-123',
            },
            priority: 'urgent',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockEscalationRepo.create).toHaveBeenCalledWith(
            expect.objectContaining({
              channelsNotified: ['telegram', 'email'],
            })
          );
        }
      });
    });

    describe('unknown message type', () => {
      it('should log warning for unknown message type', async () => {
        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'unknown_type' as any,
            from: 'agent-1',
            to: 'orchestrator',
            payload: {},
            priority: 'normal',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockEventRepo.log).toHaveBeenCalled();
        }
      });
    });

    describe('processMessage with string target', () => {
      it('should handle targetAgent as string', async () => {
        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'status_request',
            from: 'orchestrator',
            to: 'agent-1',
            payload: {},
            priority: 'normal',
            timestamp: new Date(),
            requiresResponse: false,
          });

          expect(mockEventRepo.log).toHaveBeenCalledWith(
            expect.objectContaining({
              targetAgent: 'agent-1',
            })
          );
        }
      });

      it('should handle broadcast target', async () => {
        const { initialize } = await import('./events.js');
        await initialize();

        if (messageHandler) {
          await messageHandler({
            id: 'msg-1',
            type: 'alert',
            from: 'cto',
            to: 'all',
            payload: { severity: 'warning' },
            priority: 'normal',
            timestamp: new Date(),
            requiresResponse: false,
          });

          // 'all' is a string so it will be logged as targetAgent
          expect(mockEventRepo.log).toHaveBeenCalledWith(
            expect.objectContaining({
              targetAgent: 'all',
            })
          );
        }
      });
    });
  });
});
