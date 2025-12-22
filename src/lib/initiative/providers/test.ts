/**
 * Test Provider
 * Simple provider for test agent - minimal implementation for E2E testing
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
 * Test Provider Implementation
 * The test agent doesn't generate autonomous initiatives - it only runs tests
 */
export const testProvider: InitiativeProvider = {
  agentType: 'test',

  getContextSources(): BuiltInContextSource[] {
    // Test agent doesn't need external context
    return [];
  },

  getScoringStrategy(): ScoringStrategy {
    // Use standard focus-based strategy
    return createFocusBasedStrategy();
  },

  getFocusConfig(): AgentFocusConfig {
    return AGENT_FOCUS_CONFIGS.test;
  },

  getBootstrapInitiatives(): Initiative[] {
    // Test agent doesn't have bootstrap initiatives
    return getBootstrapInitiatives('test');
  },

  validateInitiative(initiative: Initiative): boolean {
    // Test agent accepts any test-related initiative
    const testTags = ['test', 'testing', 'validation', 'qa', 'quality'];
    return (
      initiative.suggestedAssignee === 'test' ||
      initiative.tags.some((tag) => testTags.includes(tag.toLowerCase()))
    );
  },

  getCooldownSeconds(): number {
    return 60; // 1 minute - test agent runs frequently
  },
};
