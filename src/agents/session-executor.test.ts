import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentProfile } from './profile.js';

// Store original env
const originalEnv = { ...process.env };

// Hoisted mocks must be defined before vi.mock
const { mockGetSession, mockSendMessage, mockGetStats, mockShutdown, mockExecuteClaudeCodeWithRetry } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSendMessage: vi.fn(),
  mockGetStats: vi.fn(),
  mockShutdown: vi.fn(),
  mockExecuteClaudeCodeWithRetry: vi.fn(),
}));

// Mock session pool
vi.mock('./session-pool.js', () => ({
  getSessionPool: () => ({
    getSession: mockGetSession,
    getStats: mockGetStats,
  }),
  shutdownSessionPool: mockShutdown,
}));

// Mock claude.js for fallback
vi.mock('./claude.js', () => ({
  executeClaudeCodeWithRetry: (...args: unknown[]) => mockExecuteClaudeCodeWithRetry(...args),
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

// Import after mocks
import {
  executeWithSession,
  executeWithSessionAndRetry,
  buildSessionLoopPrompt,
  getSessionPoolStats,
  shutdownExecutor,
  estimateTokenUsage,
} from './session-executor.js';

// Helper to create mock profile
function createMockProfile(): AgentProfile {
  return {
    type: 'cmo',
    name: 'Chief Marketing Officer',
    codename: 'CMO',
    department: 'Marketing',
    reportsTo: 'ceo',
    mission: 'Drive marketing and community engagement',
    responsibilities: ['Social media', 'Content creation'],
    decisionAuthority: {
      solo: ['Post scheduling'],
      ceoApproval: ['Budget > $100'],
      daoVote: ['Major campaigns'],
    },
    loopInterval: 14400,
    loopActions: ['Check social media'],
    metrics: ['Follower count'],
    communicationStyle: {},
    guidingPrinciples: ['Transparency'],
    startupPrompt: 'Initialize CMO agent',
    rawContent: '# CMO Profile',
  };
}

describe('executeWithSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('with SESSION_POOL_ENABLED=false', () => {
    it('should fall back to single-shot mode', async () => {
      process.env.SESSION_POOL_ENABLED = 'false';

      mockExecuteClaudeCodeWithRetry.mockResolvedValue({
        success: true,
        output: '{"actions": []}',
        durationMs: 1000,
      });

      const result = await executeWithSession(
        {
          agentType: 'cmo',
          profile: createMockProfile(),
        },
        'Test prompt',
        'System prompt'
      );

      expect(result.success).toBe(true);
      expect(mockExecuteClaudeCodeWithRetry).toHaveBeenCalledWith({
        prompt: 'Test prompt',
        systemPrompt: 'System prompt',
        timeout: 300000,
      });
      expect(mockGetSession).not.toHaveBeenCalled();
    });
  });

  describe('with SESSION_POOL_ENABLED=true', () => {
    beforeEach(() => {
      process.env.SESSION_POOL_ENABLED = 'true';
    });

    it('should use session pool', async () => {
      const mockSession = {
        id: 'test-session',
        sendMessage: mockSendMessage.mockResolvedValue('{"actions": []}'),
      };
      mockGetSession.mockResolvedValue(mockSession);

      const result = await executeWithSession(
        {
          agentType: 'cmo',
          profile: createMockProfile(),
        },
        'Test prompt'
      );

      expect(result.success).toBe(true);
      expect(result.output).toBe('{"actions": []}');
      expect(mockGetSession).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith('Test prompt', 300000);
    });

    it('should handle session errors', async () => {
      mockGetSession.mockRejectedValue(new Error('Session failed'));

      const result = await executeWithSession(
        {
          agentType: 'cmo',
          profile: createMockProfile(),
        },
        'Test prompt'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Session failed');
    });

    it('should mark timeout errors as retryable', async () => {
      mockGetSession.mockRejectedValue(new Error('Response timeout after 300000ms'));

      const result = await executeWithSession(
        {
          agentType: 'cmo',
          profile: createMockProfile(),
        },
        'Test prompt'
      );

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
    });

    it('should mark rate limit errors as retryable', async () => {
      mockGetSession.mockRejectedValue(new Error('API returned 529: rate_limit'));

      const result = await executeWithSession(
        {
          agentType: 'cmo',
          profile: createMockProfile(),
        },
        'Test prompt'
      );

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
    });
  });
});

describe('executeWithSessionAndRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_POOL_ENABLED = 'true';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return on first success', async () => {
    const mockSession = {
      id: 'test-session',
      sendMessage: mockSendMessage.mockResolvedValue('{"actions": []}'),
    };
    mockGetSession.mockResolvedValue(mockSession);

    const result = await executeWithSessionAndRetry(
      {
        agentType: 'cmo',
        profile: createMockProfile(),
      },
      'Test prompt',
      undefined,
      300000,
      3
    );

    expect(result.success).toBe(true);
    expect(result.retriesUsed).toBe(0);
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable errors', async () => {
    const mockSession = {
      id: 'test-session',
      sendMessage: mockSendMessage,
    };
    mockGetSession.mockResolvedValue(mockSession);

    // Fail first, succeed second
    mockSendMessage
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('{"actions": []}');

    const result = await executeWithSessionAndRetry(
      {
        agentType: 'cmo',
        profile: createMockProfile(),
      },
      'Test prompt',
      undefined,
      300000,
      3
    );

    expect(result.success).toBe(true);
    expect(result.retriesUsed).toBe(1);
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  }, 15000); // Longer timeout for retry delays

  it('should not retry on non-retryable errors', async () => {
    const mockSession = {
      id: 'test-session',
      sendMessage: mockSendMessage.mockRejectedValue(new Error('Authentication failed')),
    };
    mockGetSession.mockResolvedValue(mockSession);

    const result = await executeWithSessionAndRetry(
      {
        agentType: 'cmo',
        profile: createMockProfile(),
      },
      'Test prompt',
      undefined,
      300000,
      3
    );

    expect(result.success).toBe(false);
    expect(result.retriesUsed).toBe(0);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('buildSessionLoopPrompt', () => {
  it('should include trigger type', () => {
    const prompt = buildSessionLoopPrompt(
      { type: 'cron' },
      {}
    );

    expect(prompt).toContain('**Trigger:** cron');
  });

  it('should include trigger data when present', () => {
    const prompt = buildSessionLoopPrompt(
      { type: 'task', data: { title: 'Test task', priority: 'high' } },
      {}
    );

    expect(prompt).toContain('## Trigger Data');
    expect(prompt).toContain('Test task');
    expect(prompt).toContain('high');
  });

  it('should include state when non-empty', () => {
    const prompt = buildSessionLoopPrompt(
      { type: 'cron' },
      { lastAction: 'posted tweet', mood: 'productive' }
    );

    expect(prompt).toContain('## Current State');
    expect(prompt).toContain('lastAction');
    expect(prompt).toContain('posted tweet');
  });

  it('should exclude internal state keys', () => {
    const prompt = buildSessionLoopPrompt(
      { type: 'cron' },
      { _internal: 'hidden', visible: 'shown' }
    );

    expect(prompt).not.toContain('_internal');
    expect(prompt).toContain('visible');
  });

  it('should include RAG context when provided', () => {
    const prompt = buildSessionLoopPrompt(
      { type: 'cron' },
      {},
      { ragContext: 'Relevant information from knowledge base' }
    );

    expect(prompt).toContain('## Relevant Context');
    expect(prompt).toContain('Relevant information');
  });

  it('should limit RAG context to 1000 chars', () => {
    const longContext = 'A'.repeat(2000);
    const prompt = buildSessionLoopPrompt(
      { type: 'cron' },
      {},
      { ragContext: longContext }
    );

    // Should be truncated
    expect(prompt).toContain('A'.repeat(1000));
    expect(prompt).not.toContain('A'.repeat(1001));
  });

  it('should include priority pending tasks', () => {
    const prompt = buildSessionLoopPrompt(
      { type: 'cron' },
      {},
      {
        pendingTasks: [
          { title: 'Critical task', priority: 'critical', from: 'ceo' },
          { title: 'Low task', priority: 'low', from: 'cmo' },
          { title: 'High task', priority: 'high', from: 'cto' },
        ],
      }
    );

    expect(prompt).toContain('## Priority Tasks');
    expect(prompt).toContain('Critical task');
    expect(prompt).toContain('High task');
    expect(prompt).not.toContain('Low task'); // Low priority excluded
  });

  it('should include pending decisions', () => {
    const prompt = buildSessionLoopPrompt(
      { type: 'cron' },
      {},
      {
        pendingDecisions: [
          { id: 'dec-1', title: 'Marketing budget', tier: 'ceo_approval' },
        ],
      }
    );

    expect(prompt).toContain('## Pending Decisions');
    expect(prompt).toContain('Marketing budget');
    expect(prompt).toContain('dec-1');
  });

  it('should include kanban status', () => {
    const prompt = buildSessionLoopPrompt(
      { type: 'cron' },
      {},
      {
        kanbanIssues: {
          inProgress: [1, 2, 3],
          ready: [4, 5],
        },
      }
    );

    expect(prompt).toContain('## Kanban Status');
    expect(prompt).toContain('In Progress: 3');
    expect(prompt).toContain('Ready to Pick: 2');
  });

  it('should include date and time', () => {
    const prompt = buildSessionLoopPrompt(
      { type: 'cron' },
      {}
    );

    expect(prompt).toContain('**Date:**');
    expect(prompt).toContain('**Time (UTC):**');
  });

  it('should include instructions', () => {
    const prompt = buildSessionLoopPrompt(
      { type: 'cron' },
      {}
    );

    expect(prompt).toContain('## Instructions');
    expect(prompt).toContain('Execute your loop');
    expect(prompt).toContain('JSON');
  });
});

describe('getSessionPoolStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return disabled when SESSION_POOL_ENABLED is false', () => {
    process.env.SESSION_POOL_ENABLED = 'false';

    const stats = getSessionPoolStats();

    expect(stats.enabled).toBe(false);
    expect(stats.stats).toBeNull();
  });

  it('should return stats when enabled', () => {
    process.env.SESSION_POOL_ENABLED = 'true';

    mockGetStats.mockReturnValue({
      totalSessions: 2,
      assignedAgents: ['cmo', 'cto'],
      sessionDetails: [],
    });

    const stats = getSessionPoolStats();

    expect(stats.enabled).toBe(true);
    expect(stats.stats?.totalSessions).toBe(2);
  });
});

describe('shutdownExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should call shutdownSessionPool when enabled', async () => {
    process.env.SESSION_POOL_ENABLED = 'true';
    mockShutdown.mockResolvedValue(undefined);

    await shutdownExecutor();

    expect(mockShutdown).toHaveBeenCalled();
  });

  it('should not call shutdown when disabled', async () => {
    process.env.SESSION_POOL_ENABLED = 'false';

    await shutdownExecutor();

    expect(mockShutdown).not.toHaveBeenCalled();
  });
});

describe('estimateTokenUsage', () => {
  it('should estimate single-shot mode correctly', () => {
    const estimate = estimateTokenUsage(10000, 2000, 'single-shot');

    // 12000 chars / 4 chars per token = 3000 tokens
    expect(estimate.inputTokens).toBe(3000);
    expect(estimate.description).toContain('Full profile');
    expect(estimate.description).toContain('2500 tokens'); // 10000/4
    expect(estimate.description).toContain('500 tokens'); // 2000/4
  });

  it('should estimate session mode correctly', () => {
    const estimate = estimateTokenUsage(10000, 2000, 'session');

    // 2000 chars / 4 = 500 tokens + 100 overhead
    expect(estimate.inputTokens).toBe(600);
    expect(estimate.description).toContain('Prompt only');
  });

  it('should show significant savings for session mode', () => {
    const singleShot = estimateTokenUsage(10000, 2000, 'single-shot');
    const session = estimateTokenUsage(10000, 2000, 'session');

    const savings = 1 - (session.inputTokens / singleShot.inputTokens);
    expect(savings).toBeGreaterThan(0.7); // At least 70% savings
  });
});
