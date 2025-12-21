/**
 * CCO Provider
 * TASK-037: Compliance initiative provider
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
 * CCO Provider Implementation
 */
export const ccoProvider: InitiativeProvider = {
  agentType: 'cco',

  getContextSources(): BuiltInContextSource[] {
    return ['rag', 'github'];
  },

  getScoringStrategy(): ScoringStrategy {
    return createFocusBasedStrategy();
  },

  getFocusConfig(): AgentFocusConfig {
    return AGENT_FOCUS_CONFIGS.cco;
  },

  getBootstrapInitiatives(): Initiative[] {
    return getBootstrapInitiatives('cco');
  },

  validateInitiative(initiative: Initiative): boolean {
    const complianceTags = ['compliance', 'legal', 'regulation', 'risk', 'audit'];
    return (
      initiative.suggestedAssignee === 'cco' ||
      initiative.tags.some((tag) => complianceTags.includes(tag.toLowerCase()))
    );
  },

  getCooldownSeconds(): number {
    return 7200; // 2 hours - compliance needs careful consideration
  },
};
