/**
 * CTO Provider
 * TASK-037: Technical initiative provider
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
 * CTO Provider Implementation
 */
export const ctoProvider: InitiativeProvider = {
  agentType: 'cto',

  getContextSources(): BuiltInContextSource[] {
    return ['rag', 'github', 'team-status'];
  },

  getScoringStrategy(): ScoringStrategy {
    return createFocusBasedStrategy();
  },

  getFocusConfig(): AgentFocusConfig {
    return AGENT_FOCUS_CONFIGS.cto;
  },

  getBootstrapInitiatives(): Initiative[] {
    return getBootstrapInitiatives('cto');
  },

  validateInitiative(initiative: Initiative): boolean {
    const techTags = ['technical', 'security', 'infrastructure', 'smart-contract', 'automation'];
    return (
      initiative.suggestedAssignee === 'cto' ||
      initiative.tags.some((tag) => techTags.includes(tag.toLowerCase()))
    );
  },

  getCooldownSeconds(): number {
    return 3600;
  },
};
