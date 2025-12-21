/**
 * Focus-Based Scoring Strategy
 * TASK-037: Scoring based on dashboard focus settings
 *
 * This is the default strategy that uses FocusSettings from the dashboard
 * to prioritize initiatives based on user preferences.
 */

import type {
  Initiative,
  ScoringContext,
  ScoringStrategy,
  AgentType,
} from '../../types.js';

/**
 * Marketing agent types (favor marketing focus)
 */
const MARKETING_AGENTS: AgentType[] = ['cmo', 'coo'];

/**
 * Dev agent types (favor dev focus)
 */
const DEV_AGENTS: AgentType[] = ['cto', 'cfo'];

/**
 * Community-related tags that get community growth bonus
 */
const COMMUNITY_TAGS = ['community', 'growth', 'social', 'engagement', 'viral'];

/**
 * Risk-indicating tags
 */
const RISKY_TAGS = ['aggressive', 'experimental', 'speculative', 'high-risk'];

/**
 * Focus-based scoring strategy
 *
 * Scoring factors:
 * 1. Revenue impact * revenue focus weight
 * 2. Marketing vs Dev balance
 * 3. Community growth bonus
 * 4. Risk adjustment
 * 5. Time horizon adjustment
 * 6. Effort penalty
 */
export class FocusBasedStrategy<T = unknown> implements ScoringStrategy<T> {
  readonly name = 'focus-based';

  score(initiative: Initiative<T>, context: ScoringContext): number {
    const { focus, agentType } = context;
    let score = 0;

    // 1. Base score from revenue impact (0-10 * weight)
    score += initiative.revenueImpact * (focus.revenueFocus / 100) * 2;

    // 2. Adjust based on agent type and marketingVsDev slider
    const isMarketingAgent = MARKETING_AGENTS.includes(agentType);
    const isDevAgent = DEV_AGENTS.includes(agentType);

    if (isMarketingAgent) {
      score += (focus.marketingVsDev / 100) * 3;
    } else if (isDevAgent) {
      score += ((100 - focus.marketingVsDev) / 100) * 3;
    }

    // 3. Community growth bonus
    if (initiative.tags.some((t) => COMMUNITY_TAGS.includes(t.toLowerCase()))) {
      score += (focus.communityGrowth / 100) * 2;
    }

    // 4. Risk adjustment - risky initiatives get penalized at low risk tolerance
    const isRisky = initiative.tags.some((t) => RISKY_TAGS.includes(t.toLowerCase()));
    if (isRisky) {
      score *= focus.riskTolerance / 100;
    }

    // 5. Time horizon adjustment
    const isLongTerm = initiative.effort > 5;
    if (isLongTerm) {
      // Long-term initiatives favor high timeHorizon setting
      score *= focus.timeHorizon / 100;
    } else {
      // Quick wins get boost when timeHorizon is low
      score *= ((100 - focus.timeHorizon) / 100) + 0.5;
    }

    // 6. Subtract effort penalty
    score -= initiative.effort * 0.5;

    return Math.max(0, score);
  }

  duplicatePenalty(initiative: Initiative<T>, existing: Initiative<T>[]): number {
    // Check for similar titles in existing initiatives
    const normalizedTitle = this.normalizeTitle(initiative.title);

    for (const existingInit of existing) {
      const existingNormalized = this.normalizeTitle(existingInit.title);

      // Exact match = full penalty
      if (normalizedTitle === existingNormalized) {
        return 100;
      }

      // High similarity = partial penalty (compare original titles to preserve words)
      const similarity = this.calculateJaccardSimilarity(initiative.title, existingInit.title);
      if (similarity > 0.8) {
        return 50 * similarity;
      }
    }

    return 0;
  }

  private normalizeTitle(title: string): string {
    // Normalize for exact match comparison only
    return title.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private calculateJaccardSimilarity(a: string, b: string): number {
    // Extract lowercase words from original strings (preserves word boundaries)
    const wordsA = new Set((a.toLowerCase().match(/[a-z0-9]+/g) || []));
    const wordsB = new Set((b.toLowerCase().match(/[a-z0-9]+/g) || []));

    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }
}

/**
 * Create a focus-based strategy instance
 */
export function createFocusBasedStrategy<T = unknown>(): ScoringStrategy<T> {
  return new FocusBasedStrategy<T>();
}
