/**
 * CFO Provider
 * TASK-037: Financial initiative provider
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
 * CFO Provider Implementation
 */
export const cfoProvider: InitiativeProvider = {
  agentType: 'cfo',

  getContextSources(): BuiltInContextSource[] {
    return ['rag', 'github', 'market-data'];
  },

  getScoringStrategy(): ScoringStrategy {
    return createFocusBasedStrategy();
  },

  getFocusConfig(): AgentFocusConfig {
    return AGENT_FOCUS_CONFIGS.cfo;
  },

  getBootstrapInitiatives(): Initiative[] {
    return getBootstrapInitiatives('cfo');
  },

  validateInitiative(initiative: Initiative): boolean {
    const financeTags = ['funding', 'grants', 'treasury', 'revenue', 'cost', 'budget'];
    return (
      initiative.suggestedAssignee === 'cfo' ||
      initiative.tags.some((tag) => financeTags.includes(tag.toLowerCase()))
    );
  },

  getCooldownSeconds(): number {
    return 3600;
  },
};
