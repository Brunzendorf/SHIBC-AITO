/**
 * COO Provider
 * TASK-037: Operations initiative provider
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
 * COO Provider Implementation
 */
export const cooProvider: InitiativeProvider = {
  agentType: 'coo',

  getContextSources(): BuiltInContextSource[] {
    return ['rag', 'github', 'team-status'];
  },

  getScoringStrategy(): ScoringStrategy {
    return createFocusBasedStrategy();
  },

  getFocusConfig(): AgentFocusConfig {
    return AGENT_FOCUS_CONFIGS.coo;
  },

  getBootstrapInitiatives(): Initiative[] {
    return getBootstrapInitiatives('coo');
  },

  validateInitiative(initiative: Initiative): boolean {
    const opsTags = ['operations', 'partnership', 'efficiency', 'process', 'coordination'];
    return (
      initiative.suggestedAssignee === 'coo' ||
      initiative.tags.some((tag) => opsTags.includes(tag.toLowerCase()))
    );
  },

  getCooldownSeconds(): number {
    return 3600;
  },
};
