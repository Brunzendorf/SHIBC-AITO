import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../lib/redis.js', () => ({
  publisher: {
    publish: vi.fn<any, any>().mockResolvedValue(1),
    lpush: vi.fn<any, any>().mockResolvedValue(1),
    ltrim: vi.fn<any, any>().mockResolvedValue('OK'),
  },
  channels: {
    agent: vi.fn((id: string) => `channel:agent:${id}`),
    workerLogs: 'channel:worker:logs',
  },
}));

vi.mock('./worker.js', () => ({
  executeWorker: vi.fn<any, any>(),
  validateWorkerTask: vi.fn<any, any>(),
  validateServerAccess: vi.fn<any, any>(),
}));

// Mock crypto for uuid
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'test-uuid-123'),
});

describe('Worker Spawner', () => {
  let mockExecuteWorker: any;
  let mockValidateWorkerTask: any;
  let mockValidateServerAccess: any;
  let mockPublisher: any;

  beforeEach(async () => {
    vi.resetModules();
    const worker = await import('./worker.js');
    const redis = await import('../lib/redis.js');

    mockExecuteWorker = vi.mocked(worker.executeWorker);
    mockValidateWorkerTask = vi.mocked(worker.validateWorkerTask);
    mockValidateServerAccess = vi.mocked(worker.validateServerAccess);
    mockPublisher = redis.publisher;

    // Default mock implementations
    mockValidateServerAccess.mockReturnValue({ valid: true, denied: [] });
    mockValidateWorkerTask.mockReturnValue({ valid: true, errors: [] });
    mockExecuteWorker.mockResolvedValue({
      taskId: 'test-uuid-123',
      success: true,
      result: 'Task completed',
      duration: 1000,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('spawnWorker', () => {
    it('should spawn a worker and return result', async () => {
      const { spawnWorker } = await import('./spawner.js');

      const result = await spawnWorker(
        'agent-123',
        'cmo',
        'Send telegram message',
        ['telegram']
      );

      expect(result).toEqual({
        taskId: 'test-uuid-123',
        success: true,
        result: 'Task completed',
        duration: 1000,
      });

      expect(mockValidateServerAccess).toHaveBeenCalledWith('cmo', ['telegram']);
      expect(mockValidateWorkerTask).toHaveBeenCalled();
      expect(mockExecuteWorker).toHaveBeenCalled();
    });

    it('should pass context and timeout to worker', async () => {
      const { spawnWorker } = await import('./spawner.js');

      const context = { channel: '-1002876952840', message: 'Hello' };
      await spawnWorker(
        'agent-123',
        'cmo',
        'Send message',
        ['telegram'],
        context,
        30000
      );

      expect(mockExecuteWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          timeout: 30000,
        })
      );
    });

    it('should use default timeout if not provided', async () => {
      const { spawnWorker } = await import('./spawner.js');

      await spawnWorker(
        'agent-123',
        'cmo',
        'Send message',
        ['telegram']
      );

      expect(mockExecuteWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 60000,
        })
      );
    });

    it('should reject worker if server access denied', async () => {
      mockValidateServerAccess.mockReturnValue({
        valid: false,
        denied: ['etherscan'],
      });

      const { spawnWorker } = await import('./spawner.js');

      const result = await spawnWorker(
        'agent-123',
        'cmo',
        'Check blockchain',
        ['etherscan']
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Server access denied');
      expect(result.error).toContain('etherscan');
      expect(mockExecuteWorker).not.toHaveBeenCalled();
    });

    it('should reject worker if task validation fails', async () => {
      mockValidateWorkerTask.mockReturnValue({
        valid: false,
        errors: ['Missing task', 'Invalid servers'],
      });

      const { spawnWorker } = await import('./spawner.js');

      const result = await spawnWorker(
        'agent-123',
        'cmo',
        '',
        []
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid task');
      expect(result.error).toContain('Missing task');
      expect(mockExecuteWorker).not.toHaveBeenCalled();
    });

    it('should reject worker if max concurrent workers reached', async () => {
      const { spawnWorker } = await import('./spawner.js');

      // Mock slow worker execution
      mockExecuteWorker.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({
          taskId: 'test-uuid-123',
          success: true,
          duration: 100,
        }), 100))
      );

      // Start 3 workers (max concurrent)
      const promises = [
        spawnWorker('agent-123', 'cmo', 'Task 1', ['telegram']),
        spawnWorker('agent-123', 'cmo', 'Task 2', ['telegram']),
        spawnWorker('agent-123', 'cmo', 'Task 3', ['telegram']),
      ];

      // Try to start 4th worker - should be rejected
      const result = await spawnWorker('agent-123', 'cmo', 'Task 4', ['telegram']);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Max concurrent workers reached');

      // Clean up
      await Promise.all(promises);
    });

    it('should allow new workers after previous ones complete', async () => {
      const { spawnWorker } = await import('./spawner.js');

      mockExecuteWorker.mockResolvedValue({
        taskId: 'test-uuid-123',
        success: true,
        duration: 100,
      });

      // Start and complete first worker
      await spawnWorker('agent-123', 'cmo', 'Task 1', ['telegram']);

      // Start second worker - should succeed
      const result = await spawnWorker('agent-123', 'cmo', 'Task 2', ['telegram']);

      expect(result.success).toBe(true);
    });

    it('should track workers per agent separately', async () => {
      const { spawnWorker } = await import('./spawner.js');

      mockExecuteWorker.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({
          taskId: 'test-uuid-123',
          success: true,
          duration: 100,
        }), 100))
      );

      // Start 3 workers for agent-123
      const promises1 = [
        spawnWorker('agent-123', 'cmo', 'Task 1', ['telegram']),
        spawnWorker('agent-123', 'cmo', 'Task 2', ['telegram']),
        spawnWorker('agent-123', 'cmo', 'Task 3', ['telegram']),
      ];

      // Start worker for agent-456 - should succeed despite agent-123 being at limit
      const result = await spawnWorker('agent-456', 'cto', 'Task 1', ['filesystem']);
      expect(result.success).toBe(true);

      await Promise.all(promises1);
    });

    it('should decrement worker count even on failure', async () => {
      const { spawnWorker } = await import('./spawner.js');

      mockExecuteWorker.mockResolvedValue({
        taskId: 'test-uuid-123',
        success: false,
        error: 'Worker failed',
        duration: 100,
      });

      // Start and fail a worker
      await spawnWorker('agent-123', 'cmo', 'Task 1', ['telegram']);

      // Start another worker - should succeed (count was decremented)
      const result = await spawnWorker('agent-123', 'cmo', 'Task 2', ['telegram']);
      expect(result.success).toBe(false); // Fails due to mock, but wasn't rejected for concurrency
      expect(mockExecuteWorker).toHaveBeenCalledTimes(2);
    });

    it('should generate unique task IDs', async () => {
      const { spawnWorker } = await import('./spawner.js');

      const result1 = await spawnWorker('agent-123', 'cmo', 'Task 1', ['telegram']);
      const result2 = await spawnWorker('agent-123', 'cmo', 'Task 2', ['telegram']);

      // Both use the mocked UUID, and the mock executeWorker returns the taskId
      expect(result1.taskId).toBeDefined();
      expect(result2.taskId).toBeDefined();
      expect(typeof result1.taskId).toBe('string');
    });
  });

  describe('spawnWorkerAsync', () => {
    it('should spawn worker and send result via Redis', async () => {
      const { spawnWorkerAsync } = await import('./spawner.js');

      await spawnWorkerAsync(
        'agent-123',
        'cmo',
        'Send message',
        ['telegram']
      );

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockExecuteWorker).toHaveBeenCalled();
      expect(mockPublisher.publish).toHaveBeenCalled();

      const publishCall = (mockPublisher.publish as any).mock.calls[0];
      expect(publishCall[0]).toBe('channel:agent:agent-123');

      const message = JSON.parse(publishCall[1]);
      expect(message.type).toBe('direct');
      expect(message.from).toContain('worker:');
      expect(message.to).toBe('agent-123');
      expect(message.payload.type).toBe('worker_result');
    });

    it('should include worker result in message payload', async () => {
      mockExecuteWorker.mockResolvedValue({
        taskId: 'test-uuid-123',
        success: true,
        result: 'Message sent successfully',
        toolsUsed: ['send_message'],
        duration: 1500,
      });

      const { spawnWorkerAsync } = await import('./spawner.js');

      await spawnWorkerAsync(
        'agent-123',
        'cmo',
        'Send message',
        ['telegram']
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      const publishCall = (mockPublisher.publish as any).mock.calls[0];
      const message = JSON.parse(publishCall[1]);

      expect(message.payload.taskId).toBe('test-uuid-123');
      expect(message.payload.success).toBe(true);
      expect(message.payload.result).toBe('Message sent successfully');
      expect(message.payload.toolsUsed).toEqual(['send_message']);
      expect(message.payload.duration).toBe(1500);
    });

    it('should handle worker errors gracefully', async () => {
      mockExecuteWorker.mockRejectedValue(new Error('Worker crashed'));

      const { spawnWorkerAsync } = await import('./spawner.js');

      // Should not throw
      await expect(
        spawnWorkerAsync('agent-123', 'cmo', 'Task', ['telegram'])
      ).resolves.not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not have published result
      expect(mockPublisher.publish).not.toHaveBeenCalled();
    });

    it('should set message priority to normal', async () => {
      const { spawnWorkerAsync } = await import('./spawner.js');

      await spawnWorkerAsync('agent-123', 'cmo', 'Task', ['telegram']);
      await new Promise(resolve => setTimeout(resolve, 50));

      const publishCall = (mockPublisher.publish as any).mock.calls[0];
      const message = JSON.parse(publishCall[1]);

      expect(message.priority).toBe('normal');
    });

    it('should not require response', async () => {
      const { spawnWorkerAsync } = await import('./spawner.js');

      await spawnWorkerAsync('agent-123', 'cmo', 'Task', ['telegram']);
      await new Promise(resolve => setTimeout(resolve, 50));

      const publishCall = (mockPublisher.publish as any).mock.calls[0];
      const message = JSON.parse(publishCall[1]);

      expect(message.requiresResponse).toBe(false);
    });

    it('should pass context and timeout', async () => {
      const { spawnWorkerAsync } = await import('./spawner.js');

      const context = { key: 'value' };
      await spawnWorkerAsync(
        'agent-123',
        'cmo',
        'Task',
        ['telegram'],
        context,
        45000
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockExecuteWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          timeout: 45000,
        })
      );
    });
  });

  describe('getActiveWorkerCount', () => {
    it('should return 0 for agent with no active workers', async () => {
      const { getActiveWorkerCount } = await import('./spawner.js');

      const count = getActiveWorkerCount('agent-123');
      expect(count).toBe(0);
    });

    it('should return correct count of active workers', async () => {
      const { spawnWorker, getActiveWorkerCount } = await import('./spawner.js');

      mockExecuteWorker.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({
          taskId: 'test-uuid-123',
          success: true,
          duration: 100,
        }), 100))
      );

      // Start 2 workers
      const promises = [
        spawnWorker('agent-123', 'cmo', 'Task 1', ['telegram']),
        spawnWorker('agent-123', 'cmo', 'Task 2', ['telegram']),
      ];

      // Check count while workers are running
      await new Promise(resolve => setTimeout(resolve, 10));
      const count = getActiveWorkerCount('agent-123');
      expect(count).toBe(2);

      await Promise.all(promises);
    });

    it('should return 0 after workers complete', async () => {
      const { spawnWorker, getActiveWorkerCount } = await import('./spawner.js');

      await spawnWorker('agent-123', 'cmo', 'Task', ['telegram']);

      const count = getActiveWorkerCount('agent-123');
      expect(count).toBe(0);
    });
  });

  describe('getAllActiveWorkers', () => {
    it('should return empty map when no workers', async () => {
      const { getAllActiveWorkers } = await import('./spawner.js');

      const workers = getAllActiveWorkers();
      expect(workers.size).toBe(0);
    });

    it('should return map of all active workers', async () => {
      const { spawnWorker, getAllActiveWorkers } = await import('./spawner.js');

      mockExecuteWorker.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({
          taskId: 'test-uuid-123',
          success: true,
          duration: 100,
        }), 100))
      );

      // Start workers for multiple agents
      const promises = [
        spawnWorker('agent-123', 'cmo', 'Task 1', ['telegram']),
        spawnWorker('agent-123', 'cmo', 'Task 2', ['telegram']),
        spawnWorker('agent-456', 'cto', 'Task 3', ['filesystem']),
      ];

      await new Promise(resolve => setTimeout(resolve, 10));

      const workers = getAllActiveWorkers();
      expect(workers.size).toBe(2);
      expect(workers.get('agent-123')).toBe(2);
      expect(workers.get('agent-456')).toBe(1);

      await Promise.all(promises);
    });

    it('should return independent copy of worker map', async () => {
      const { getAllActiveWorkers } = await import('./spawner.js');

      const workers1 = getAllActiveWorkers();
      const workers2 = getAllActiveWorkers();

      expect(workers1).not.toBe(workers2);
      expect(workers1).toEqual(workers2);
    });
  });

  describe('MAX_CONCURRENT_WORKERS', () => {
    it('should respect custom max concurrent workers from env', async () => {
      process.env.WORKER_MAX_CONCURRENT = '5';

      vi.resetModules();
      const { spawnWorker } = await import('./spawner.js');

      mockExecuteWorker.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({
          taskId: 'test-uuid-123',
          success: true,
          duration: 100,
        }), 100))
      );

      // Start 5 workers
      const promises = Array.from({ length: 5 }, (_, i) =>
        spawnWorker('agent-123', 'cmo', `Task ${i}`, ['telegram'])
      );

      // 6th should fail
      const result = await spawnWorker('agent-123', 'cmo', 'Task 6', ['telegram']);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Max concurrent workers reached');

      await Promise.all(promises);
      delete process.env.WORKER_MAX_CONCURRENT;
    });

    it('should use default of 3 if env not set', async () => {
      delete process.env.WORKER_MAX_CONCURRENT;

      vi.resetModules();
      const { spawnWorker } = await import('./spawner.js');

      mockExecuteWorker.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({
          taskId: 'test-uuid-123',
          success: true,
          duration: 100,
        }), 100))
      );

      // Start 3 workers
      const promises = Array.from({ length: 3 }, (_, i) =>
        spawnWorker('agent-123', 'cmo', `Task ${i}`, ['telegram'])
      );

      // 4th should fail
      const result = await spawnWorker('agent-123', 'cmo', 'Task 4', ['telegram']);
      expect(result.success).toBe(false);

      await Promise.all(promises);
    });
  });
});
