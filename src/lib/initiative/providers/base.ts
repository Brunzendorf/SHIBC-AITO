/**
 * Base Provider Configuration
 * TASK-037: Shared configuration for all agent providers
 */

import type {
  AgentType,
  Initiative,
  InitiativeProvider,
  AgentFocusConfig,
  ScoringStrategy,
  BuiltInContextSource,
} from '../types.js';
import { createFocusBasedStrategy } from '../scoring/index.js';

// =============================================================================
// AGENT FOCUS CONFIGURATIONS
// =============================================================================

/**
 * Domain-specific focus areas for each agent type
 */
export const AGENT_FOCUS_CONFIGS: Record<AgentType, AgentFocusConfig> = {
  ceo: {
    keyQuestions: [
      'What is blocking our launch?',
      'Which partnerships could accelerate growth?',
      'Are all agents productive?',
    ],
    revenueAngles: [
      'Strategic partnerships',
      'Investor relations',
      'Token launch timing',
    ],
    scanTopics: ['roadmap', 'team status', 'blockers', 'strategy'],
  },
  cmo: {
    keyQuestions: [
      'How can we grow Twitter/X followers?',
      'What content would go viral?',
      'Which influencers should we approach?',
    ],
    revenueAngles: [
      'Viral marketing campaigns',
      'Community growth → token demand',
      'Influencer partnerships',
    ],
    scanTopics: ['crypto trends', 'meme marketing', 'community growth'],
  },
  cfo: {
    keyQuestions: [
      'What funding sources are available?',
      'How do we optimize treasury?',
      'What are gas-efficient strategies?',
    ],
    revenueAngles: [
      'Grants and funding',
      'Treasury yield strategies',
      'Cost optimization',
    ],
    scanTopics: ['defi yields', 'grants', 'treasury management'],
  },
  cto: {
    keyQuestions: [
      'Are there security vulnerabilities?',
      'What technical debt needs addressing?',
      'Which tools would improve efficiency?',
    ],
    revenueAngles: [
      'Automation saves costs',
      'Security prevents losses',
      'Better tools = faster delivery',
    ],
    scanTopics: ['smart contracts', 'security', 'infrastructure'],
  },
  coo: {
    keyQuestions: [
      'What processes are inefficient?',
      'Which partnerships need follow-up?',
      'How is team coordination?',
    ],
    revenueAngles: [
      'Process efficiency',
      'Partnership revenue',
      'Resource optimization',
    ],
    scanTopics: ['operations', 'partnerships', 'efficiency'],
  },
  cco: {
    keyQuestions: [
      'Are we compliant with regulations?',
      'What legal risks exist?',
      'Do we need legal counsel?',
    ],
    revenueAngles: [
      'Compliance prevents fines',
      'Legal clarity enables growth',
      'Risk management',
    ],
    scanTopics: ['crypto regulations', 'compliance', 'legal'],
  },
  dao: {
    keyQuestions: [
      'What governance decisions are pending?',
      'Is voting participation healthy?',
      'Are treasury allocations optimal?',
    ],
    revenueAngles: [
      'Governance efficiency',
      'Community trust → token value',
      'Treasury optimization',
    ],
    scanTopics: ['governance', 'voting', 'dao management'],
  },
  test: {
    keyQuestions: [
      'Are all system integrations working?',
      'Which tests need to be run?',
      'Are there any failures to investigate?',
    ],
    revenueAngles: [],
    scanTopics: ['testing', 'validation', 'integration'],
  },
};

// =============================================================================
// BOOTSTRAP INITIATIVES
// =============================================================================

/**
 * Pre-defined bootstrap initiatives for agents
 */
export const BOOTSTRAP_INITIATIVES: Initiative[] = [
  {
    title: 'Activate X/Twitter for organic reach',
    description:
      'Twitter is the primary channel for crypto marketing. Need to post regularly, engage with community, build follower base. Target: 1000 followers in first month.',
    priority: 'critical',
    revenueImpact: 9,
    effort: 2,
    suggestedAssignee: 'cmo',
    tags: ['marketing', 'social', 'growth'],
    source: 'bootstrap',
  },
  {
    title: 'Apply for CoinGecko listing',
    description:
      'CoinGecko listing provides legitimacy and visibility. Free to apply, high impact. Submit token details, contract address, social links.',
    priority: 'high',
    revenueImpact: 8,
    effort: 3,
    suggestedAssignee: 'cmo',
    tags: ['listing', 'visibility', 'growth'],
    source: 'bootstrap',
  },
  {
    title: 'Apply for CoinMarketCap listing',
    description:
      'CMC is the most visited crypto data site. Listing drives organic traffic and trading volume.',
    priority: 'high',
    revenueImpact: 8,
    effort: 3,
    suggestedAssignee: 'cmo',
    tags: ['listing', 'visibility', 'growth'],
    source: 'bootstrap',
  },
  {
    title: 'Research and apply for crypto grants',
    description:
      'Many foundations offer grants: Ethereum Foundation, Gitcoin, Optimism RPGF, etc. Research eligibility and apply.',
    priority: 'high',
    revenueImpact: 10,
    effort: 5,
    suggestedAssignee: 'cfo',
    tags: ['funding', 'grants', 'revenue'],
    source: 'bootstrap',
  },
  {
    title: 'Define token utility features',
    description:
      'Pure meme tokens struggle. Define utility: staking, governance, access to features. Increases token value proposition.',
    priority: 'medium',
    revenueImpact: 7,
    effort: 5,
    suggestedAssignee: 'cto',
    tags: ['tokenomics', 'utility', 'product'],
    source: 'bootstrap',
  },
  {
    title: 'Launch community meme contest',
    description:
      'User-generated content drives engagement. Prize pool from treasury. Winners get tokens + recognition.',
    priority: 'medium',
    revenueImpact: 6,
    effort: 3,
    suggestedAssignee: 'cmo',
    tags: ['community', 'engagement', 'marketing'],
    source: 'bootstrap',
  },
  {
    title: 'Create ambassador program',
    description:
      'Recruit community members as ambassadors. Provide incentives for promotion, content creation, community moderation.',
    priority: 'medium',
    revenueImpact: 7,
    effort: 4,
    suggestedAssignee: 'coo',
    tags: ['community', 'growth', 'partnerships'],
    source: 'bootstrap',
  },
  {
    title: 'Security audit preparation',
    description:
      'Prepare documentation for security audit. Clean up contracts, document functions, prepare test suite.',
    priority: 'high',
    revenueImpact: 5,
    effort: 6,
    suggestedAssignee: 'cto',
    tags: ['security', 'audit', 'trust'],
    source: 'bootstrap',
  },
];

/**
 * Get bootstrap initiatives for a specific agent type
 */
export function getBootstrapInitiatives(agentType: AgentType): Initiative[] {
  return BOOTSTRAP_INITIATIVES.filter((i) => i.suggestedAssignee === agentType);
}

// =============================================================================
// BASE PROVIDER
// =============================================================================

/**
 * Default context sources for all agents
 */
export const DEFAULT_CONTEXT_SOURCES: BuiltInContextSource[] = [
  'rag',
  'github',
  'team-status',
  'market-data',
];

/**
 * Create a base provider for an agent type
 */
export function createBaseProvider(agentType: AgentType): InitiativeProvider {
  return {
    agentType,

    getContextSources() {
      return DEFAULT_CONTEXT_SOURCES;
    },

    getScoringStrategy(): ScoringStrategy {
      return createFocusBasedStrategy();
    },

    getFocusConfig(): AgentFocusConfig {
      return AGENT_FOCUS_CONFIGS[agentType];
    },

    getBootstrapInitiatives(): Initiative[] {
      return getBootstrapInitiatives(agentType);
    },

    getCooldownSeconds(): number {
      return 3600; // 1 hour default
    },
  };
}
