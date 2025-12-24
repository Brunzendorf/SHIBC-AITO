import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// Mock child_process before importing
vi.mock('child_process', () => ({
  spawn: vi.fn<any, any>(),
}));

// Mock fs to make /app/workspace exist in tests
vi.mock('fs', () => ({
  existsSync: vi.fn((path: string) => path === '/app/workspace'),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Mock logger
vi.mock('../lib/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Import after mocks
import {
  isClaudeAvailable,
  executeClaudeCode,
  buildLoopPrompt,
  parseClaudeOutput,
  executeClaudeCodeWithMCP,
  executeOllamaFallback,
  type ClaudeSession,
  type ClaudeResult,
  type PendingDecision,
} from './claude.js';
import type { AgentProfile } from './profile.js';
import { spawn } from 'child_process';

const mockSpawn = vi.mocked(spawn);

describe('claude', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isClaudeAvailable', () => {
    it('should return true when Claude CLI is available', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockSpawn.mockReturnValue(mockProc as any);

      const promise = isClaudeAvailable();

      // Simulate successful execution
      setTimeout(() => mockProc.emit('close', 0), 10);
      vi.advanceTimersByTime(10);

      const result = await promise;
      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('claude', ['--version'], {
        shell: false,
        stdio: 'pipe',
      });
    });

    it('should return false when Claude CLI is not available (non-zero exit)', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockSpawn.mockReturnValue(mockProc as any);

      // Use retries=1 to avoid retry delays that complicate timer tests
      const promise = isClaudeAvailable(1, 0);

      setTimeout(() => mockProc.emit('close', 1), 10);
      vi.advanceTimersByTime(10);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should return false when spawn throws error', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockSpawn.mockReturnValue(mockProc as any);

      // Use retries=1 to avoid retry delays that complicate timer tests
      const promise = isClaudeAvailable(1, 0);

      setTimeout(() => mockProc.emit('error', new Error('Command not found')), 10);
      vi.advanceTimersByTime(10);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should return false when timeout occurs', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.kill = vi.fn();
      mockSpawn.mockReturnValue(mockProc as any);

      // Use retries=1 to avoid retry delays that complicate timer tests
      const promise = isClaudeAvailable(1, 0);

      // Advance past the 5 second timeout
      vi.advanceTimersByTime(5000);

      const result = await promise;
      expect(result).toBe(false);
      expect(mockProc.kill).toHaveBeenCalled();
    });
  });

  describe('executeClaudeCode', () => {
    it('should execute successfully and return output', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockProc.kill = vi.fn();
      mockSpawn.mockReturnValue(mockProc as any);

      const session: ClaudeSession = {
        prompt: 'Test prompt',
        timeout: 10000,
      };

      const promise = executeClaudeCode(session);

      // Simulate stdout data
      setTimeout(() => {
        mockProc.stdout?.emit('data', Buffer.from('Test output'));
        mockProc.emit('close', 0);
      }, 100);

      vi.advanceTimersByTime(100);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.output).toBe('Test output');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['--print', '--tools', 'default', '--dangerously-skip-permissions', 'Test prompt'],
        expect.objectContaining({
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: '/app/workspace',
        })
      );
    });

    it('should include system prompt when provided', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockSpawn.mockReturnValue(mockProc as any);

      const session: ClaudeSession = {
        prompt: 'Test prompt',
        systemPrompt: 'You are a test agent',
      };

      const promise = executeClaudeCode(session);

      setTimeout(() => {
        mockProc.stdout?.emit('data', Buffer.from('output'));
        mockProc.emit('close', 0);
      }, 10);

      vi.advanceTimersByTime(10);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['--system-prompt', 'You are a test agent', '--print', '--tools', 'default', '--dangerously-skip-permissions', 'Test prompt'],
        expect.anything()
      );
    });

    it('should handle non-zero exit code', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockSpawn.mockReturnValue(mockProc as any);

      const session: ClaudeSession = {
        prompt: 'Test prompt',
      };

      const promise = executeClaudeCode(session);

      setTimeout(() => {
        mockProc.stderr?.emit('data', Buffer.from('Error occurred'));
        mockProc.emit('close', 1);
      }, 10);

      vi.advanceTimersByTime(10);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error occurred');
    });

    it('should handle spawn error', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockSpawn.mockReturnValue(mockProc as any);

      const session: ClaudeSession = {
        prompt: 'Test prompt',
      };

      const promise = executeClaudeCode(session);

      setTimeout(() => {
        mockProc.emit('error', new Error('Spawn failed'));
      }, 10);

      vi.advanceTimersByTime(10);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Spawn failed');
    });

    it('should handle timeout', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockProc.kill = vi.fn();
      mockSpawn.mockReturnValue(mockProc as any);

      const session: ClaudeSession = {
        prompt: 'Test prompt',
        timeout: 1000,
      };

      const promise = executeClaudeCode(session);

      // Advance past timeout
      vi.advanceTimersByTime(1000);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should use default timeout when not specified', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockProc.kill = vi.fn();
      mockSpawn.mockReturnValue(mockProc as any);

      const session: ClaudeSession = {
        prompt: 'Test prompt',
        // No timeout specified, should default to 300000
      };

      const promise = executeClaudeCode(session);

      // Complete successfully before checking timeout
      setTimeout(() => {
        mockProc.stdout?.emit('data', Buffer.from('output'));
        mockProc.emit('close', 0);
      }, 10);

      vi.advanceTimersByTime(10);

      const result = await promise;
      expect(result.success).toBe(true);

      // Verify it would NOT have timed out at 1 second (default is 300000ms)
      expect(mockProc.kill).not.toHaveBeenCalled();
    });

    it('should accumulate multiple stdout chunks', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockSpawn.mockReturnValue(mockProc as any);

      const session: ClaudeSession = {
        prompt: 'Test prompt',
      };

      const promise = executeClaudeCode(session);

      setTimeout(() => {
        mockProc.stdout?.emit('data', Buffer.from('Part 1 '));
        mockProc.stdout?.emit('data', Buffer.from('Part 2 '));
        mockProc.stdout?.emit('data', Buffer.from('Part 3'));
        mockProc.emit('close', 0);
      }, 10);

      vi.advanceTimersByTime(10);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.output).toBe('Part 1 Part 2 Part 3');
    });
  });

  describe('buildLoopPrompt', () => {
    const mockProfile: AgentProfile = {
      type: 'cmo',
      name: 'Chief Marketing Officer',
      codename: 'SHIBC-CMO-001',
      department: 'Marketing',
      reportsTo: 'CEO',
      mission: 'Drive marketing initiatives',
      responsibilities: ['Social media', 'Community engagement'],
      decisionAuthority: {
        solo: ['Post tweets'],
        ceoApproval: ['Launch campaigns'],
        daoVote: ['Rebrand'],
      },
      loopInterval: 3600,
      loopActions: ['Check metrics', 'Post updates'],
      metrics: ['Engagement rate', 'Follower growth'],
      communicationStyle: {
        internal: 'Professional',
      },
      guidingPrinciples: ['Be transparent', 'Engage community'],
      startupPrompt: 'Initialize marketing agent',
      rawContent: '# CMO Profile\n\n## Mission Statement\nDrive marketing initiatives',
    };

    it('should build basic loop prompt', () => {
      const state = { lastAction: 'posted_tweet', count: 5 };
      const trigger = { type: 'scheduled' };

      const prompt = buildLoopPrompt(mockProfile, state, trigger);

      expect(prompt).toContain('# Agent Loop Execution');
      expect(prompt).toContain('## Agent: Chief Marketing Officer (SHIBC-CMO-001)');
      expect(prompt).toContain('## Trigger: scheduled');
      expect(prompt).toContain('## Current State');
      expect(prompt).toContain('"lastAction": "posted_tweet"');
      expect(prompt).toContain('"count": 5');
    });

    it('should include trigger data when provided', () => {
      const state = {};
      const trigger = {
        type: 'task',
        data: { taskId: '123', title: 'Post announcement' }
      };

      const prompt = buildLoopPrompt(mockProfile, state, trigger);

      expect(prompt).toContain('## Trigger Data');
      expect(prompt).toContain('"taskId": "123"');
      expect(prompt).toContain('"title": "Post announcement"');
    });

    it('should include RAG context when provided', () => {
      const state = {};
      const trigger = { type: 'scheduled' };
      const ragContext = '## RAG Context\nPrevious similar decisions: ...';

      const prompt = buildLoopPrompt(mockProfile, state, trigger, undefined, ragContext);

      expect(prompt).toContain('## RAG Context');
      expect(prompt).toContain('Previous similar decisions');
    });

    it('should include pending decisions for CEO', () => {
      const ceoProfile: AgentProfile = { ...mockProfile, codename: 'ceo', type: 'ceo' };
      const state = {};
      const trigger = { type: 'scheduled' };
      const pendingDecisions: PendingDecision[] = [
        {
          id: 'dec-123',
          title: 'Approve marketing budget',
          description: 'Allocate $1000 for ads',
          tier: 'minor',
          proposedBy: 'cmo',
          createdAt: new Date('2024-01-01'),
        },
      ];

      const prompt = buildLoopPrompt(ceoProfile, state, trigger, pendingDecisions);

      expect(prompt).toContain('⚠️ PENDING DECISIONS AWAITING YOUR VOTE');
      expect(prompt).toContain('Approve marketing budget');
      expect(prompt).toContain('dec-123');
      expect(prompt).toContain('minor');
      expect(prompt).toContain('cmo');
    });

    it('should include pending decisions for DAO', () => {
      const daoProfile: AgentProfile = { ...mockProfile, codename: 'dao', type: 'dao' };
      const state = {};
      const trigger = { type: 'scheduled' };
      const pendingDecisions: PendingDecision[] = [
        {
          id: 'dec-456',
          title: 'Token burn proposal',
          tier: 'critical',
          proposedBy: 'ceo',
          createdAt: new Date('2024-01-02'),
        },
      ];

      const prompt = buildLoopPrompt(daoProfile, state, trigger, pendingDecisions);

      expect(prompt).toContain('⚠️ PENDING DECISIONS AWAITING YOUR VOTE');
      expect(prompt).toContain('Token burn proposal');
      expect(prompt).toContain('dec-456');
    });

    it('should NOT include pending decisions for non-HEAD agents', () => {
      const state = {};
      const trigger = { type: 'scheduled' };
      const pendingDecisions: PendingDecision[] = [
        {
          id: 'dec-789',
          title: 'Some decision',
          tier: 'minor',
          proposedBy: 'ceo',
          createdAt: new Date('2024-01-01'),
        },
      ];

      const prompt = buildLoopPrompt(mockProfile, state, trigger, pendingDecisions);

      expect(prompt).not.toContain('⚠️ PENDING DECISIONS AWAITING YOUR VOTE');
      expect(prompt).not.toContain('Some decision');
    });

    it('should include all decision tiers in instructions', () => {
      const state = {};
      const trigger = { type: 'scheduled' };

      const prompt = buildLoopPrompt(mockProfile, state, trigger);

      expect(prompt).toContain('operational');
      expect(prompt).toContain('minor');
      expect(prompt).toContain('major');
      expect(prompt).toContain('critical');
    });

    it('should include action types in instructions', () => {
      const state = {};
      const trigger = { type: 'scheduled' };

      const prompt = buildLoopPrompt(mockProfile, state, trigger);

      expect(prompt).toContain('operational');
      expect(prompt).toContain('propose_decision');
      expect(prompt).toContain('create_task');
      expect(prompt).toContain('vote');
      expect(prompt).toContain('alert');
    });

    it('should include working directory in instructions', () => {
      const state = {};
      const trigger = { type: 'scheduled' };

      const prompt = buildLoopPrompt(mockProfile, state, trigger);

      expect(prompt).toContain('Working directory: /app/workspace');
      expect(prompt).toContain('/app/workspace/SHIBC-CMO-001/'); // Uses codename, not type
    });

    it('should include brand configuration when provided', () => {
      const state = {};
      const trigger = { type: 'scheduled' };
      const brandConfig = {
        name: 'SHIBA CLASSIC',
        shortName: 'SHIBC',
        tagline: 'The Original',
        colors: {
          primary: '#fda92d',
          secondary: '#8E33FF',
          background: '#141A21',
          accent: '#00B8D9',
          text: '#FFFFFF',
        },
        socials: {
          twitter: '@shibc_cto',
          telegram: 't.me/shibaclassic',
          discord: null,
          website: 'shibaclassic.io',
        },
        imageStyle: {
          aesthetic: 'Professional crypto, glassmorphism',
          patterns: 'Blockchain networks',
          mascot: 'Golden Shiba Inu',
          defaultBranding: 'text-footer',
        },
      };

      const prompt = buildLoopPrompt(mockProfile, state, trigger, undefined, undefined, undefined, undefined, brandConfig);

      expect(prompt).toContain('## 🎨 Brand Configuration (CI)');
      expect(prompt).toContain('SHIBA CLASSIC');
      expect(prompt).toContain('SHIBC');
      expect(prompt).toContain('#fda92d');
      expect(prompt).toContain('#8E33FF');
      expect(prompt).toContain('@shibc_cto');
      expect(prompt).toContain('shibaclassic.io');
      expect(prompt).toContain('Professional crypto, glassmorphism');
      expect(prompt).toContain('Golden Shiba Inu');
      expect(prompt).toContain('text-footer');
    });

    it('should not include brand section when brandConfig is null', () => {
      const state = {};
      const trigger = { type: 'scheduled' };

      const prompt = buildLoopPrompt(mockProfile, state, trigger, undefined, undefined, undefined, undefined, null);

      expect(prompt).not.toContain('## 🎨 Brand Configuration (CI)');
    });
  });

  describe('parseClaudeOutput', () => {
    it('should parse JSON in code blocks', () => {
      const output = `
Here is the result:
\`\`\`json
{
  "actions": [{"type": "operational", "data": {"title": "Test"}}],
  "summary": "Done"
}
\`\`\`
`;

      const result = parseClaudeOutput(output);

      expect(result).not.toBeNull();
      expect(result?.actions).toHaveLength(1);
      expect(result?.actions?.[0].type).toBe('operational');
      expect(result?.summary).toBe('Done');
    });

    it('should parse standalone JSON', () => {
      const output = '{"actions": [], "summary": "Complete"}';

      const result = parseClaudeOutput(output);

      expect(result).not.toBeNull();
      expect(result?.actions).toEqual([]);
      expect(result?.summary).toBe('Complete');
    });

    it('should extract JSON object from mixed text', () => {
      const output = `
Some text before
{"actions": [{"type": "alert"}], "messages": []}
Some text after
`;

      const result = parseClaudeOutput(output);

      expect(result).not.toBeNull();
      expect(result?.actions).toHaveLength(1);
      expect(result?.messages).toEqual([]);
    });

    it('should return null for invalid JSON', () => {
      const output = 'This is not JSON at all';

      const result = parseClaudeOutput(output);

      expect(result).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      const output = '{"actions": [invalid}';

      const result = parseClaudeOutput(output);

      expect(result).toBeNull();
    });

    it('should handle JSON with all expected fields', () => {
      const output = `\`\`\`json
{
  "actions": [
    {"type": "operational", "data": {"title": "Test"}},
    {"type": "vote", "data": {"decisionId": "123", "vote": "approve"}}
  ],
  "messages": [
    {"to": "ceo", "content": "Status update"}
  ],
  "stateUpdates": {
    "lastCheck": "2024-01-01"
  },
  "summary": "Completed all tasks"
}
\`\`\``;

      const result = parseClaudeOutput(output);

      expect(result).not.toBeNull();
      expect(result?.actions).toHaveLength(2);
      expect(result?.messages).toHaveLength(1);
      expect(result?.stateUpdates).toEqual({ lastCheck: '2024-01-01' });
      expect(result?.summary).toBe('Completed all tasks');
    });

    it('should handle nested JSON structures', () => {
      const output = `\`\`\`json
{
  "actions": [{
    "type": "create_task",
    "data": {
      "assignTo": "cto",
      "details": {
        "priority": "high",
        "tags": ["urgent", "security"]
      }
    }
  }]
}
\`\`\``;

      const result = parseClaudeOutput(output);

      expect(result).not.toBeNull();
      expect(result?.actions?.[0].type).toBe('create_task');
      const actionData = result?.actions?.[0].data as any;
      expect(actionData.details.priority).toBe('high');
      expect(actionData.details.tags).toEqual(['urgent', 'security']);
    });
  });

  describe('executeClaudeCodeWithMCP', () => {
    it('should execute with MCP config', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockSpawn.mockReturnValue(mockProc as any);

      const session = {
        prompt: 'Test MCP',
        mcpConfigPath: '/path/to/mcp_servers.json',
        timeout: 10000,
      };

      const promise = executeClaudeCodeWithMCP(session);

      setTimeout(() => {
        mockProc.stdout?.emit('data', Buffer.from('MCP output'));
        mockProc.emit('close', 0);
      }, 10);

      vi.advanceTimersByTime(10);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.output).toBe('MCP output');
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['--print', '--dangerously-skip-permissions', '--mcp-config', '/path/to/mcp_servers.json', 'Test MCP'],
        expect.anything()
      );
    });

    it('should execute without MCP config when not provided', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockSpawn.mockReturnValue(mockProc as any);

      const session = {
        prompt: 'Test without MCP',
      };

      const promise = executeClaudeCodeWithMCP(session);

      setTimeout(() => {
        mockProc.stdout?.emit('data', Buffer.from('output'));
        mockProc.emit('close', 0);
      }, 10);

      vi.advanceTimersByTime(10);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['--print', '--dangerously-skip-permissions', 'Test without MCP'],
        expect.anything()
      );
    });

    it('should handle system prompt with MCP', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockSpawn.mockReturnValue(mockProc as any);

      const session = {
        prompt: 'Test',
        systemPrompt: 'You are an MCP agent',
        mcpConfigPath: '/mcp.json',
      };

      const promise = executeClaudeCodeWithMCP(session);

      setTimeout(() => {
        mockProc.stdout?.emit('data', Buffer.from('output'));
        mockProc.emit('close', 0);
      }, 10);

      vi.advanceTimersByTime(10);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['--print', '--dangerously-skip-permissions', '--mcp-config', '/mcp.json', '--system-prompt', 'You are an MCP agent', 'Test'],
        expect.anything()
      );
    });

    it('should handle MCP execution failure', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockSpawn.mockReturnValue(mockProc as any);

      const session = {
        prompt: 'Test',
        mcpConfigPath: '/mcp.json',
      };

      const promise = executeClaudeCodeWithMCP(session);

      setTimeout(() => {
        mockProc.stderr?.emit('data', Buffer.from('MCP error'));
        mockProc.emit('close', 1);
      }, 10);

      vi.advanceTimersByTime(10);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('MCP error');
    });

    it('should handle MCP timeout', async () => {
      const mockProc = new EventEmitter() as ChildProcess;
      mockProc.stdout = new EventEmitter() as any;
      mockProc.stderr = new EventEmitter() as any;
      mockProc.kill = vi.fn();
      mockSpawn.mockReturnValue(mockProc as any);

      const session = {
        prompt: 'Test',
        timeout: 1000,
      };

      const promise = executeClaudeCodeWithMCP(session);

      vi.advanceTimersByTime(1000);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('executeOllamaFallback', () => {
    beforeEach(() => {
      global.fetch = vi.fn<any, any>();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should execute Ollama successfully', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ response: 'Ollama response' }),
      });

      const result = await executeOllamaFallback('Test prompt', 'llama3.2:3b');

      expect(result.success).toBe(true);
      expect(result.output).toBe('Ollama response');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama3.2:3b',
            prompt: 'Test prompt',
            stream: false,
          }),
        })
      );
    });

    it('should use custom OLLAMA_URL from environment', async () => {
      const originalUrl = process.env.OLLAMA_URL;
      process.env.OLLAMA_URL = 'http://custom:8080';

      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ response: 'Response' }),
      });

      await executeOllamaFallback('Test');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom:8080/api/generate',
        expect.anything()
      );

      // Restore
      if (originalUrl) {
        process.env.OLLAMA_URL = originalUrl;
      } else {
        delete process.env.OLLAMA_URL;
      }
    });

    it('should handle HTTP error response', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await executeOllamaFallback('Test prompt');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Ollama returned 500');
    });

    it('should handle network error', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockRejectedValue(new Error('Network failure'));

      const result = await executeOllamaFallback('Test prompt');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Ollama fallback failed');
      expect(result.error).toContain('Network failure');
    });

    it('should handle non-Error exceptions', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockRejectedValue('String error');

      const result = await executeOllamaFallback('Test prompt');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown error');
    });

    it('should use default model when not specified', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ response: 'Response' }),
      });

      await executeOllamaFallback('Test prompt');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"model":"llama3.2:3b"'),
        })
      );
    });

    it('should track execution duration', async () => {
      const mockFetch = global.fetch as any;
      mockFetch.mockImplementation(async () => {
        vi.advanceTimersByTime(500);
        return {
          ok: true,
          json: async () => ({ response: 'Response' }),
        };
      });

      const result = await executeOllamaFallback('Test');

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
