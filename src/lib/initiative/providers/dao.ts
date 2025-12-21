/**
 * DAO Provider
 * TASK-037: Governance initiative provider
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
 * DAO Provider Implementation
 */
export const daoProvider: InitiativeProvider = {
  agentType: 'dao',

  getContextSources(): BuiltInContextSource[] {
    return ['rag', 'github', 'team-status'];
  },

  getScoringStrategy(): ScoringStrategy {
    return createFocusBasedStrategy();
  },

  getFocusConfig(): AgentFocusConfig {
    return AGENT_FOCUS_CONFIGS.dao;
  },

  getBootstrapInitiatives(): Initiative[] {
    return getBootstrapInitiatives('dao');
  },

  validateInitiative(initiative: Initiative): boolean {
    const govTags = ['governance', 'voting', 'proposal', 'dao', 'treasury', 'community'];
    return (
      initiative.suggestedAssignee === 'dao' ||
      initiative.tags.some((tag) => govTags.includes(tag.toLowerCase()))
    );
  },

  getCooldownSeconds(): number {
    return 3600;
  },
};
