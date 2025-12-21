/**
 * CEO Provider
 * TASK-037: Strategic leadership initiative provider
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
 * CEO Provider Implementation
 */
export const ceoProvider: InitiativeProvider = {
  agentType: 'ceo',

  getContextSources(): BuiltInContextSource[] {
    return ['rag', 'github', 'team-status', 'market-data'];
  },

  getScoringStrategy(): ScoringStrategy {
    return createFocusBasedStrategy();
  },

  getFocusConfig(): AgentFocusConfig {
    return AGENT_FOCUS_CONFIGS.ceo;
  },

  getBootstrapInitiatives(): Initiative[] {
    return getBootstrapInitiatives('ceo');
  },

  validateInitiative(initiative: Initiative): boolean {
    // CEO can approve any strategic initiative
    const strategicTags = ['strategy', 'partnership', 'launch', 'roadmap', 'vision'];
    return (
      initiative.suggestedAssignee === 'ceo' ||
      initiative.tags.some((tag) => strategicTags.includes(tag.toLowerCase()))
    );
  },

  getCooldownSeconds(): number {
    return 7200; // 2 hours - CEO thinks strategically
  },
};
