import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock multi transaction
// ioredis multi.exec() returns array of [error, result] tuples
const mockMulti = {
  lpush: vi.fn().mockReturnThis(),
  publish: vi.fn().mockReturnThis(),
  exec: vi.fn(() => Promise.resolve([[null, 1], [null, 1]])), // [error, result] pairs
};

// Mock ioredis
const mockRedis = {
  set: vi.fn(() => Promise.resolve<'OK' | null>('OK')),
  get: vi.fn(() => Promise.resolve<string | null>(null)),
  del: vi.fn(() => Promise.resolve(1)),
  keys: vi.fn(() => Promise.resolve<string[]>([])),
  mget: vi.fn(() => Promise.resolve<(string | null)[]>([])),
  incr: vi.fn(() => Promise.resolve(1)),
  expire: vi.fn(() => Promise.resolve(1)),
  lpush: vi.fn(() => Promise.resolve(1)),
  rpop: vi.fn(() => Promise.resolve<string | null>(null)),
  llen: vi.fn(() => Promise.resolve(0)),
  ping: vi.fn(() => Promise.resolve('PONG')),
  quit: vi.fn(() => Promise.resolve('OK')),
  subscribe: vi.fn(() => Promise.resolve(1)),
  unsubscribe: vi.fn(() => Promise.resolve(1)),
  publish: vi.fn(() => Promise.resolve(1)),
  on: vi.fn(),
  multi: vi.fn(() => mockMulti),
};

vi.mock('ioredis', () => ({
  default: vi.fn(() => mockRedis),
}));

// Mock logger
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Redis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('channels', () => {
    it('should define broadcast channel', async () => {
      const { channels } = await import('./redis.js');
      expect(channels.broadcast).toBe('channel:broadcast');
    });

    it('should define head channel', async () => {
      const { channels } = await import('./redis.js');
      expect(channels.head).toBe('channel:head');
    });

    it('should define clevel channel', async () => {
      const { channels } = await import('./redis.js');
      expect(channels.clevel).toBe('channel:clevel');
    });

    it('should create agent channel', async () => {
      const { channels } = await import('./redis.js');
      expect(channels.agent('agent-123')).toBe('channel:agent:agent-123');
    });

    it('should create tasks queue', async () => {
      const { channels } = await import('./redis.js');
      expect(channels.tasks('agent-123')).toBe('queue:tasks:agent-123');
    });

    it('should define urgent queue', async () => {
      const { channels } = await import('./redis.js');
      expect(channels.urgent).toBe('queue:urgent');
    });
  });

  describe('keys', () => {
    it('should create agent status key', async () => {
      const { keys } = await import('./redis.js');
      expect(keys.agentStatus('agent-123')).toBe('agent:status:agent-123');
    });

    it('should create rate limit key', async () => {
      const { keys } = await import('./redis.js');
      expect(keys.rateLimit('agent-123')).toBe('ratelimit:claude:agent-123');
    });

    it('should create decision lock key', async () => {
      const { keys } = await import('./redis.js');
      expect(keys.lock.decision('dec-123')).toBe('lock:decision:dec-123');
    });

    it('should create container lock key', async () => {
      const { keys } = await import('./redis.js');
      expect(keys.lock.container('agent-123')).toBe('lock:container:agent-123');
    });
  });

  describe('setAgentStatus', () => {
    it('should set agent status with TTL', async () => {
      const { setAgentStatus } = await import('./redis.js');
      const status = {
        agentId: 'agent-1',
        status: 'healthy' as const,
        lastCheck: new Date(),
      };

      await setAgentStatus('agent-1', status);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'agent:status:agent-1',
        JSON.stringify(status),
        'EX',
        300
      );
    });
  });

  describe('getAgentStatus', () => {
    it('should return status when found', async () => {
      const status = {
        agentId: 'agent-1',
        status: 'healthy',
        lastCheck: new Date().toISOString(),
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(status));

      const { getAgentStatus } = await import('./redis.js');
      const result = await getAgentStatus('agent-1');

      expect(result).toEqual(status);
    });

    it('should return null when not found', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const { getAgentStatus } = await import('./redis.js');
      const result = await getAgentStatus('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getAllAgentStatuses', () => {
    it('should return all statuses', async () => {
      mockRedis.keys.mockResolvedValueOnce([
        'agent:status:agent-1',
        'agent:status:agent-2',
      ]);
      mockRedis.mget.mockResolvedValueOnce([
        JSON.stringify({ agentId: 'agent-1', status: 'healthy' }),
        JSON.stringify({ agentId: 'agent-2', status: 'unhealthy' }),
      ]);

      const { getAllAgentStatuses } = await import('./redis.js');
      const result = await getAllAgentStatuses();

      expect(result['agent-1'].status).toBe('healthy');
      expect(result['agent-2'].status).toBe('unhealthy');
    });

    it('should return empty object when no statuses', async () => {
      mockRedis.keys.mockResolvedValueOnce([]);

      const { getAllAgentStatuses } = await import('./redis.js');
      const result = await getAllAgentStatuses();

      expect(result).toEqual({});
    });
  });

  describe('pushTask', () => {
    it('should push task to queue atomically with notification', async () => {
      const { pushTask } = await import('./redis.js');
      const task = { title: 'Test task' };

      await pushTask('agent-1', task);

      // TASK-017: pushTask uses multi() for atomic LPUSH + PUBLISH
      expect(mockRedis.multi).toHaveBeenCalled();
      expect(mockMulti.lpush).toHaveBeenCalledWith(
        'queue:tasks:agent-1',
        JSON.stringify(task)
      );
      expect(mockMulti.exec).toHaveBeenCalled();
    });
  });

  describe('popTask', () => {
    it('should pop task from queue', async () => {
      const task = { title: 'Test task' };
      mockRedis.rpop.mockResolvedValueOnce(JSON.stringify(task));

      const { popTask } = await import('./redis.js');
      const result = await popTask('agent-1');

      expect(result).toEqual(task);
    });

    it('should return null when queue empty', async () => {
      mockRedis.rpop.mockResolvedValueOnce(null);

      const { popTask } = await import('./redis.js');
      const result = await popTask('agent-1');

      expect(result).toBeNull();
    });
  });

  describe('getTaskCount', () => {
    it('should return task count', async () => {
      mockRedis.llen.mockResolvedValueOnce(5);

      const { getTaskCount } = await import('./redis.js');
      const result = await getTaskCount('agent-1');

      expect(result).toBe(5);
    });
  });

  describe('pushUrgent', () => {
    it('should push to urgent queue', async () => {
      const { pushUrgent } = await import('./redis.js');
      const task = { urgent: true };

      await pushUrgent(task);

      expect(mockRedis.lpush).toHaveBeenCalledWith(
        'queue:urgent',
        JSON.stringify(task)
      );
    });
  });

  describe('popUrgent', () => {
    it('should pop from urgent queue', async () => {
      const task = { urgent: true };
      mockRedis.rpop.mockResolvedValueOnce(JSON.stringify(task));

      const { popUrgent } = await import('./redis.js');
      const result = await popUrgent();

      expect(result).toEqual(task);
    });
  });

  describe('acquireLock', () => {
    it('should acquire lock when available', async () => {
      mockRedis.set.mockResolvedValueOnce('OK');

      const { acquireLock } = await import('./redis.js');
      const result = await acquireLock('test-lock', 60);

      expect(result).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith('test-lock', '1', 'EX', 60, 'NX');
    });

    it('should fail when lock not available', async () => {
      mockRedis.set.mockResolvedValueOnce(null);

      const { acquireLock } = await import('./redis.js');
      const result = await acquireLock('test-lock');

      expect(result).toBe(false);
    });
  });

  describe('releaseLock', () => {
    it('should release lock', async () => {
      const { releaseLock } = await import('./redis.js');
      await releaseLock('test-lock');

      expect(mockRedis.del).toHaveBeenCalledWith('test-lock');
    });
  });

  describe('checkRateLimit', () => {
    it('should allow when under limit', async () => {
      mockRedis.incr.mockResolvedValueOnce(5);

      const { checkRateLimit } = await import('./redis.js');
      const result = await checkRateLimit('agent-1', 10, 60);

      expect(result).toBe(true);
    });

    it('should deny when over limit', async () => {
      mockRedis.incr.mockResolvedValueOnce(11);

      const { checkRateLimit } = await import('./redis.js');
      const result = await checkRateLimit('agent-1', 10, 60);

      expect(result).toBe(false);
    });

    it('should set expiry on first request', async () => {
      mockRedis.incr.mockResolvedValueOnce(1);

      const { checkRateLimit } = await import('./redis.js');
      await checkRateLimit('agent-1', 10, 60);

      expect(mockRedis.expire).toHaveBeenCalled();
    });
  });

  describe('checkConnection', () => {
    it('should return true when connected', async () => {
      mockRedis.ping.mockResolvedValueOnce('PONG');

      const { checkConnection } = await import('./redis.js');
      const result = await checkConnection();

      expect(result).toBe(true);
    });

    it('should return false when disconnected', async () => {
      mockRedis.ping.mockRejectedValueOnce(new Error('Connection failed'));

      const { checkConnection } = await import('./redis.js');
      const result = await checkConnection();

      expect(result).toBe(false);
    });
  });

  describe('closeConnections', () => {
    it('should close all connections', async () => {
      const { closeConnections } = await import('./redis.js');
      await closeConnections();

      // Called 3 times (redis, subscriber, publisher)
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });

  describe('subscribe', () => {
    it('should subscribe to channel', async () => {
      const { subscribe } = await import('./redis.js');
      const handler = vi.fn();

      await subscribe('test-channel', handler);

      expect(mockRedis.subscribe).toHaveBeenCalledWith('test-channel');
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe from channel', async () => {
      const { unsubscribe } = await import('./redis.js');
      await unsubscribe('test-channel');

      expect(mockRedis.unsubscribe).toHaveBeenCalledWith('test-channel');
    });
  });

  describe('publish', () => {
    it('should publish message', async () => {
      const { publish } = await import('./redis.js');
      const message = {
        id: 'msg-1',
        type: 'broadcast' as const,
        from: 'orchestrator',
        to: 'all' as const,
        payload: {},
        priority: 'normal' as const,
        timestamp: new Date(),
        requiresResponse: false,
      };

      await publish('test-channel', message);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'test-channel',
        JSON.stringify(message)
      );
    });
  });
});
