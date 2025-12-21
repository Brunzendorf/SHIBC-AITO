/**
 * Context Builder
 * TASK-037: Aggregates context from multiple sources
 */

import type {
  AgentType,
  ContextSource,
  BuiltInContextSource,
  AggregatedContext,
  FocusSettings,
  AgentFocusConfig,
} from '../types.js';
import { DEFAULT_FOCUS } from '../types.js';
import { redis } from '../../redis.js';
import { createLogger } from '../../logger.js';
import {
  createRAGSource,
  createTeamStatusSource,
  createMarketDataSource,
  createGitHubSource,
} from './sources/index.js';
import { getCreatedHashes } from '../dedup.js';

const logger = createLogger('initiative:context:builder');

// =============================================================================
// FOCUS SETTINGS
// =============================================================================

const FOCUS_KEY = 'settings:focus';

/**
 * Get current focus settings from Redis
 */
export async function getFocusSettings(): Promise<FocusSettings> {
  try {
    const stored = await redis.get(FOCUS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to load focus settings, using defaults');
  }
  return DEFAULT_FOCUS;
}

/**
 * Save focus settings to Redis
 */
export async function setFocusSettings(settings: FocusSettings): Promise<void> {
  await redis.set(FOCUS_KEY, JSON.stringify(settings));
}

// =============================================================================
// BUILT-IN SOURCES
// =============================================================================

/**
 * Get built-in context source by name
 */
export function getBuiltInSource(name: BuiltInContextSource): ContextSource {
  switch (name) {
    case 'rag':
      return createRAGSource();
    case 'github':
      return createGitHubSource();
    case 'team-status':
      return createTeamStatusSource();
    case 'market-data':
      return createMarketDataSource();
    default:
      throw new Error(`Unknown built-in source: ${name}`);
  }
}

/**
 * Resolve source - can be a name or a ContextSource instance
 */
function resolveSource(source: BuiltInContextSource | ContextSource): ContextSource {
  if (typeof source === 'string') {
    return getBuiltInSource(source);
  }
  return source;
}

// =============================================================================
// CONTEXT BUILDER
// =============================================================================

/**
 * Context Builder Options
 */
export interface ContextBuilderOptions {
  /** Sources to fetch from */
  sources: (BuiltInContextSource | ContextSource)[];
  /** Agent focus configuration */
  focusConfig: AgentFocusConfig;
  /** Whether to fetch in parallel (default: true) */
  parallel?: boolean;
  /** Timeout per source in ms (default: 10000) */
  timeout?: number;
}

/**
 * Build aggregated context from multiple sources
 */
export async function buildContext(
  agentType: AgentType,
  options: ContextBuilderOptions
): Promise<AggregatedContext> {
  const { sources, focusConfig, parallel = true, timeout = 10000 } = options;

  // Resolve sources
  const resolvedSources = sources.map(resolveSource);

  // Fetch focus settings
  const focus = await getFocusSettings();

  // Fetch existing initiative titles for deduplication
  const existingTitles = await getCreatedHashes();

  // Fetch from all sources
  const sourceResults: Record<string, string> = {};

  if (parallel) {
    // Parallel fetch with timeout
    const promises = resolvedSources.map(async (source) => {
      try {
        const result = await Promise.race([
          source.fetch(agentType),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeout)
          ),
        ]);
        return { name: source.name, result };
      } catch (error) {
        logger.debug({ source: source.name, error }, 'Source fetch failed');
        return { name: source.name, result: `${source.label}: unavailable` };
      }
    });

    const results = await Promise.all(promises);
    for (const { name, result } of results) {
      sourceResults[name] = result;
    }
  } else {
    // Sequential fetch
    for (const source of resolvedSources) {
      try {
        sourceResults[source.name] = await source.fetch(agentType);
      } catch (error) {
        logger.debug({ source: source.name, error }, 'Source fetch failed');
        sourceResults[source.name] = `${source.label}: unavailable`;
      }
    }
  }

  return {
    sources: sourceResults,
    focus,
    agentFocus: focusConfig,
    existingTitles,
    timestamp: new Date(),
  };
}

// =============================================================================
// PROMPT FORMATTING
// =============================================================================

/**
 * Format aggregated context as prompt string
 */
export function formatContextAsPrompt(
  context: AggregatedContext,
  agentType: AgentType
): string {
  const parts: string[] = [];

  parts.push(`## 🧠 Strategic Context for ${agentType.toUpperCase()}`);
  parts.push('');
  parts.push('You MUST use `propose_initiative` action to create new initiatives based on this data.');
  parts.push('Analyze the market conditions, news, and project status to identify opportunities.');
  parts.push('');

  // Focus settings
  parts.push('### Focus Settings (Dashboard Controls)');
  parts.push(`- Revenue Priority: ${context.focus.revenueFocus}%`);
  parts.push(`- Community Growth: ${context.focus.communityGrowth}%`);
  parts.push(`- Marketing vs Dev: ${context.focus.marketingVsDev}% (higher = more marketing)`);
  parts.push(`- Risk Tolerance: ${context.focus.riskTolerance}%`);
  parts.push(`- Time Horizon: ${context.focus.timeHorizon}% (higher = longer term)`);
  parts.push('');
  parts.push('---');
  parts.push('');

  // Source data
  for (const [_name, data] of Object.entries(context.sources)) {
    if (data && data !== 'unavailable') {
      parts.push(data);
      parts.push('');
      parts.push('---');
      parts.push('');
    }
  }

  // Existing initiatives
  parts.push('### Existing Initiatives (avoid duplicates!)');
  parts.push(context.existingTitles.slice(0, 15).join(', ') || 'None');
  parts.push('');

  // Agent focus
  parts.push(`## Your Role: ${agentType.toUpperCase()}`);
  parts.push('');
  parts.push('### Key Questions to Consider');
  parts.push(context.agentFocus.keyQuestions.map((q) => `- ${q}`).join('\n'));
  parts.push('');
  parts.push('### Revenue Angles for Your Domain');
  parts.push(context.agentFocus.revenueAngles.map((r) => `- ${r}`).join('\n'));
  parts.push('');

  // Action required
  parts.push('---');
  parts.push('');
  parts.push('## ACTION REQUIRED');
  parts.push('');
  parts.push('Based on the data above, propose a NEW initiative using:');
  parts.push('```json');
  parts.push('{');
  parts.push('  "actions": [{');
  parts.push('    "type": "propose_initiative",');
  parts.push('    "data": {');
  parts.push('      "title": "Clear, actionable title",');
  parts.push('      "description": "What, why, expected outcome",');
  parts.push('      "rationale": "Why NOW based on current data?",');
  parts.push('      "priority": "high|medium|low",');
  parts.push('      "effort": 1-5,');
  parts.push('      "revenueImpact": 0-5,');
  parts.push('      "communityImpact": 0-5,');
  parts.push('      "tags": ["relevant", "tags"]');
  parts.push('    }');
  parts.push('  }]');
  parts.push('}');
  parts.push('```');
  parts.push('');
  parts.push('Think strategically. Use the market data and news to inform your proposal.');

  return parts.join('\n');
}

/**
 * Build initiative generation prompt with full context
 */
export async function buildInitiativePrompt(
  agentType: AgentType,
  options: ContextBuilderOptions
): Promise<string> {
  const context = await buildContext(agentType, options);

  // Add date context
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = days[now.getUTCDay()];
  const dateStr = now.toISOString().split('T')[0];

  const header = `# INITIATIVE GENERATION TASK

⚠️ **TODAY IS: ${dayName}, ${dateStr}** - Use this date for any time-sensitive planning!

You are the ${agentType.toUpperCase()} agent. Your ONLY task right now is to propose ONE new initiative.

`;

  return header + formatContextAsPrompt(context, agentType);
}
