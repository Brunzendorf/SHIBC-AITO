import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { AgentProfile } from './profile.js';

// Mock child_process
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

// Mock logger
vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock redis
vi.mock('../lib/redis.js', () => ({
  redis: {
    incrbyfloat: vi.fn().mockResolvedValue('1.0'),
    expire: vi.fn().mockResolvedValue(1),
  },
}));

// Import after mocks
import { ClaudeStreamSession, SessionPool, getSessionPool, shutdownSessionPool } from './session-pool.js';

// Helper to create mock process
function createMockProcess() {
  // Use a mutable object to track killed state
  const state = { killed: false };

  const proc = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    killed: boolean;
    kill: () => void;
  };
  proc.stdin = { write: vi.fn().mockReturnValue(true) };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  // Define killed as a getter
  Object.defineProperty(proc, 'killed', {
    get: () => state.killed,
  });

  proc.kill = vi.fn(() => {
    state.killed = true;
    proc.emit('exit', 0);
  });

  return proc;
}

// Helper to create mock profile
function createMockProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    type: 'cmo',
    name: 'Chief Marketing Officer',
    codename: 'CMO',
    department: 'Marketing',
    reportsTo: 'ceo',
    mission: 'Drive marketing and community engagement',
    responsibilities: [
      'Social media management',
      'Content creation',
      'Community engagement',
      'Brand management',
      'Analytics tracking',
    ],
    decisionAuthority: {
      solo: ['Post scheduling'],
      ceoApproval: ['Budget > $100'],
      daoVote: ['Major campaigns'],
    },
    loopInterval: 14400,
    loopActions: ['Check social media', 'Review analytics'],
    metrics: ['Follower count', 'Engagement rate'],
    communicationStyle: {
      internal: 'Professional',
      external: 'Engaging',
    },
    guidingPrinciples: ['Transparency', 'Community first'],
    startupPrompt: 'Initialize CMO agent',
    rawContent: '# CMO Profile\n\nFull profile content here...',
    ...overrides,
  };
}

describe('ClaudeStreamSession', () => {
  let mockProcess: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
  });

  afterEach(async () => {
    // Cleanup singleton
    await shutdownSessionPool();
  });

  describe('constructor', () => {
    it('should create session with correct config', () => {
      const config = {
        agentType: 'cmo' as const,
        profile: createMockProfile(),
      };

      const session = new ClaudeStreamSession('test-session-1', config);

      expect(session.id).toBe('test-session-1');
      expect(session.config.agentType).toBe('cmo');
    });
  });

  describe('start', () => {
    it('should spawn claude process with correct arguments', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
        mcpConfigPath: '/app/.claude/mcp_servers.json',
      });

      const startPromise = session.start();

      // Wait for process initialization
      await new Promise(resolve => setTimeout(resolve, 600));

      const result = await startPromise;

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '--input-format=stream-json',
          '--output-format=stream-json',
          '--dangerously-skip-permissions',
          '--mcp-config',
          '/app/.claude/mcp_servers.json',
        ]),
        expect.objectContaining({
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('should return false if process exits immediately', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      // Simulate immediate exit
      setTimeout(() => {
        mockProcess.kill(); // This sets killed=true and emits exit
      }, 100);

      const result = await session.start();

      expect(result).toBe(false);
    });

    it('should handle spawn errors', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('spawn failed');
      });

      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      const result = await session.start();

      expect(result).toBe(false);
    });
  });

  describe('injectProfile', () => {
    it('should send profile prompt on first injection', async () => {
      const profile = createMockProfile();
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile,
      });

      await session.start();
      await new Promise(resolve => setTimeout(resolve, 600));

      // Mock response
      const injectPromise = session.injectProfile();

      // Simulate Claude response
      setTimeout(() => {
        const response = JSON.stringify({
          type: 'result',
          content: 'I understand my role as CMO. Ready to receive tasks.',
          session_id: 'claude-session-123',
        });
        mockProcess.stdout.emit('data', Buffer.from(response + '\n'));
      }, 100);

      const result = await injectPromise;

      expect(result).toBe(true);
      expect(mockProcess.stdin.write).toHaveBeenCalled();

      // Check that profile content was sent
      const sentData = mockProcess.stdin.write.mock.calls[0][0];
      const parsed = JSON.parse(sentData.replace('\n', ''));
      expect(parsed.type).toBe('user');
      expect(parsed.content).toContain(profile.name);
      expect(parsed.content).toContain(profile.mission);
    });

    it('should not re-inject if already injected', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      await session.start();
      await new Promise(resolve => setTimeout(resolve, 600));

      // First injection
      const firstPromise = session.injectProfile();
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'result',
          content: 'Ready.',
        }) + '\n'));
      }, 100);
      await firstPromise;

      // Clear mock
      mockProcess.stdin.write.mockClear();

      // Second injection should skip
      const result = await session.injectProfile();

      expect(result).toBe(true);
      expect(mockProcess.stdin.write).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('should send message and receive response', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      await session.start();
      await new Promise(resolve => setTimeout(resolve, 600));

      const messagePromise = session.sendMessage('Execute loop');

      // Simulate response
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'result',
          content: '{"actions": [], "summary": "Loop completed"}',
          cost_usd: 0.01,
          duration_ms: 1500,
        }) + '\n'));
      }, 100);

      const response = await messagePromise;

      expect(response).toBe('{"actions": [], "summary": "Loop completed"}');
    });

    it('should timeout if no response', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      await session.start();
      await new Promise(resolve => setTimeout(resolve, 600));

      // Short timeout for test
      await expect(
        session.sendMessage('Test', 100)
      ).rejects.toThrow('timeout');
    });

    it('should reject if session is busy', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      await session.start();
      await new Promise(resolve => setTimeout(resolve, 600));

      // Start first message (don't await)
      session.sendMessage('First message');

      // Try second message immediately
      await expect(
        session.sendMessage('Second message')
      ).rejects.toThrow('Session is busy');
    });

    it('should increment loop count after each message', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      await session.start();
      await new Promise(resolve => setTimeout(resolve, 600));

      expect(session.getStatus().loopCount).toBe(0);

      // Send message
      const messagePromise = session.sendMessage('Loop 1');
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'result',
          content: 'Done',
        }) + '\n'));
      }, 50);
      await messagePromise;

      expect(session.getStatus().loopCount).toBe(1);
    });
  });

  describe('stop', () => {
    it('should send /exit and kill process', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      await session.start();
      await new Promise(resolve => setTimeout(resolve, 600));

      await session.stop();

      expect(mockProcess.stdin.write).toHaveBeenCalledWith('/exit\n');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('shouldRecycle', () => {
    it('should return true when max loops reached', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
        maxLoops: 2,
      });

      await session.start();
      await new Promise(resolve => setTimeout(resolve, 600));

      // Send 2 messages
      for (let i = 0; i < 2; i++) {
        const p = session.sendMessage(`Loop ${i}`);
        setTimeout(() => {
          mockProcess.stdout.emit('data', Buffer.from(JSON.stringify({
            type: 'result',
            content: 'Done',
          }) + '\n'));
        }, 50 + i * 100);
        await p;
      }

      expect(session.shouldRecycle()).toBe(true);
    });

    it('should return true in error state', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      await session.start();
      await new Promise(resolve => setTimeout(resolve, 600));

      // Trigger error state
      mockProcess.emit('error', new Error('Test error'));

      expect(session.shouldRecycle()).toBe(true);
    });
  });

  describe('isAvailable', () => {
    it('should return true when idle and healthy', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      await session.start();
      await new Promise(resolve => setTimeout(resolve, 600));

      expect(session.isAvailable()).toBe(true);
    });

    it('should return false when should recycle', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
        maxLoops: 0, // Immediately should recycle
      });

      await session.start();
      await new Promise(resolve => setTimeout(resolve, 600));

      expect(session.isAvailable()).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return complete status object', async () => {
      const session = new ClaudeStreamSession('test-session-1', {
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      await session.start();
      await new Promise(resolve => setTimeout(resolve, 600));

      const status = session.getStatus();

      expect(status.id).toBe('test-session-1');
      expect(status.state).toBe('idle');
      expect(status.loopCount).toBe(0);
      expect(status.agentType).toBe('cmo');
      expect(status.profileInjected).toBe(false);
      expect(status.lastActivityAt).toBeInstanceOf(Date);
    });
  });
});

describe('SessionPool', () => {
  let mockProcess: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
  });

  afterEach(async () => {
    await shutdownSessionPool();
  });

  describe('getSession', () => {
    it('should create new session for new agent', async () => {
      const pool = new SessionPool(60000);
      const profile = createMockProfile();

      // Mock response for profile injection
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'result',
          content: 'Ready',
        }) + '\n'));
      }, 700);

      const session = await pool.getSession({
        agentType: 'cmo',
        profile,
      });

      expect(session).toBeDefined();
      expect(session.config.agentType).toBe('cmo');

      await pool.stop();
    });

    it('should reuse existing session for same agent', async () => {
      const pool = new SessionPool(60000);
      const profile = createMockProfile();

      // First session
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'result',
          content: 'Ready',
        }) + '\n'));
      }, 700);

      const session1 = await pool.getSession({
        agentType: 'cmo',
        profile,
      });

      // Second request should return same session
      const session2 = await pool.getSession({
        agentType: 'cmo',
        profile,
      });

      expect(session1.id).toBe(session2.id);

      await pool.stop();
    });

    it('should create different sessions for different agents', async () => {
      const pool = new SessionPool(60000);

      // CMO session
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'result',
          content: 'Ready',
        }) + '\n'));
      }, 700);

      const cmoSession = await pool.getSession({
        agentType: 'cmo',
        profile: createMockProfile({ type: 'cmo' }),
      });

      // New mock process for CTO
      const mockProcess2 = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess2);

      setTimeout(() => {
        mockProcess2.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'result',
          content: 'Ready',
        }) + '\n'));
      }, 700);

      const ctoSession = await pool.getSession({
        agentType: 'cto',
        profile: createMockProfile({ type: 'cto', name: 'CTO' }),
      });

      expect(cmoSession.id).not.toBe(ctoSession.id);
      expect(cmoSession.config.agentType).toBe('cmo');
      expect(ctoSession.config.agentType).toBe('cto');

      await pool.stop();
    });
  });

  describe('stop', () => {
    it('should stop all sessions', async () => {
      const pool = new SessionPool(60000);
      pool.start();

      // Create session
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'result',
          content: 'Ready',
        }) + '\n'));
      }, 700);

      await pool.getSession({
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      expect(pool.getStats().totalSessions).toBe(1);

      await pool.stop();

      expect(pool.getStats().totalSessions).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return pool statistics', async () => {
      const pool = new SessionPool(60000);

      // Create session
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'result',
          content: 'Ready',
        }) + '\n'));
      }, 700);

      await pool.getSession({
        agentType: 'cmo',
        profile: createMockProfile(),
      });

      const stats = pool.getStats();

      expect(stats.totalSessions).toBe(1);
      expect(stats.assignedAgents).toContain('cmo');
      expect(stats.sessionDetails).toHaveLength(1);
      expect(stats.sessionDetails[0].agentType).toBe('cmo');

      await pool.stop();
    });
  });
});

describe('getSessionPool singleton', () => {
  afterEach(async () => {
    await shutdownSessionPool();
  });

  it('should return same instance', () => {
    const pool1 = getSessionPool();
    const pool2 = getSessionPool();

    expect(pool1).toBe(pool2);
  });
});

describe('shutdownSessionPool', () => {
  it('should cleanup singleton', async () => {
    const pool1 = getSessionPool();
    await shutdownSessionPool();

    // After shutdown, new call should create new instance
    const pool2 = getSessionPool();
    expect(pool1).not.toBe(pool2);

    await shutdownSessionPool();
  });
});
