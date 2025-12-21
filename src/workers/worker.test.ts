import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkerTask, WorkerResult } from '../lib/types.js';

// Mock dependencies
vi.mock('../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../lib/mcp.js', () => ({
  MCP_SERVERS_BY_AGENT: {
    ceo: ['filesystem', 'fetch'],
    dao: ['filesystem', 'etherscan'],
    cmo: ['telegram', 'fetch', 'filesystem'],
    cto: ['directus', 'filesystem', 'fetch'],
    cfo: ['etherscan', 'filesystem'],
    coo: ['telegram', 'filesystem'],
    cco: ['filesystem', 'fetch'],
  },
  loadMCPConfig: vi.fn<any, any>().mockReturnValue({
    telegram: { command: 'npx', args: ['-y', '@chaindead/telegram-mcp'] },
    filesystem: { command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-filesystem'] },
    fetch: { command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-fetch'] },
    etherscan: { command: 'npx', args: ['-y', 'etherscan-mcp'] },
  }),
}));

vi.mock('../agents/claude.js', () => ({
  executeClaudeCodeWithMCP: vi.fn<any, any>(),
  isClaudeAvailable: vi.fn<any, any>().mockResolvedValue(true),
}));

vi.mock('../lib/redis.js', () => ({
  publisher: {
    publish: vi.fn<any, any>().mockResolvedValue(1),
    lpush: vi.fn<any, any>().mockResolvedValue(1),
    ltrim: vi.fn<any, any>().mockResolvedValue('OK'),
  },
  channels: {
    workerLogs: 'channel:worker:logs',
  },
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn<any, any>().mockReturnValue(true),
}));

describe('Worker', () => {
  let mockExecuteClaudeCodeWithMCP: any;
  let mockIsClaudeAvailable: any;
  let mockFs: any;
  let mockPublisher: any;

  beforeEach(async () => {
    vi.resetModules();
    const claude = await import('../agents/claude.js');
    const fs = await import('fs');
    const redis = await import('../lib/redis.js');

    mockExecuteClaudeCodeWithMCP = vi.mocked(claude.executeClaudeCodeWithMCP);
    mockIsClaudeAvailable = vi.mocked(claude.isClaudeAvailable);
    mockFs = {
      writeFileSync: vi.mocked(fs.writeFileSync),
      unlinkSync: vi.mocked(fs.unlinkSync),
      existsSync: vi.mocked(fs.existsSync),
    };
    mockPublisher = redis.publisher;

    // Default mocks
    mockIsClaudeAvailable.mockResolvedValue(true);
    mockExecuteClaudeCodeWithMCP.mockResolvedValue({
      success: true,
      output: JSON.stringify({
        success: true,
        result: 'Task completed',
        toolsUsed: ['send_message'],
      }),
      durationMs: 1000,
    });
    mockFs.existsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('validateServerAccess', () => {
    it('should validate allowed servers for agent', async () => {
      const { validateServerAccess } = await import('./worker.js');

      const result = validateServerAccess('cmo', ['telegram', 'filesystem']);
      expect(result.valid).toBe(true);
      expect(result.denied).toEqual([]);
    });

    it('should reject disallowed servers', async () => {
      const { validateServerAccess } = await import('./worker.js');

      const result = validateServerAccess('cmo', ['etherscan']);
      expect(result.valid).toBe(false);
      expect(result.denied).toEqual(['etherscan']);
    });

    it('should reject multiple disallowed servers', async () => {
      const { validateServerAccess } = await import('./worker.js');

      const result = validateServerAccess('cmo', ['etherscan', 'directus']);
      expect(result.valid).toBe(false);
      expect(result.denied).toEqual(['etherscan', 'directus']);
    });

    it('should allow mixed allowed and track denied', async () => {
      const { validateServerAccess } = await import('./worker.js');

      const result = validateServerAccess('cmo', ['telegram', 'etherscan']);
      expect(result.valid).toBe(false);
      expect(result.denied).toEqual(['etherscan']);
    });

    it('should handle unknown agent type', async () => {
      const { validateServerAccess } = await import('./worker.js');

      const result = validateServerAccess('unknown' as any, ['telegram']);
      expect(result.valid).toBe(false);
      expect(result.denied).toEqual(['telegram']);
    });

    it('should validate all agents have filesystem access', async () => {
      const { validateServerAccess } = await import('./worker.js');

      const agents: Array<'ceo' | 'dao' | 'cmo' | 'cto' | 'cfo' | 'coo' | 'cco'> =
        ['ceo', 'dao', 'cmo', 'cto', 'cfo', 'coo', 'cco'];

      agents.forEach(agent => {
        const result = validateServerAccess(agent, ['filesystem']);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('validateWorkerTask', () => {
    it('should validate complete task', async () => {
      const { validateWorkerTask } = await import('./worker.js');

      const task: WorkerTask = {
        id: 'task-123',
        parentAgent: 'cmo',
        parentAgentId: 'agent-123',
        task: 'Send telegram message',
        servers: ['telegram'],
      };

      const result = validateWorkerTask(task);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject task without id', async () => {
      const { validateWorkerTask } = await import('./worker.js');

      const task = {
        parentAgent: 'cmo',
        task: 'Send message',
        servers: ['telegram'],
      } as any;

      const result = validateWorkerTask(task);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing id');
    });

    it('should reject task without parentAgent', async () => {
      const { validateWorkerTask } = await import('./worker.js');

      const task = {
        id: 'task-123',
        task: 'Send message',
        servers: ['telegram'],
      } as any;

      const result = validateWorkerTask(task);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing parentAgent');
    });

    it('should reject task without task description', async () => {
      const { validateWorkerTask } = await import('./worker.js');

      const task = {
        id: 'task-123',
        parentAgent: 'cmo',
        servers: ['telegram'],
      } as any;

      const result = validateWorkerTask(task);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing task');
    });

    it('should reject task without servers', async () => {
      const { validateWorkerTask } = await import('./worker.js');

      const task = {
        id: 'task-123',
        parentAgent: 'cmo',
        task: 'Send message',
      } as any;

      const result = validateWorkerTask(task);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing servers');
    });

    it('should reject task with empty servers array', async () => {
      const { validateWorkerTask } = await import('./worker.js');

      const task = {
        id: 'task-123',
        parentAgent: 'cmo',
        task: 'Send message',
        servers: [],
      } as any;

      const result = validateWorkerTask(task);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing servers');
    });

    it('should collect multiple errors', async () => {
      const { validateWorkerTask } = await import('./worker.js');

      const task = {} as any;

      const result = validateWorkerTask(task);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors).toContain('Missing id');
      expect(result.errors).toContain('Missing parentAgent');
      expect(result.errors).toContain('Missing task');
      expect(result.errors).toContain('Missing servers');
    });
  });

  describe('executeWorker', () => {
    const createValidTask = (): WorkerTask => ({
      id: 'task-123',
      parentAgent: 'cmo',
      parentAgentId: 'agent-123',
      task: 'Send telegram message to channel -1002876952840: Hello!',
      servers: ['telegram'],
      timeout: 60000,
    });

    it('should execute worker successfully', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-123');
      expect(result.result).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    // TASK-021: Config path uses cache key format: /tmp/mcp-config-{servers}.json
    it('should generate MCP config file', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      await executeWorker(task);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/mcp-config-'),
        expect.stringContaining('telegram')
      );
    });

    // TASK-021: Config caching - cleanup is now a no-op, configs are cached and reused
    it('should NOT cleanup MCP config file after execution (cached)', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      await executeWorker(task);

      // Config is cached, not deleted per task
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should reuse cached config for same server combination', async () => {
      const { executeWorker } = await import('./worker.js');

      const task1 = createValidTask();
      const task2 = { ...createValidTask(), taskId: 'task-456' };

      await executeWorker(task1);
      await executeWorker(task2);

      // writeFileSync should only be called once (cached)
      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
    });

    it('should handle execution errors gracefully', async () => {
      mockExecuteClaudeCodeWithMCP.mockRejectedValue(new Error('Claude failed'));

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      await expect(executeWorker(task)).resolves.not.toThrow();
    });

    it('should reject if server access denied', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      task.servers = ['etherscan']; // CMO doesn't have access

      const result = await executeWorker(task);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Access denied');
      expect(mockExecuteClaudeCodeWithMCP).not.toHaveBeenCalled();
    });

    it('should reject if Claude not available', async () => {
      mockIsClaudeAvailable.mockResolvedValue(false);

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Claude not available');
      expect(mockExecuteClaudeCodeWithMCP).not.toHaveBeenCalled();
    });

    it('should reject if no MCP servers configured', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      task.servers = ['nonexistent'];

      const result = await executeWorker(task);

      expect(result.success).toBe(false);
      // 'nonexistent' is not in allowed servers, so access denied is returned first
      expect(result.error).toContain('Access denied');
    });

    it('should pass task and context to Claude', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      task.context = { channel: '-1002876952840', message: 'Hello' };

      await executeWorker(task);

      expect(mockExecuteClaudeCodeWithMCP).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('Send telegram message'),
          systemPrompt: expect.stringContaining('telegram'),
          timeout: 60000,
        })
      );

      const call = mockExecuteClaudeCodeWithMCP.mock.calls[0][0];
      expect(call.prompt).toContain('Context');
      expect(call.prompt).toContain('channel');
    });

    it('should not include context section if no context', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      delete task.context;

      await executeWorker(task);

      const call = mockExecuteClaudeCodeWithMCP.mock.calls[0][0];
      expect(call.prompt).not.toContain('Context');
    });

    // TASK-021: Config path uses cache key format: /tmp/mcp-config-{servers}.json
    it('should pass MCP config path to Claude', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      await executeWorker(task);

      expect(mockExecuteClaudeCodeWithMCP).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpConfigPath: expect.stringContaining('/tmp/mcp-config-'),
        })
      );
    });

    it('should use custom timeout if provided', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      task.timeout = 30000;

      await executeWorker(task);

      expect(mockExecuteClaudeCodeWithMCP).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,
        })
      );
    });

    it('should use default timeout if not provided', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      delete task.timeout;

      await executeWorker(task);

      expect(mockExecuteClaudeCodeWithMCP).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 60000,
        })
      );
    });

    it('should parse JSON output from Claude', async () => {
      mockExecuteClaudeCodeWithMCP.mockResolvedValue({
        success: true,
        output: JSON.stringify({
          success: true,
          result: 'Message sent',
          data: { messageId: '123' },
          toolsUsed: ['send_message'],
        }),
        durationMs: 1000,
      });

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.success).toBe(true);
      expect(result.result).toBe('Message sent');
      expect(result.data).toEqual({ messageId: '123' });
      expect(result.toolsUsed).toEqual(['send_message']);
    });

    it('should handle non-JSON output from Claude', async () => {
      mockExecuteClaudeCodeWithMCP.mockResolvedValue({
        success: true,
        output: 'Plain text output from Claude',
        durationMs: 1000,
      });

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.success).toBe(true);
      expect(result.result).toBe('Plain text output from Claude'.slice(0, 500));
    });

    it('should extract JSON from mixed output', async () => {
      mockExecuteClaudeCodeWithMCP.mockResolvedValue({
        success: true,
        output: 'Some text before\n{"success": true, "result": "Done"}\nSome text after',
        durationMs: 1000,
      });

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.success).toBe(true);
      expect(result.result).toBe('Done');
    });

    it('should handle Claude execution failure', async () => {
      mockExecuteClaudeCodeWithMCP.mockResolvedValue({
        success: false,
        output: '',
        error: 'Claude execution failed',
        durationMs: 1000,
      });

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Claude execution failed');
    });

    it('should handle Claude throwing error', async () => {
      mockExecuteClaudeCodeWithMCP.mockRejectedValue(new Error('Network error'));

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should handle non-Error exceptions', async () => {
      mockExecuteClaudeCodeWithMCP.mockRejectedValue('String error');

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('String error');
    });

    it('should truncate long output', async () => {
      const longOutput = 'x'.repeat(2000);
      mockExecuteClaudeCodeWithMCP.mockResolvedValue({
        success: true,
        output: longOutput,
        durationMs: 1000,
      });

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.result?.length).toBeLessThanOrEqual(1000);
    });

    it('should log tool calls to Redis', async () => {
      mockExecuteClaudeCodeWithMCP.mockResolvedValue({
        success: true,
        output: JSON.stringify({
          success: true,
          result: 'Done',
          toolsUsed: ['send_message', 'get_chat'],
        }),
        durationMs: 1000,
      });

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      await executeWorker(task);

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        'channel:worker:logs',
        expect.stringContaining('send_message')
      );

      expect(mockPublisher.lpush).toHaveBeenCalledWith(
        'worker:logs:history',
        expect.stringContaining('send_message')
      );

      expect(mockPublisher.ltrim).toHaveBeenCalledWith(
        'worker:logs:history',
        0,
        999
      );
    });

    it('should log errors to Redis', async () => {
      mockExecuteClaudeCodeWithMCP.mockResolvedValue({
        success: false,
        output: '',
        error: 'Task failed',
        durationMs: 1000,
      });

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      await executeWorker(task);

      expect(mockPublisher.publish).toHaveBeenCalled();
      const publishCall = (mockPublisher.publish as any).mock.calls[0][1];
      const logEntry = JSON.parse(publishCall);

      expect(logEntry.success).toBe(false);
      expect(logEntry.error).toBe('Task failed');
    });

    it('should handle Redis logging errors gracefully', async () => {
      mockPublisher.publish.mockRejectedValue(new Error('Redis error'));

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      await expect(executeWorker(task)).resolves.not.toThrow();
    });

    it('should include duration in result', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe('number');
    });

    it('should handle multiple servers in config', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      task.servers = ['telegram', 'fetch', 'filesystem'];

      await executeWorker(task);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const configContent = JSON.parse(writeCall[1] as string);

      expect(Object.keys(configContent.mcpServers)).toEqual(['telegram', 'fetch', 'filesystem']);
    });

    it('should only include requested servers in config', async () => {
      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      task.servers = ['telegram']; // Only telegram

      await executeWorker(task);

      const writeCall = mockFs.writeFileSync.mock.calls[0];
      const configContent = JSON.parse(writeCall[1] as string);

      expect(Object.keys(configContent.mcpServers)).toEqual(['telegram']);
      expect(configContent.mcpServers).not.toHaveProperty('fetch');
      expect(configContent.mcpServers).not.toHaveProperty('filesystem');
    });

    it('should default success to true if not in parsed output', async () => {
      mockExecuteClaudeCodeWithMCP.mockResolvedValue({
        success: true,
        output: JSON.stringify({
          result: 'Done',
          // success field missing
        }),
        durationMs: 1000,
      });

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.success).toBe(true);
    });

    it('should respect success: false from Claude output', async () => {
      mockExecuteClaudeCodeWithMCP.mockResolvedValue({
        success: true, // Claude executed successfully
        output: JSON.stringify({
          success: false, // But task failed
          result: 'Task failed internally',
        }),
        durationMs: 1000,
      });

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.success).toBe(false);
    });

    it('should handle missing toolsUsed in output', async () => {
      mockExecuteClaudeCodeWithMCP.mockResolvedValue({
        success: true,
        output: JSON.stringify({
          success: true,
          result: 'Done',
          // toolsUsed missing
        }),
        durationMs: 1000,
      });

      const { executeWorker } = await import('./worker.js');

      const task = createValidTask();
      const result = await executeWorker(task);

      expect(result.toolsUsed).toEqual([]);
    });
  });
});
