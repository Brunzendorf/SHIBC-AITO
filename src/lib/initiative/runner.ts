/**
 * Initiative Runner
 * TASK-037: Orchestrates initiative generation and creation
 */

import crypto from 'crypto';
import type {
  AgentType,
  Initiative,
  InitiativeProvider,
  InitiativeProposal,
  InitiativeResult,
  InitiativePhaseResult,
  InitiativeRunner,
  BuiltInContextSource,
  ContextSource,
} from './types.js';
import { redis, publisher, channels } from '../redis.js';
import { agentRepo } from '../db.js';
import { createLogger } from '../logger.js';
import { registry } from './registry.js';
import { createDeduplicationStrategy, getCreatedCount } from './dedup.js';
import { scoreInitiatives } from './scoring/index.js';
import { createGitHubIssue, searchForSimilarIssue } from './github/index.js';
import { buildContext, getFocusSettings, buildInitiativePrompt } from './context/index.js';

const logger = createLogger('initiative:runner');

// =============================================================================
// COOLDOWN MANAGEMENT
// =============================================================================

const INITIATIVE_COOLDOWN_KEY = 'initiatives:cooldown';
const DEFAULT_COOLDOWN_SECONDS = 3600; // 1 hour

/**
 * Check if agent is in cooldown
 */
async function isInCooldown(agentType: AgentType): Promise<boolean> {
  const key = `${INITIATIVE_COOLDOWN_KEY}:${agentType}`;
  return (await redis.exists(key)) === 1;
}

/**
 * Set cooldown for agent
 */
async function setCooldown(agentType: AgentType, seconds: number): Promise<void> {
  const key = `${INITIATIVE_COOLDOWN_KEY}:${agentType}`;
  await redis.setex(key, seconds, '1');
}

/**
 * Check if agent can run initiative (not in cooldown)
 */
export async function canRunInitiative(agentType: AgentType): Promise<boolean> {
  return !(await isInCooldown(agentType));
}

// =============================================================================
// TASK ASSIGNMENT
// =============================================================================

/**
 * Auto-assign an initiative as a task to the suggested agent
 */
async function assignInitiativeAsTask(
  initiative: Initiative,
  issueUrl: string
): Promise<void> {
  try {
    // Find the agent in DB
    const agent = await agentRepo.findByType(initiative.suggestedAssignee);
    if (!agent) {
      logger.warn({ agentType: initiative.suggestedAssignee }, 'Cannot auto-assign: agent not found');
      return;
    }

    // Create task payload
    const task = {
      title: `[Initiative] ${initiative.title}`,
      description: `${initiative.description}\n\nGitHub Issue: ${issueUrl}\nPriority: ${initiative.priority}\nRevenue Impact: ${initiative.revenueImpact}/10\nEffort: ${initiative.effort}/10`,
      priority: initiative.priority,
      from: 'initiative-system',
      issueUrl,
      tags: initiative.tags,
      createdAt: new Date().toISOString(),
    };

    // Queue to agent's task queue
    const taskQueueKey = `queue:tasks:${initiative.suggestedAssignee}`;
    await redis.rpush(taskQueueKey, JSON.stringify(task));

    // Notify the agent via Redis pub/sub
    await publisher.publish(
      channels.agent(agent.id),
      JSON.stringify({
        id: crypto.randomUUID(),
        type: 'task_queued',
        from: 'initiative-system',
        to: agent.id,
        payload: { title: task.title, queueKey: taskQueueKey },
        priority: initiative.priority,
        timestamp: new Date(),
        requiresResponse: false,
      })
    );

    logger.info({
      agentType: initiative.suggestedAssignee,
      title: initiative.title,
      issueUrl,
    }, 'Initiative auto-assigned as task to agent');
  } catch (error) {
    logger.warn({ error, title: initiative.title }, 'Failed to auto-assign initiative');
  }
}

// =============================================================================
// RUNNER IMPLEMENTATION
// =============================================================================

/**
 * Default Initiative Runner
 */
export class DefaultInitiativeRunner implements InitiativeRunner {
  private dedup = createDeduplicationStrategy();

  /**
   * Check if agent can run initiative
   */
  async canRun(agentType: AgentType): Promise<boolean> {
    return canRunInitiative(agentType);
  }

  /**
   * Run initiative phase for an agent
   */
  async run<T = unknown>(agentType: AgentType): Promise<InitiativePhaseResult<T>> {
    logger.info({ agentType }, 'Running initiative phase');

    // Check cooldown first
    if (await isInCooldown(agentType)) {
      logger.debug({ agentType }, 'Agent in initiative cooldown');
      return { created: false };
    }

    // Get provider
    const provider = registry.get<T>(agentType);
    if (!provider) {
      logger.warn({ agentType }, 'No provider registered, using fallback');
      return this.runWithoutProvider<T>(agentType);
    }

    // Try bootstrap initiatives first
    const bootstrapInitiatives = provider.getBootstrapInitiatives?.() || [];
    if (bootstrapInitiatives.length > 0) {
      return this.runWithBootstrap(agentType, provider, bootstrapInitiatives);
    }

    // No bootstrap available - signal that AI generation is needed
    logger.info({ agentType }, 'No bootstrap initiatives, AI generation needed');
    return { created: false, needsAIGeneration: true };
  }

  /**
   * Run with bootstrap initiatives
   */
  private async runWithBootstrap<T = unknown>(
    agentType: AgentType,
    provider: InitiativeProvider<T>,
    initiatives: Initiative<T>[]
  ): Promise<InitiativePhaseResult<T>> {
    // Filter out already created initiatives
    const newInitiatives: Initiative<T>[] = [];
    for (const init of initiatives) {
      const exists =
        (await this.dedup.wasCreated(init.title)) ||
        (await searchForSimilarIssue(init.title)).found;
      if (!exists) {
        newInitiatives.push(init);
      }
    }

    if (newInitiatives.length === 0) {
      logger.info({ agentType }, 'All bootstrap initiatives already created');
      return { created: false, needsAIGeneration: true };
    }

    // Score and sort
    const focus = await getFocusSettings();
    const scored = scoreInitiatives(newInitiatives, provider.getScoringStrategy(), {
      focus,
      agentType,
    });

    // Take top initiative
    const topInitiative = scored[0].initiative;

    // Validate if provider has validator
    if (provider.validateInitiative && !provider.validateInitiative(topInitiative)) {
      logger.warn({ agentType, title: topInitiative.title }, 'Initiative failed validation');
      return { created: false };
    }

    // Transform if provider has transformer
    const finalInitiative = provider.transformInitiative
      ? provider.transformInitiative(topInitiative)
      : topInitiative;

    // Create GitHub issue
    const issueUrl = await createGitHubIssue(finalInitiative, provider.getFocusConfig());

    if (issueUrl) {
      // Mark as created
      await this.dedup.markCreated(finalInitiative.title);

      // Set cooldown
      const cooldownSeconds = provider.getCooldownSeconds?.() || DEFAULT_COOLDOWN_SECONDS;
      await setCooldown(agentType, cooldownSeconds);

      // Auto-assign as task
      await assignInitiativeAsTask(finalInitiative, issueUrl);

      // Call hook if defined
      await provider.onInitiativeCreated?.(finalInitiative, issueUrl);

      return {
        created: true,
        initiative: finalInitiative,
        issueUrl,
        needsAIGeneration: false,
      };
    }

    return { created: false };
  }

  /**
   * Fallback when no provider is registered
   */
  private async runWithoutProvider<T = unknown>(
    _agentType: AgentType
  ): Promise<InitiativePhaseResult<T>> {
    // Signal AI generation needed
    return { created: false, needsAIGeneration: true };
  }

  /**
   * Build context for initiative generation
   */
  async buildContext(agentType: AgentType) {
    const provider = registry.get(agentType);
    if (!provider) {
      throw new Error(`No provider registered for agent type: ${agentType}`);
    }

    const sources = provider.getContextSources();
    return buildContext(agentType, {
      sources: sources as (BuiltInContextSource | ContextSource)[],
      focusConfig: provider.getFocusConfig(),
    });
  }

  /**
   * Build prompt for AI initiative generation
   */
  async buildPrompt(agentType: AgentType): Promise<string> {
    const provider = registry.get(agentType);
    if (!provider) {
      throw new Error(`No provider registered for agent type: ${agentType}`);
    }

    const sources = provider.getContextSources();

    // Use provider's custom template if available
    if (provider.getPromptTemplate) {
      const context = await buildContext(agentType, {
        sources: sources as (BuiltInContextSource | ContextSource)[],
        focusConfig: provider.getFocusConfig(),
      });
      return provider.getPromptTemplate(context);
    }

    // Use default prompt builder
    return buildInitiativePrompt(agentType, {
      sources: sources as (BuiltInContextSource | ContextSource)[],
      focusConfig: provider.getFocusConfig(),
    });
  }

  /**
   * Create initiative from proposal
   */
  async createFromProposal<T = unknown>(
    agentType: AgentType,
    proposal: InitiativeProposal
  ): Promise<InitiativeResult<T>> {
    const provider = registry.get<T>(agentType);

    // Build initiative from proposal
    const initiative: Initiative<T> = {
      title: proposal.title,
      description: proposal.description,
      priority:
        (['critical', 'high', 'medium', 'low'].includes(proposal.priority)
          ? proposal.priority
          : 'medium') as Initiative['priority'],
      revenueImpact: Math.min(10, Math.max(1, proposal.revenueImpact || 5)),
      effort: Math.min(10, Math.max(1, proposal.effort || 5)),
      suggestedAssignee: agentType,
      tags: Array.isArray(proposal.tags) ? proposal.tags : [],
      source: 'agent-proposed',
    };

    // Check if already exists
    const exists =
      (await this.dedup.wasCreated(initiative.title)) ||
      (await searchForSimilarIssue(initiative.title)).found;

    if (exists) {
      logger.info({ title: initiative.title }, 'Initiative already exists, skipping');
      return { initiative, issueUrl: null };
    }

    // Validate if provider has validator
    if (provider?.validateInitiative && !provider.validateInitiative(initiative)) {
      logger.warn({ title: initiative.title }, 'Initiative failed validation');
      return { initiative, issueUrl: null };
    }

    // Transform if provider has transformer
    const finalInitiative = provider?.transformInitiative
      ? provider.transformInitiative(initiative)
      : initiative;

    // Create GitHub issue
    const focusConfig = provider?.getFocusConfig();
    const issueUrl = await createGitHubIssue(finalInitiative, focusConfig);

    if (issueUrl) {
      await this.dedup.markCreated(finalInitiative.title);

      const cooldownSeconds = provider?.getCooldownSeconds?.() || DEFAULT_COOLDOWN_SECONDS;
      await setCooldown(agentType, cooldownSeconds);

      // Auto-assign as task
      await assignInitiativeAsTask(finalInitiative, issueUrl);

      // Call hook if defined
      await provider?.onInitiativeCreated?.(finalInitiative, issueUrl);
    }

    return { initiative: finalInitiative, issueUrl };
  }

  /**
   * Get initiative statistics
   */
  async getStats(): Promise<{
    totalCreated: number;
    agentCooldowns: Record<AgentType, boolean>;
  }> {
    const totalCreated = await getCreatedCount();

    const agentTypes: AgentType[] = ['ceo', 'cmo', 'cto', 'cfo', 'coo', 'cco', 'dao'];
    const agentCooldowns: Record<AgentType, boolean> = {} as Record<AgentType, boolean>;

    for (const agentType of agentTypes) {
      agentCooldowns[agentType] = await isInCooldown(agentType);
    }

    return {
      totalCreated,
      agentCooldowns,
    };
  }
}

/**
 * Create a new runner instance
 */
export function createRunner(): InitiativeRunner {
  return new DefaultInitiativeRunner();
}

/**
 * Global runner instance
 */
export const runner = createRunner();
