/**
 * Initiative System - Compatibility Layer
 *
 * This module provides backwards-compatible exports that delegate to the
 * new plugin-based Initiative Framework in src/lib/initiative/.
 *
 * TASK-037: Refactored from 1474 lines to modular framework.
 * This file now serves as a thin wrapper maintaining the existing API.
 *
 * @deprecated Import from '../lib/initiative/index.js' directly for new code.
 */

// Re-export types from new framework
export type { AgentType, Initiative, FocusSettings, Priority } from '../lib/initiative/index.js';

// Re-export GitHub operations
export {
  // Client utilities
  isGitHubAvailable,
  isCircuitAvailable,

  // Issue operations
  createGitHubIssue,
  createHumanActionRequest,
  addIssueComment,
  updateIssueStatus,
  claimIssue,
  completeIssue,
  fetchGitHubIssues,

  // Cache
  refreshBacklogCache,
  INITIATIVE_CONTEXT_TTL,
} from '../lib/initiative/index.js';

// Re-export context building (internal use only - wrapper functions below for API)
export {
  getFocusSettings,
  setFocusSettings,
} from '../lib/initiative/index.js';

// Re-export runner functions
export { canRunInitiative, runner } from '../lib/initiative/index.js';

// Re-export scoring
export { getTopInitiatives, scoreInitiatives } from '../lib/initiative/index.js';

// Re-export deduplication
export {
  getCreatedHashes,
  getCreatedCount,
  clearDeduplicationCache,
} from '../lib/initiative/index.js';

// Re-export providers for bootstrap initiatives
export {
  AGENT_FOCUS_CONFIGS,
  BOOTSTRAP_INITIATIVES,
  getBootstrapInitiatives,
  registerAllProviders,
} from '../lib/initiative/index.js';

// ============================================================================
// LEGACY FUNCTION WRAPPERS
// These maintain the exact old API signatures while using new implementations
// ============================================================================

import { createLogger } from '../lib/logger.js';
import {
  runner,
  registry,
  registerAllProviders,
  buildContext,
  formatContextAsPrompt,
  type AgentType,
  type Initiative,
  type InitiativeProposal,
  type ContextBuilderOptions,
} from '../lib/initiative/index.js';

const logger = createLogger('initiative-compat');

// Ensure providers are registered on module load
registerAllProviders();

/**
 * Run initiative phase for an agent
 * @deprecated Use runner.run() from '../lib/initiative/index.js'
 */
export async function runInitiativePhase(agentType: AgentType): Promise<{
  created: boolean;
  initiative?: Initiative;
  issueUrl?: string;
  needsAIGeneration?: boolean;
}> {
  try {
    // Check if provider is registered
    if (!registry.has(agentType)) {
      logger.warn({ agentType }, 'Provider not registered, registering now');
      registerAllProviders();
    }

    const result = await runner.run(agentType);

    // Result already matches the expected format
    return {
      created: result.created,
      initiative: result.initiative,
      issueUrl: result.issueUrl,
      needsAIGeneration: result.needsAIGeneration,
    };
  } catch (error) {
    logger.error({ error, agentType }, 'runInitiativePhase failed');
    return { created: false, needsAIGeneration: true };
  }
}

/**
 * Generate bootstrap initiatives for an agent
 * @deprecated Use runner.run() or provider.getBootstrapInitiatives()
 */
export async function generateInitiatives(agentType: AgentType): Promise<Initiative[]> {
  try {
    const canRun = await runner.canRun(agentType);
    if (!canRun) {
      logger.debug({ agentType }, 'Agent in cooldown');
      return [];
    }

    const provider = registry.get(agentType);
    if (!provider) {
      logger.warn({ agentType }, 'Unknown agent type');
      return [];
    }

    return provider.getBootstrapInitiatives?.() || [];
  } catch (error) {
    logger.error({ error, agentType }, 'generateInitiatives failed');
    return [];
  }
}

/**
 * Create initiative from agent proposal
 * @deprecated Use runner.createFromProposal()
 */
export async function createInitiativeFromProposal(
  agentType: AgentType,
  proposal: {
    title: string;
    description: string;
    priority: string;
    revenueImpact: number;
    effort: number;
    tags: string[];
  }
): Promise<{ initiative: Initiative; issueUrl: string | null }> {
  try {
    const initiativeProposal: InitiativeProposal = {
      title: proposal.title,
      description: proposal.description,
      priority: (['critical', 'high', 'medium', 'low'].includes(proposal.priority)
        ? proposal.priority
        : 'medium') as Initiative['priority'],
      revenueImpact: Math.min(10, Math.max(1, proposal.revenueImpact || 5)),
      effort: Math.min(10, Math.max(1, proposal.effort || 5)),
      tags: Array.isArray(proposal.tags) ? proposal.tags : [],
    };

    const result = await runner.createFromProposal(agentType, initiativeProposal);

    return {
      initiative: result.initiative,
      issueUrl: result.issueUrl,
    };
  } catch (error) {
    logger.error({ error, agentType }, 'createInitiativeFromProposal failed');

    // Return a minimal initiative on error
    const fallbackInitiative: Initiative = {
      title: proposal.title,
      description: proposal.description,
      priority: 'medium',
      revenueImpact: proposal.revenueImpact || 5,
      effort: proposal.effort || 5,
      suggestedAssignee: agentType,
      tags: proposal.tags || [],
      source: 'agent-proposed',
    };

    return { initiative: fallbackInitiative, issueUrl: null };
  }
}

/**
 * Get initiative stats
 * @deprecated Use runner.getStats()
 */
export async function getInitiativeStats(): Promise<{
  totalCreated: number;
  agentCooldowns: Record<string, boolean>;
}> {
  return runner.getStats();
}

/**
 * Build initiative context for prompt injection (old API)
 * @deprecated Use buildContext() and formatContextAsPrompt() from '../lib/initiative/index.js'
 */
export async function getInitiativePromptContext(agentType: AgentType): Promise<string> {
  try {
    const provider = registry.get(agentType);
    if (!provider) return '';

    const options: ContextBuilderOptions = {
      sources: provider.getContextSources(),
      focusConfig: provider.getFocusConfig(),
    };
    const context = await buildContext(agentType, options);
    return formatContextAsPrompt(context, agentType);
  } catch (error) {
    logger.warn({ error, agentType }, 'Failed to build initiative context');
    return '';
  }
}

/**
 * Build prompt for AI initiative generation
 * @deprecated Use runner.buildPrompt() from '../lib/initiative/index.js'
 */
export async function buildInitiativeGenerationPrompt(agentType: AgentType): Promise<string> {
  try {
    return await runner.buildPrompt(agentType);
  } catch (error) {
    logger.warn({ error, agentType }, 'Failed to build initiative generation prompt');
    return '';
  }
}
