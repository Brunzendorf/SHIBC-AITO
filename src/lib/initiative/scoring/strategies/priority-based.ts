/**
 * Priority-Based Scoring Strategy
 * TASK-037: Simple scoring based on priority and effort
 *
 * This is a straightforward strategy that primarily uses
 * the initiative's priority level for scoring.
 */

import type {
  Initiative,
  Priority,
  ScoringContext,
  ScoringStrategy,
} from '../../types.js';

/**
 * Priority weights
 */
const PRIORITY_SCORES: Record<Priority, number> = {
  critical: 10,
  high: 7,
  medium: 4,
  low: 1,
};

/**
 * Priority-based scoring strategy
 *
 * Simple scoring:
 * 1. Priority level (critical=10, high=7, medium=4, low=1)
 * 2. Revenue impact bonus
 * 3. Effort penalty (lower effort = better)
 */
export class PriorityBasedStrategy<T = unknown> implements ScoringStrategy<T> {
  readonly name = 'priority-based';

  score(initiative: Initiative<T>, _context: ScoringContext): number {
    let score = 0;

    // 1. Base score from priority
    score += PRIORITY_SCORES[initiative.priority] || 0;

    // 2. Revenue impact bonus (0-10 scaled to 0-5)
    score += initiative.revenueImpact * 0.5;

    // 3. Effort penalty (lower effort = higher score)
    // Invert effort: 10-effort gives 0-9 bonus for low effort
    score += (10 - initiative.effort) * 0.3;

    return Math.max(0, score);
  }
}

/**
 * Create a priority-based strategy instance
 */
export function createPriorityBasedStrategy<T = unknown>(): ScoringStrategy<T> {
  return new PriorityBasedStrategy<T>();
}
