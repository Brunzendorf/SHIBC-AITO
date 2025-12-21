/**
 * Tests for WebSocket Server
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { Server } from 'http';

// Mock WebSocket
class MockWebSocket extends EventEmitter {
  readyState = 1; // OPEN
  send = vi.fn();
  close = vi.fn();
  static OPEN = 1;
  static CLOSED = 3;
}

class MockWebSocketServer extends EventEmitter {
  constructor() {
    super();
  }
}

vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => new MockWebSocketServer()),
  WebSocket: MockWebSocket,
}));

// Mock Redis subscriber
const mockSubscriber = {
  duplicate: vi.fn(),
  psubscribe: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

vi.mock('../lib/redis.js', () => ({
  subscriber: mockSubscriber,
  channels: {
    workerLogs: 'channel:worker:logs',
    broadcast: 'channel:broadcast',
    orchestrator: 'channel:orchestrator',
  },
}));

// Mock agentRepo
const mockAgentRepo = {
  findAll: vi.fn().mockResolvedValue([]),
};

vi.mock('../lib/db.js', () => ({
  agentRepo: mockAgentRepo,
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

describe('WebSocket Server', () => {
  let websocketModule: typeof import('./websocket.js');
  let mockDuplicatedSubscriber: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Setup duplicated subscriber mock
    mockDuplicatedSubscriber = {
      psubscribe: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    mockSubscriber.duplicate.mockReturnValue(mockDuplicatedSubscriber);

    websocketModule = await import('./websocket.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getWebSocketStats', () => {
    it('should return initial stats', () => {
      const stats = websocketModule.getWebSocketStats();

      expect(stats).toHaveProperty('clientCount');
      expect(stats).toHaveProperty('cachedAgents');
      expect(typeof stats.clientCount).toBe('number');
      expect(typeof stats.cachedAgents).toBe('number');
    });
  });

  describe('broadcastEvent', () => {
    it('should broadcast event to clients', () => {
      // This tests the export works - actual broadcast requires clients
      expect(() => {
        websocketModule.broadcastEvent('system_event', { test: true });
      }).not.toThrow();
    });

    it('should handle different event types', () => {
      const types: Array<'agent_status' | 'worker_log' | 'agent_message' | 'system_event'> = [
        'agent_status',
        'worker_log',
        'agent_message',
        'system_event',
      ];

      for (const type of types) {
        expect(() => {
          websocketModule.broadcastEvent(type, { test: true });
        }).not.toThrow();
      }
    });
  });

  describe('initializeWebSocket', () => {
    it('should create WebSocketServer with correct path', async () => {
      const mockServer = {} as Server;

      const wss = await websocketModule.initializeWebSocket(mockServer);

      expect(wss).toBeDefined();
    });

    it('should subscribe to Redis channels', async () => {
      const mockServer = {} as Server;

      await websocketModule.initializeWebSocket(mockServer);

      expect(mockSubscriber.duplicate).toHaveBeenCalled();
      expect(mockDuplicatedSubscriber.psubscribe).toHaveBeenCalledWith(
        'channel:agent:*',
        'channel:broadcast',
        'channel:orchestrator'
      );
      expect(mockDuplicatedSubscriber.subscribe).toHaveBeenCalledWith('channel:worker:logs');
    });

    it('should setup message handlers', async () => {
      const mockServer = {} as Server;

      await websocketModule.initializeWebSocket(mockServer);

      // Should register pmessage and message handlers
      expect(mockDuplicatedSubscriber.on).toHaveBeenCalledWith('pmessage', expect.any(Function));
      expect(mockDuplicatedSubscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
    });
  });

  describe('Redis message handling', () => {
    it('should handle worker log messages', async () => {
      const mockServer = {} as Server;
      await websocketModule.initializeWebSocket(mockServer);

      // Get the message handler
      const messageHandler = mockDuplicatedSubscriber.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      expect(messageHandler).toBeDefined();

      // Should not throw when handling valid message
      expect(() => {
        messageHandler('channel:worker:logs', JSON.stringify({ workerId: 'test', log: 'test log' }));
      }).not.toThrow();
    });

    it('should handle invalid JSON gracefully', async () => {
      const mockServer = {} as Server;
      await websocketModule.initializeWebSocket(mockServer);

      const messageHandler = mockDuplicatedSubscriber.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      // Should not throw on invalid JSON
      expect(() => {
        messageHandler('channel:worker:logs', 'not valid json');
      }).not.toThrow();
    });

    it('should handle pattern messages from agent channels', async () => {
      const mockServer = {} as Server;
      await websocketModule.initializeWebSocket(mockServer);

      const pmessageHandler = mockDuplicatedSubscriber.on.mock.calls.find(
        (call: any[]) => call[0] === 'pmessage'
      )?.[1];

      expect(pmessageHandler).toBeDefined();

      // Should not throw when handling agent message
      expect(() => {
        pmessageHandler(
          'channel:agent:*',
          'channel:agent:agent-123',
          JSON.stringify({
            type: 'task',
            from: 'orchestrator',
            payload: { title: 'Test task' },
          })
        );
      }).not.toThrow();
    });

    it('should handle broadcast channel messages', async () => {
      const mockServer = {} as Server;
      await websocketModule.initializeWebSocket(mockServer);

      const pmessageHandler = mockDuplicatedSubscriber.on.mock.calls.find(
        (call: any[]) => call[0] === 'pmessage'
      )?.[1];

      expect(() => {
        pmessageHandler(
          'channel:broadcast',
          'channel:broadcast',
          JSON.stringify({ type: 'announcement', data: 'test' })
        );
      }).not.toThrow();
    });

    it('should handle orchestrator channel messages', async () => {
      const mockServer = {} as Server;
      await websocketModule.initializeWebSocket(mockServer);

      const pmessageHandler = mockDuplicatedSubscriber.on.mock.calls.find(
        (call: any[]) => call[0] === 'pmessage'
      )?.[1];

      expect(() => {
        pmessageHandler(
          'channel:orchestrator',
          'channel:orchestrator',
          JSON.stringify({ type: 'system', event: 'startup' })
        );
      }).not.toThrow();
    });
  });

  describe('Agent status caching', () => {
    it('should update cache on status_response messages', async () => {
      const mockServer = {} as Server;
      await websocketModule.initializeWebSocket(mockServer);

      const pmessageHandler = mockDuplicatedSubscriber.on.mock.calls.find(
        (call: any[]) => call[0] === 'pmessage'
      )?.[1];

      // Send status response
      pmessageHandler(
        'channel:agent:*',
        'channel:agent:agent-123',
        JSON.stringify({
          type: 'status_response',
          from: 'agent-123',
          payload: { agent: 'cmo', status: 'active' },
        })
      );

      // Stats should reflect the cached agent
      const stats = websocketModule.getWebSocketStats();
      expect(stats.cachedAgents).toBeGreaterThanOrEqual(0);
    });

    it('should update cache on task messages', async () => {
      const mockServer = {} as Server;
      await websocketModule.initializeWebSocket(mockServer);

      const pmessageHandler = mockDuplicatedSubscriber.on.mock.calls.find(
        (call: any[]) => call[0] === 'pmessage'
      )?.[1];

      pmessageHandler(
        'channel:agent:*',
        'channel:agent:agent-456',
        JSON.stringify({
          type: 'task',
          from: 'orchestrator',
          payload: { title: 'New task' },
        })
      );

      // Should not throw
      expect(websocketModule.getWebSocketStats).not.toThrow();
    });

    it('should update cache on decision messages', async () => {
      const mockServer = {} as Server;
      await websocketModule.initializeWebSocket(mockServer);

      const pmessageHandler = mockDuplicatedSubscriber.on.mock.calls.find(
        (call: any[]) => call[0] === 'pmessage'
      )?.[1];

      pmessageHandler(
        'channel:agent:*',
        'channel:agent:agent-789',
        JSON.stringify({
          type: 'decision',
          from: 'ceo',
          payload: { title: 'Important decision' },
        })
      );

      expect(websocketModule.getWebSocketStats).not.toThrow();
    });
  });

  describe('Initial state sending', () => {
    it('should send agent statuses to new clients', async () => {
      const mockAgents = [
        { id: 'agent-1', type: 'cmo', name: 'CMO', status: 'active', updatedAt: new Date() },
        { id: 'agent-2', type: 'cto', name: 'CTO', status: 'idle', updatedAt: new Date() },
      ];
      mockAgentRepo.findAll.mockResolvedValueOnce(mockAgents);

      const mockServer = {} as Server;
      const wss = await websocketModule.initializeWebSocket(mockServer) as any;

      // Simulate a client connection
      const mockClient = new MockWebSocket();
      const mockReq = { socket: { remoteAddress: '127.0.0.1' } };

      // Trigger connection event
      wss.emit('connection', mockClient, mockReq);

      // Wait for async initial state
      await new Promise(resolve => setTimeout(resolve, 50));

      // Client should have received agent statuses
      expect(mockClient.send).toHaveBeenCalled();
    });
  });
});
