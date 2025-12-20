/**
 * LLM Router
 * Intelligent routing between Claude, Gemini, and OpenAI based on task context
 */

import { createLogger } from '../logger.js';
import { llmConfig } from '../config.js';
import { claudeProvider } from './claude-provider.js';
import { geminiProvider } from './gemini.js';
import { openaiProvider } from './openai.js';
import { selectModelForTask, getModelForProvider } from './models.js';
import { quotaManager } from './quota.js';
import type {
  LLMProvider,
  LLMSession,
  LLMResult,
  TaskContext,
  RoutingStrategy,
  RoutingDecision,
  LLMProviderType,
} from './types.js';

const logger = createLogger('llm-router');

export interface LLMRouterConfig {
  strategy: RoutingStrategy;
  enableFallback: boolean;
  preferGemini: boolean; // Cost optimization flag
  geminiDefaultModel?: string;
}

/**
 * Default routing configuration (from environment)
 */
export const DEFAULT_ROUTER_CONFIG: LLMRouterConfig = {
  strategy: llmConfig.strategy,
  enableFallback: llmConfig.enableFallback,
  preferGemini: llmConfig.preferGemini,
  geminiDefaultModel: llmConfig.geminiDefaultModel,
};

/**
 * LLM Router - Routes requests to appropriate LLM provider
 */
export class LLMRouter {
  private config: LLMRouterConfig;
  private providers: Map<LLMProviderType, LLMProvider>;

  constructor(config: LLMRouterConfig = DEFAULT_ROUTER_CONFIG) {
    this.config = config;
    this.providers = new Map<LLMProviderType, LLMProvider>([
      ['claude', claudeProvider as LLMProvider],
      ['gemini', geminiProvider as LLMProvider],
      ['openai', openaiProvider as LLMProvider],
    ]);
    logger.info({ config }, 'LLM Router initialized');
  }

  /**
   * Check availability of all providers
   */
  async checkAvailability(): Promise<Record<LLMProviderType, boolean>> {
    const [claudeAvailable, geminiAvailable, openaiAvailable] = await Promise.all([
      claudeProvider.isAvailable(),
      geminiProvider.isAvailable(),
      openaiProvider.isAvailable(),
    ]);

    logger.info({ claudeAvailable, geminiAvailable, openaiAvailable }, 'Provider availability checked');

    return {
      claude: claudeAvailable,
      gemini: geminiAvailable,
      openai: openaiAvailable,
    };
  }

  /**
   * Decide which provider to use based on task context
   */
  private routeByTaskType(context?: TaskContext): RoutingDecision {
    // Default: Claude primary, Gemini fallback
    let primary: LLMProviderType = 'claude';
    let fallback: LLMProviderType = 'gemini';
    let reason = 'Default routing';

    // No context - use defaults
    if (!context) {
      return { primary, fallback, reason: 'No context provided - using Claude (default)' };
    }

    // Override: Force Claude for complex reasoning
    if (context.requiresReasoning) {
      return {
        primary: 'claude',
        fallback: 'gemini',
        reason: 'Complex reasoning required - using Claude',
      };
    }

    // Task-type based routing
    switch (context.taskType) {
      // Fast, simple tasks → Gemini (cost-effective)
      case 'spawn_worker':
        primary = 'gemini';
        fallback = 'claude';
        reason = 'Worker spawn (simple task) - using Gemini';
        break;

      case 'operational':
        primary = 'gemini';
        fallback = 'claude';
        reason = 'Operational task (simple) - using Gemini';
        break;

      case 'create_task':
        primary = 'gemini';
        fallback = 'claude';
        reason = 'Task creation (simple) - using Gemini';
        break;

      case 'alert':
        primary = 'gemini';
        fallback = 'claude';
        reason = 'Alert generation (simple) - using Gemini';
        break;

      // Complex reasoning tasks → Claude (better quality)
      case 'propose_decision':
        primary = 'claude';
        fallback = 'gemini';
        reason = 'Decision proposal (complex reasoning) - using Claude';
        break;

      case 'vote':
        primary = 'claude';
        fallback = 'gemini';
        reason = 'Voting (critical decision) - using Claude';
        break;

      case 'loop':
        // Agent loop can use either, prefer based on complexity
        if (context.estimatedComplexity === 'complex') {
          primary = 'claude';
          reason = 'Complex agent loop - using Claude';
        } else {
          primary = 'gemini';
          reason = 'Simple agent loop - using Gemini';
        }
        break;

      default:
        // Unknown task type - use Claude for safety
        primary = 'claude';
        reason = `Unknown task type (${context.taskType}) - using Claude for safety`;
    }

    // Priority override: Critical tasks always use Claude
    if (context.priority === 'critical') {
      primary = 'claude';
      reason += ' (overridden: critical priority)';
    }

    return { primary, fallback, reason };
  }

  /**
   * Route by agent role
   */
  private routeByAgentRole(context?: TaskContext): RoutingDecision {
    if (!context?.agentType) {
      return {
        primary: 'claude',
        fallback: 'gemini',
        reason: 'No agent type - using Claude',
      };
    }

    // Strategic agents → Claude
    if (['ceo', 'dao', 'cto'].includes(context.agentType)) {
      return {
        primary: 'claude',
        fallback: 'gemini',
        reason: `Strategic agent (${context.agentType}) - using Claude`,
      };
    }

    // Operational agents → Gemini
    return {
      primary: 'gemini',
      fallback: 'claude',
      reason: `Operational agent (${context.agentType}) - using Gemini`,
    };
  }

  /**
   * Route with load balancing
   */
  private async routeByLoadBalance(context?: TaskContext): Promise<RoutingDecision> {
    const availability = await this.checkAvailability();

    // If Claude unavailable, use Gemini
    if (!availability.claude && availability.gemini) {
      return {
        primary: 'gemini',
        fallback: 'claude',
        reason: 'Claude unavailable - using Gemini',
      };
    }

    // If Gemini unavailable, use Claude
    if (!availability.gemini && availability.claude) {
      return {
        primary: 'claude',
        fallback: 'gemini',
        reason: 'Gemini unavailable - using Claude',
      };
    }

    // Both available - default to Claude
    return {
      primary: 'claude',
      fallback: 'gemini',
      reason: 'Both available - using Claude (default)',
    };
  }

  /**
   * Gemini-prefer strategy (cost optimization)
   */
  private routeByGeminiPrefer(context?: TaskContext): RoutingDecision {
    // Only use Claude for critical tasks
    if (context?.priority === 'critical' || context?.requiresReasoning) {
      return {
        primary: 'claude',
        fallback: 'gemini',
        reason: 'Critical task - using Claude despite Gemini preference',
      };
    }

    // Everything else → Gemini
    return {
      primary: 'gemini',
      fallback: 'claude',
      reason: 'Cost optimization - preferring Gemini',
    };
  }

  /**
   * Route a request to the appropriate provider
   */
  async route(context?: TaskContext): Promise<RoutingDecision> {
    let decision: RoutingDecision;

    switch (this.config.strategy) {
      case 'task-type':
        decision = this.routeByTaskType(context);
        break;

      case 'agent-role':
        decision = this.routeByAgentRole(context);
        break;

      case 'load-balance':
        decision = await this.routeByLoadBalance(context);
        break;

      case 'gemini-prefer':
        decision = this.routeByGeminiPrefer(context);
        break;

      case 'claude-only':
        decision = {
          primary: 'claude',
          fallback: 'claude', // No real fallback - always Claude
          reason: 'Claude-only mode enabled',
        };
        break;

      default:
        decision = {
          primary: 'claude',
          fallback: 'gemini',
          reason: 'Unknown strategy - defaulting to Claude',
        };
    }

    logger.debug({ context, decision }, 'Routing decision made');
    return decision;
  }

  /**
   * Execute with automatic provider selection, model selection, and fallback
   */
  async execute(session: LLMSession, context?: TaskContext): Promise<LLMResult> {
    // 1. Select appropriate model tier based on task
    const modelTier = selectModelForTask(
      context?.taskType,
      context?.priority,
      context?.requiresReasoning,
      context?.estimatedComplexity
    );

    logger.info({
      taskType: context?.taskType,
      modelTier: modelTier.complexity,
      geminiModel: modelTier.geminiModel,
    }, 'Model tier selected');

    // 2. Route to appropriate provider
    let decision = await this.route(context);

    // 3. Check quota for primary provider
    const estimatedTokens = session.prompt.length / 4; // Rough estimate: 1 token ≈ 4 chars
    const primaryHasQuota = await quotaManager.hasAvailableQuota(decision.primary, estimatedTokens);

    if (!primaryHasQuota) {
      logger.warn({
        provider: decision.primary,
        estimatedTokens,
      }, 'Primary provider quota exhausted, switching to fallback');

      // Switch primary and fallback
      decision = {
        primary: decision.fallback,
        fallback: decision.primary,
        reason: `${decision.primary} quota exhausted - using ${decision.fallback}`,
      };
    }

    const primaryProvider = this.providers.get(decision.primary);
    const fallbackProvider = this.providers.get(decision.fallback);

    if (!primaryProvider) {
      throw new Error(`Primary provider ${decision.primary} not found`);
    }

    // 4. Add model to session (for Gemini)
    const sessionWithModel: LLMSession = {
      ...session,
      model: getModelForProvider(modelTier, decision.primary),
    };

    logger.info({
      primary: decision.primary,
      fallback: decision.fallback,
      model: sessionWithModel.model,
      reason: decision.reason,
    }, 'Executing with LLM provider');

    // 5. Execute with primary provider
    const startTime = Date.now();
    let result = await primaryProvider.executeWithRetry(sessionWithModel);
    const durationMs = Date.now() - startTime;

    // 6. Record usage for quota tracking
    await quotaManager.recordUsage(
      decision.primary,
      estimatedTokens,
      (result.output.length / 4), // Rough completion token estimate
      durationMs,
      result.success
    );

    // 7. If primary failed and fallback enabled, try fallback
    if (!result.success && this.config.enableFallback && fallbackProvider) {
      logger.warn({
        primaryProvider: decision.primary,
        fallbackProvider: decision.fallback,
        error: result.error,
      }, 'Primary provider failed, trying fallback');

      const fallbackSession: LLMSession = {
        ...session,
        model: getModelForProvider(modelTier, decision.fallback),
      };

      const fallbackStart = Date.now();
      result = await fallbackProvider.executeWithRetry(fallbackSession);
      const fallbackDuration = Date.now() - fallbackStart;

      // Record fallback usage
      await quotaManager.recordUsage(
        decision.fallback,
        estimatedTokens,
        (result.output.length / 4),
        fallbackDuration,
        result.success
      );
    }

    return result;
  }

  /**
   * Get a specific provider
   */
  getProvider(type: LLMProviderType): LLMProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Update router configuration
   */
  updateConfig(config: Partial<LLMRouterConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info({ config: this.config }, 'Router configuration updated');
  }
}

// Export singleton instance
export const llmRouter = new LLMRouter();
