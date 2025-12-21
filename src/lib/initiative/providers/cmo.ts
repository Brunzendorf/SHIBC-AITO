/**
 * CMO Provider
 * TASK-037: Marketing-focused initiative provider
 */

import type {
  InitiativeProvider,
  Initiative,
  AgentFocusConfig,
  ScoringStrategy,
  BuiltInContextSource,
} from '../types.js';
import { createFocusBasedStrategy } from '../scoring/index.js';
import { AGENT_FOCUS_CONFIGS, getBootstrapInitiatives } from './base.js';

/**
 * CMO-specific context sources
 */
const CMO_CONTEXT_SOURCES: BuiltInContextSource[] = [
  'rag',
  'github',
  'team-status',
  'market-data',
];

/**
 * CMO Provider Implementation
 */
export const cmoProvider: InitiativeProvider = {
  agentType: 'cmo',

  getContextSources() {
    return CMO_CONTEXT_SOURCES;
  },

  getScoringStrategy(): ScoringStrategy {
    return createFocusBasedStrategy();
  },

  getFocusConfig(): AgentFocusConfig {
    return AGENT_FOCUS_CONFIGS.cmo;
  },

  getBootstrapInitiatives(): Initiative[] {
    return getBootstrapInitiatives('cmo');
  },

  validateInitiative(initiative: Initiative): boolean {
    // CMO should focus on marketing-related initiatives
    const marketingTags = ['marketing', 'social', 'community', 'growth', 'viral', 'influencer'];
    const hasMarketingTag = initiative.tags.some((tag) =>
      marketingTags.includes(tag.toLowerCase())
    );

    // Allow if has marketing tag or is assigned to CMO
    return hasMarketingTag || initiative.suggestedAssignee === 'cmo';
  },

  getCooldownSeconds(): number {
    return 3600; // 1 hour
  },
};
