/**
 * Scoring Engine
 * TASK-037: Central scoring engine that applies strategies
 */

import type {
  Initiative,
  ScoringContext,
  ScoringStrategy,
} from '../types.js';

/**
 * Score and rank initiatives using a strategy
 */
export function scoreInitiatives<T = unknown>(
  initiatives: Initiative<T>[],
  strategy: ScoringStrategy<T>,
  context: ScoringContext
): Array<{ initiative: Initiative<T>; score: number }> {
  return initiatives
    .map((initiative) => ({
      initiative,
      score: strategy.score(initiative, context),
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Get top N initiatives after scoring
 */
export function getTopInitiatives<T = unknown>(
  initiatives: Initiative<T>[],
  strategy: ScoringStrategy<T>,
  context: ScoringContext,
  limit: number
): Initiative<T>[] {
  return scoreInitiatives(initiatives, strategy, context)
    .slice(0, limit)
    .map((item) => item.initiative);
}

/**
 * Apply duplicate penalties to scored initiatives
 */
export function applyDuplicatePenalties<T = unknown>(
  scoredInitiatives: Array<{ initiative: Initiative<T>; score: number }>,
  strategy: ScoringStrategy<T>,
  existingInitiatives: Initiative<T>[]
): Array<{ initiative: Initiative<T>; score: number }> {
  if (!strategy.duplicatePenalty || existingInitiatives.length === 0) {
    return scoredInitiatives;
  }

  return scoredInitiatives.map(({ initiative, score }) => {
    const penalty = strategy.duplicatePenalty!(initiative, existingInitiatives);
    return {
      initiative,
      score: Math.max(0, score - penalty),
    };
  });
}

/**
 * Composite scoring: combine multiple strategies with weights
 */
export function createCompositeStrategy<T = unknown>(
  strategies: Array<{ strategy: ScoringStrategy<T>; weight: number }>
): ScoringStrategy<T> {
  const totalWeight = strategies.reduce((sum, s) => sum + s.weight, 0);

  return {
    name: `composite(${strategies.map((s) => s.strategy.name).join('+')})`,

    score(initiative: Initiative<T>, context: ScoringContext): number {
      let totalScore = 0;

      for (const { strategy, weight } of strategies) {
        const score = strategy.score(initiative, context);
        totalScore += score * (weight / totalWeight);
      }

      return totalScore;
    },

    duplicatePenalty(initiative: Initiative<T>, existing: Initiative<T>[]): number {
      let maxPenalty = 0;

      for (const { strategy, weight } of strategies) {
        if (strategy.duplicatePenalty) {
          const penalty = strategy.duplicatePenalty(initiative, existing);
          maxPenalty = Math.max(maxPenalty, penalty * (weight / totalWeight));
        }
      }

      return maxPenalty;
    },
  };
}
