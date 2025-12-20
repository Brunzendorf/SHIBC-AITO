/**
 * LLM Model Configuration & Selection
 * Defines model tiers for different task complexities
 */

import { createLogger } from '../logger.js';

const logger = createLogger('llm-models');

export type ModelComplexity = 'simple' | 'medium' | 'complex' | 'critical';

/**
 * Model tier definition
 */
export interface ModelTier {
  complexity: ModelComplexity;
  geminiModel: string;
  claudeModel?: string; // Claude Code CLI doesn't support model selection
  description: string;
  estimatedCostMultiplier: number; // Relative cost (1 = baseline)
  estimatedSpeed: 'fastest' | 'fast' | 'medium' | 'slow';
}

/**
 * Available model tiers
 */
export const MODEL_TIERS: Record<ModelComplexity, ModelTier> = {
  simple: {
    complexity: 'simple',
    geminiModel: 'gemini-2.5-flash-lite',
    claudeModel: undefined, // Claude CLI uses default model
    description: 'Ultra-fast model for simple tasks (OAuth: 60 RPM, 1K RPD)',
    estimatedCostMultiplier: 1,
    estimatedSpeed: 'fastest',
  },
  medium: {
    complexity: 'medium',
    geminiModel: 'gemini-2.5-flash',
    claudeModel: undefined,
    description: 'Fast, balanced model (OAuth: 60 RPM, 1K RPD)',
    estimatedCostMultiplier: 1.5,
    estimatedSpeed: 'fast',
  },
  complex: {
    complexity: 'complex',
    geminiModel: 'gemini-2.5-flash',
    claudeModel: undefined,
    description: 'Flash handles complex tasks well',
    estimatedCostMultiplier: 3,
    estimatedSpeed: 'medium',
  },
  critical: {
    complexity: 'critical',
    geminiModel: 'gemini-2.5-pro',
    claudeModel: undefined,
    description: 'Most powerful model with 1M context (OAuth: 60 RPM, 1K RPD)',
    estimatedCostMultiplier: 5,
    estimatedSpeed: 'slow',
  },
};

/**
 * Task type to complexity mapping
 */
export const TASK_COMPLEXITY_MAP: Record<string, ModelComplexity> = {
  // Simple tasks - fast models
  spawn_worker: 'simple',
  operational: 'simple',
  alert: 'simple',

  // Medium tasks - balanced models
  create_task: 'medium',
  loop: 'medium',

  // Complex tasks - reasoning models
  propose_decision: 'complex',
  vote: 'complex',

  // Critical tasks - most powerful models
  critical_decision: 'critical',
  smart_contract: 'critical',
};

/**
 * Select appropriate model based on task context
 */
export function selectModelForTask(
  taskType?: string,
  priority?: string,
  requiresReasoning?: boolean,
  estimatedComplexity?: ModelComplexity
): ModelTier {
  // Explicit complexity override
  if (estimatedComplexity) {
    logger.debug({ estimatedComplexity }, 'Using explicit complexity');
    return MODEL_TIERS[estimatedComplexity];
  }

  // Priority-based override (critical priority = critical model)
  if (priority === 'critical') {
    logger.debug({ priority }, 'Using critical model due to priority');
    return MODEL_TIERS.critical;
  }

  // Reasoning flag (forces complex model)
  if (requiresReasoning) {
    logger.debug({ requiresReasoning }, 'Using complex model for reasoning');
    return MODEL_TIERS.complex;
  }

  // Task type mapping
  if (taskType && TASK_COMPLEXITY_MAP[taskType]) {
    const complexity = TASK_COMPLEXITY_MAP[taskType];
    logger.debug({ taskType, complexity }, 'Model selected by task type');
    return MODEL_TIERS[complexity];
  }

  // Default to medium
  logger.debug('Using default medium model');
  return MODEL_TIERS.medium;
}

/**
 * Get model name for provider
 */
export function getModelForProvider(
  tier: ModelTier,
  provider: 'claude' | 'gemini' | 'openai'
): string | undefined {
  if (provider === 'gemini') {
    return tier.geminiModel;
  }
  if (provider === 'openai') {
    // OpenAI Codex uses default model via CLI
    return 'gpt-5-codex';
  }
  // Claude Code CLI doesn't support model selection via CLI args
  // It uses the model configured in user settings
  return tier.claudeModel;
}
