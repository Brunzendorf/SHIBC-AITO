/**
 * Tests for LLM Router
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaskContext, LLMSession, LLMResult } from './types.js';

// Mock providers
const mockClaudeProvider = {
  isAvailable: vi.fn().mockResolvedValue(true),
  executeWithRetry: vi.fn().mockResolvedValue({
    success: true,
    output: 'Claude response',
    provider: 'claude',
  } as LLMResult),
};

const mockGeminiProvider = {
  isAvailable: vi.fn().mockResolvedValue(true),
  executeWithRetry: vi.fn().mockResolvedValue({
    success: true,
    output: 'Gemini response',
    provider: 'gemini',
  } as LLMResult),
};

const mockOpenAIProvider = {
  isAvailable: vi.fn().mockResolvedValue(false),
  executeWithRetry: vi.fn().mockResolvedValue({
    success: true,
    output: 'OpenAI response',
    provider: 'openai',
  } as LLMResult),
};

vi.mock('./claude-provider.js', () => ({
  claudeProvider: mockClaudeProvider,
}));

vi.mock('./gemini.js', () => ({
  geminiProvider: mockGeminiProvider,
}));

vi.mock('./openai.js', () => ({
  openaiProvider: mockOpenAIProvider,
}));

// Mock config
vi.mock('../config.js', () => ({
  llmConfig: {
    strategy: 'task-type',
    enableFallback: true,
    preferGemini: false,
    geminiDefaultModel: 'gemini-1.5-flash',
  },
}));

// Mock models
vi.mock('./models.js', () => ({
  selectModelForTask: vi.fn().mockReturnValue({
    complexity: 'simple',
    geminiModel: 'gemini-1.5-flash',
    openaiModel: 'gpt-4o-mini',
  }),
  getModelForProvider: vi.fn().mockReturnValue('gemini-1.5-flash'),
}));

// Mock quota manager
const mockQuotaManager = {
  hasAvailableQuota: vi.fn().mockResolvedValue(true),
  recordUsage: vi.fn().mockResolvedValue(undefined),
};

vi.mock('./quota.js', () => ({
  quotaManager: mockQuotaManager,
}));

// Mock logger
vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('LLM Router', () => {
  let LLMRouter: typeof import('./router.js').LLMRouter;
  let DEFAULT_ROUTER_CONFIG: typeof import('./router.js').DEFAULT_ROUTER_CONFIG;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const routerModule = await import('./router.js');
    LLMRouter = routerModule.LLMRouter;
    DEFAULT_ROUTER_CONFIG = routerModule.DEFAULT_ROUTER_CONFIG;
  });

  describe('constructor', () => {
    it('should create router with default config', () => {
      const router = new LLMRouter();
      expect(router).toBeDefined();
    });

    it('should create router with custom config', () => {
      const router = new LLMRouter({
        strategy: 'gemini-prefer',
        enableFallback: false,
        preferGemini: true,
      });
      expect(router).toBeDefined();
    });
  });

  describe('checkAvailability', () => {
    it('should check all providers', async () => {
      const router = new LLMRouter();
      const availability = await router.checkAvailability();

      expect(mockClaudeProvider.isAvailable).toHaveBeenCalled();
      expect(mockGeminiProvider.isAvailable).toHaveBeenCalled();
      expect(mockOpenAIProvider.isAvailable).toHaveBeenCalled();

      expect(availability.claude).toBe(true);
      expect(availability.gemini).toBe(true);
      expect(availability.openai).toBe(false);
    });
  });

  describe('route - task-type strategy', () => {
    it('should use Claude for no context', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'task-type' });
      const decision = await router.route();

      expect(decision.primary).toBe('claude');
    });

    it('should use Claude for complex reasoning', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'task-type' });
      const context: TaskContext = { requiresReasoning: true };
      const decision = await router.route(context);

      expect(decision.primary).toBe('claude');
      expect(decision.reason).toContain('Complex reasoning');
    });

    it('should use Gemini for spawn_worker tasks', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'task-type' });
      const context: TaskContext = { taskType: 'spawn_worker' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('gemini');
    });

    it('should use Gemini for operational tasks', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'task-type' });
      const context: TaskContext = { taskType: 'operational' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('gemini');
    });

    it('should use Gemini for create_task tasks', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'task-type' });
      const context: TaskContext = { taskType: 'create_task' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('gemini');
    });

    it('should use Gemini for alert tasks', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'task-type' });
      const context: TaskContext = { taskType: 'alert' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('gemini');
    });

    it('should use Claude for propose_decision tasks', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'task-type' });
      const context: TaskContext = { taskType: 'propose_decision' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('claude');
    });

    it('should use Claude for vote tasks', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'task-type' });
      const context: TaskContext = { taskType: 'vote' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('claude');
    });

    it('should use Claude for complex loop tasks', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'task-type' });
      const context: TaskContext = { taskType: 'loop', estimatedComplexity: 'complex' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('claude');
    });

    it('should use Gemini for simple loop tasks', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'task-type' });
      const context: TaskContext = { taskType: 'loop', estimatedComplexity: 'simple' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('gemini');
    });

    it('should override to Claude for critical priority', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'task-type' });
      const context: TaskContext = { taskType: 'spawn_worker', priority: 'critical' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('claude');
      expect(decision.reason).toContain('critical priority');
    });
  });

  describe('route - agent-role strategy', () => {
    it('should use Claude for CEO agent', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'agent-role' });
      const context: TaskContext = { agentType: 'ceo' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('claude');
      expect(decision.reason).toContain('Strategic agent');
    });

    it('should use Claude for DAO agent', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'agent-role' });
      const context: TaskContext = { agentType: 'dao' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('claude');
    });

    it('should use Claude for CTO agent', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'agent-role' });
      const context: TaskContext = { agentType: 'cto' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('claude');
    });

    it('should use Gemini for operational agents', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'agent-role' });
      const context: TaskContext = { agentType: 'cmo' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('gemini');
      expect(decision.reason).toContain('Operational agent');
    });
  });

  describe('route - gemini-prefer strategy', () => {
    it('should prefer Gemini for non-critical tasks', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'gemini-prefer' });
      const context: TaskContext = { taskType: 'operational' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('gemini');
      expect(decision.reason).toContain('Cost optimization');
    });

    it('should use Claude for critical tasks', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'gemini-prefer' });
      const context: TaskContext = { priority: 'critical' };
      const decision = await router.route(context);

      expect(decision.primary).toBe('claude');
    });

    it('should use Claude when reasoning required', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'gemini-prefer' });
      const context: TaskContext = { requiresReasoning: true };
      const decision = await router.route(context);

      expect(decision.primary).toBe('claude');
    });
  });

  describe('route - claude-only strategy', () => {
    it('should always use Claude', async () => {
      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'claude-only' });
      const decision = await router.route({ taskType: 'spawn_worker' });

      expect(decision.primary).toBe('claude');
      expect(decision.fallback).toBe('claude');
      expect(decision.reason).toContain('Claude-only mode');
    });
  });

  describe('route - load-balance strategy', () => {
    it('should use available provider', async () => {
      mockClaudeProvider.isAvailable.mockResolvedValueOnce(false);
      mockGeminiProvider.isAvailable.mockResolvedValueOnce(true);

      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'load-balance' });
      const decision = await router.route();

      expect(decision.primary).toBe('gemini');
      expect(decision.reason).toContain('Claude unavailable');
    });

    it('should default to Claude when both available', async () => {
      mockClaudeProvider.isAvailable.mockResolvedValueOnce(true);
      mockGeminiProvider.isAvailable.mockResolvedValueOnce(true);

      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, strategy: 'load-balance' });
      const decision = await router.route();

      expect(decision.primary).toBe('claude');
    });
  });

  describe('execute', () => {
    it('should execute with primary provider', async () => {
      const router = new LLMRouter();
      const session: LLMSession = {
        prompt: 'Test prompt',
        systemPrompt: 'You are a helpful assistant',
      };

      const result = await router.execute(session);

      expect(result.success).toBe(true);
      expect(mockQuotaManager.hasAvailableQuota).toHaveBeenCalled();
      expect(mockQuotaManager.recordUsage).toHaveBeenCalled();
    });

    it('should switch to fallback when quota exhausted', async () => {
      mockQuotaManager.hasAvailableQuota.mockResolvedValueOnce(false);

      const router = new LLMRouter();
      const session: LLMSession = { prompt: 'Test', systemPrompt: 'Test' };

      await router.execute(session);

      // Should have recorded usage for fallback provider
      expect(mockQuotaManager.recordUsage).toHaveBeenCalled();
    });

    it('should try fallback on primary failure', async () => {
      mockClaudeProvider.executeWithRetry.mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'Primary failed',
        provider: 'claude',
      });

      const router = new LLMRouter({ ...DEFAULT_ROUTER_CONFIG, enableFallback: true });
      const session: LLMSession = { prompt: 'Test', systemPrompt: 'Test' };

      const result = await router.execute(session);

      // Fallback should have been tried
      expect(mockGeminiProvider.executeWithRetry).toHaveBeenCalled();
    });
  });

  describe('getProvider', () => {
    it('should return Claude provider', () => {
      const router = new LLMRouter();
      const provider = router.getProvider('claude');
      expect(provider).toBeDefined();
    });

    it('should return Gemini provider', () => {
      const router = new LLMRouter();
      const provider = router.getProvider('gemini');
      expect(provider).toBeDefined();
    });

    it('should return OpenAI provider', () => {
      const router = new LLMRouter();
      const provider = router.getProvider('openai');
      expect(provider).toBeDefined();
    });
  });

  describe('updateConfig', () => {
    it('should update router configuration', () => {
      const router = new LLMRouter();
      router.updateConfig({ preferGemini: true });

      // Configuration should be updated (verified by subsequent routing behavior)
      expect(router).toBeDefined();
    });
  });
});
