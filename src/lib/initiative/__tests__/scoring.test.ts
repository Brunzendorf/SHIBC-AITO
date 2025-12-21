/**
 * Tests for Scoring Engine and Strategies
 * TASK-037: Initiative scoring system
 */

import { describe, it, expect } from 'vitest';
import {
  scoreInitiatives,
  getTopInitiatives,
  applyDuplicatePenalties,
  createCompositeStrategy,
} from '../scoring/engine.js';
import {
  FocusBasedStrategy,
  createFocusBasedStrategy,
} from '../scoring/strategies/focus-based.js';
import {
  PriorityBasedStrategy,
  createPriorityBasedStrategy,
} from '../scoring/strategies/priority-based.js';
import type {
  Initiative,
  ScoringContext,
  FocusSettings,
} from '../types.js';
import { DEFAULT_FOCUS } from '../types.js';

// Test fixtures
function createTestInitiative(overrides: Partial<Initiative> = {}): Initiative {
  return {
    title: 'Test Initiative',
    description: 'Test description',
    priority: 'medium',
    revenueImpact: 5,
    effort: 5,
    suggestedAssignee: 'cmo',
    tags: ['test'],
    source: 'bootstrap',
    ...overrides,
  };
}

function createTestContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    focus: DEFAULT_FOCUS,
    agentType: 'cmo',
    ...overrides,
  };
}

describe('Scoring Engine', () => {
  describe('scoreInitiatives', () => {
    it('should score and sort initiatives by score descending', () => {
      const initiatives = [
        createTestInitiative({ title: 'Low', revenueImpact: 1 }),
        createTestInitiative({ title: 'High', revenueImpact: 10 }),
        createTestInitiative({ title: 'Medium', revenueImpact: 5 }),
      ];

      const strategy = createFocusBasedStrategy();
      const context = createTestContext();

      const result = scoreInitiatives(initiatives, strategy, context);

      expect(result[0].initiative.title).toBe('High');
      expect(result[1].initiative.title).toBe('Medium');
      expect(result[2].initiative.title).toBe('Low');
    });

    it('should return scores with each initiative', () => {
      const initiatives = [createTestInitiative()];
      const strategy = createFocusBasedStrategy();
      const context = createTestContext();

      const result = scoreInitiatives(initiatives, strategy, context);

      expect(result[0]).toHaveProperty('initiative');
      expect(result[0]).toHaveProperty('score');
      expect(typeof result[0].score).toBe('number');
    });
  });

  describe('getTopInitiatives', () => {
    it('should return top N initiatives', () => {
      const initiatives = [
        createTestInitiative({ title: '1', revenueImpact: 1 }),
        createTestInitiative({ title: '2', revenueImpact: 5 }),
        createTestInitiative({ title: '3', revenueImpact: 10 }),
        createTestInitiative({ title: '4', revenueImpact: 3 }),
      ];

      const strategy = createFocusBasedStrategy();
      const context = createTestContext();

      const result = getTopInitiatives(initiatives, strategy, context, 2);

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('3');
      expect(result[1].title).toBe('2');
    });

    it('should return all if limit exceeds count', () => {
      const initiatives = [
        createTestInitiative({ title: '1' }),
        createTestInitiative({ title: '2' }),
      ];

      const strategy = createFocusBasedStrategy();
      const context = createTestContext();

      const result = getTopInitiatives(initiatives, strategy, context, 10);

      expect(result).toHaveLength(2);
    });
  });

  describe('applyDuplicatePenalties', () => {
    it('should reduce score for similar initiatives', () => {
      const scoredInitiatives = [
        { initiative: createTestInitiative({ title: 'Twitter campaign' }), score: 10 },
      ];

      const existing = [
        createTestInitiative({ title: 'Twitter Campaign' }), // Similar
      ];

      const strategy = createFocusBasedStrategy();
      const result = applyDuplicatePenalties(scoredInitiatives, strategy, existing);

      expect(result[0].score).toBeLessThan(10);
    });

    it('should not penalize dissimilar initiatives', () => {
      const scoredInitiatives = [
        { initiative: createTestInitiative({ title: 'Twitter campaign' }), score: 10 },
      ];

      const existing = [
        createTestInitiative({ title: 'Discord community building' }),
      ];

      const strategy = createFocusBasedStrategy();
      const result = applyDuplicatePenalties(scoredInitiatives, strategy, existing);

      expect(result[0].score).toBe(10);
    });

    it('should handle strategies without duplicatePenalty', () => {
      const scoredInitiatives = [
        { initiative: createTestInitiative(), score: 10 },
      ];

      const strategyWithoutDuplicatePenalty = {
        name: 'no-dedup',
        score: () => 10,
      };

      const result = applyDuplicatePenalties(
        scoredInitiatives,
        strategyWithoutDuplicatePenalty,
        [createTestInitiative()]
      );

      expect(result[0].score).toBe(10);
    });
  });

  describe('createCompositeStrategy', () => {
    it('should combine multiple strategies with weights', () => {
      const strategy1 = { name: 's1', score: () => 10 };
      const strategy2 = { name: 's2', score: () => 0 };

      const composite = createCompositeStrategy([
        { strategy: strategy1, weight: 1 },
        { strategy: strategy2, weight: 1 },
      ]);

      expect(composite.name).toBe('composite(s1+s2)');

      const score = composite.score(createTestInitiative(), createTestContext());
      expect(score).toBe(5); // Average of 10 and 0
    });

    it('should apply weights correctly', () => {
      const strategy1 = { name: 's1', score: () => 10 };
      const strategy2 = { name: 's2', score: () => 0 };

      const composite = createCompositeStrategy([
        { strategy: strategy1, weight: 3 },
        { strategy: strategy2, weight: 1 },
      ]);

      const score = composite.score(createTestInitiative(), createTestContext());
      expect(score).toBe(7.5); // (10*3 + 0*1) / 4 = 7.5
    });
  });
});

describe('FocusBasedStrategy', () => {
  describe('score', () => {
    it('should score higher for high revenue impact', () => {
      const strategy = new FocusBasedStrategy();
      const context = createTestContext({ focus: { ...DEFAULT_FOCUS, revenueFocus: 100 } });

      const lowRevenue = createTestInitiative({ revenueImpact: 1, effort: 1 });
      const highRevenue = createTestInitiative({ revenueImpact: 10, effort: 1 });

      expect(strategy.score(highRevenue, context)).toBeGreaterThan(
        strategy.score(lowRevenue, context)
      );
    });

    it('should favor marketing agents when marketingVsDev is high', () => {
      const strategy = new FocusBasedStrategy();
      const marketingFocus: FocusSettings = {
        ...DEFAULT_FOCUS,
        marketingVsDev: 100,
      };

      const cmoContext = createTestContext({ focus: marketingFocus, agentType: 'cmo' });
      const ctoContext = createTestContext({ focus: marketingFocus, agentType: 'cto' });

      const init = createTestInitiative();

      expect(strategy.score(init, cmoContext)).toBeGreaterThan(
        strategy.score(init, ctoContext)
      );
    });

    it('should favor dev agents when marketingVsDev is low', () => {
      const strategy = new FocusBasedStrategy();
      const devFocus: FocusSettings = {
        ...DEFAULT_FOCUS,
        marketingVsDev: 0,
      };

      const cmoContext = createTestContext({ focus: devFocus, agentType: 'cmo' });
      const ctoContext = createTestContext({ focus: devFocus, agentType: 'cto' });

      const init = createTestInitiative();

      expect(strategy.score(init, ctoContext)).toBeGreaterThan(
        strategy.score(init, cmoContext)
      );
    });

    it('should add community growth bonus for community tags', () => {
      const strategy = new FocusBasedStrategy();
      const highCommunity: FocusSettings = {
        ...DEFAULT_FOCUS,
        communityGrowth: 100,
      };
      const context = createTestContext({ focus: highCommunity });

      const communityInit = createTestInitiative({ tags: ['community', 'growth'] });
      const regularInit = createTestInitiative({ tags: ['technical'] });

      expect(strategy.score(communityInit, context)).toBeGreaterThan(
        strategy.score(regularInit, context)
      );
    });

    it('should penalize risky initiatives at low risk tolerance', () => {
      const strategy = new FocusBasedStrategy();
      const lowRisk: FocusSettings = {
        ...DEFAULT_FOCUS,
        riskTolerance: 10,
      };
      const context = createTestContext({ focus: lowRisk });

      const riskyInit = createTestInitiative({ tags: ['aggressive', 'experimental'] });
      const safeInit = createTestInitiative({ tags: ['conservative'] });

      expect(strategy.score(safeInit, context)).toBeGreaterThan(
        strategy.score(riskyInit, context)
      );
    });

    it('should favor quick wins at low time horizon', () => {
      const strategy = new FocusBasedStrategy();
      const shortTerm: FocusSettings = {
        ...DEFAULT_FOCUS,
        timeHorizon: 10,
      };
      const context = createTestContext({ focus: shortTerm });

      const quickWin = createTestInitiative({ effort: 2 });
      const longTerm = createTestInitiative({ effort: 8 });

      expect(strategy.score(quickWin, context)).toBeGreaterThan(
        strategy.score(longTerm, context)
      );
    });

    it('should subtract effort penalty', () => {
      const strategy = new FocusBasedStrategy();
      const context = createTestContext();

      const lowEffort = createTestInitiative({ effort: 1, revenueImpact: 5 });
      const highEffort = createTestInitiative({ effort: 10, revenueImpact: 5 });

      expect(strategy.score(lowEffort, context)).toBeGreaterThan(
        strategy.score(highEffort, context)
      );
    });

    it('should never return negative scores', () => {
      const strategy = new FocusBasedStrategy();
      const context = createTestContext();

      const worstCase = createTestInitiative({
        revenueImpact: 0,
        effort: 10,
        priority: 'low',
      });

      expect(strategy.score(worstCase, context)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('duplicatePenalty', () => {
    it('should return high penalty for exact match', () => {
      const strategy = new FocusBasedStrategy();
      const initiative = createTestInitiative({ title: 'Twitter Campaign' });
      const existing = [createTestInitiative({ title: 'Twitter Campaign' })];

      const penalty = strategy.duplicatePenalty!(initiative, existing);

      expect(penalty).toBe(100);
    });

    it('should return partial penalty for highly similar titles (>80% Jaccard)', () => {
      const strategy = new FocusBasedStrategy();

      // Use exact same words with one extra: 5/6 = 0.833 > 0.8
      const initiative = createTestInitiative({
        title: 'Activate Twitter Marketing Campaign Today Now',
      });
      const existing = [createTestInitiative({
        title: 'Activate Twitter Marketing Campaign Today',
      })];

      const penalty = strategy.duplicatePenalty!(initiative, existing);

      expect(penalty).toBeGreaterThan(0);
      expect(penalty).toBeLessThan(100);
    });

    it('should return zero penalty for dissimilar titles', () => {
      const strategy = new FocusBasedStrategy();
      const initiative = createTestInitiative({ title: 'Twitter Campaign' });
      const existing = [createTestInitiative({ title: 'Discord Integration' })];

      const penalty = strategy.duplicatePenalty!(initiative, existing);

      expect(penalty).toBe(0);
    });
  });
});

describe('PriorityBasedStrategy', () => {
  describe('score', () => {
    it('should score highest for critical priority', () => {
      const strategy = new PriorityBasedStrategy();
      const context = createTestContext();

      const scores = {
        critical: strategy.score(createTestInitiative({ priority: 'critical' }), context),
        high: strategy.score(createTestInitiative({ priority: 'high' }), context),
        medium: strategy.score(createTestInitiative({ priority: 'medium' }), context),
        low: strategy.score(createTestInitiative({ priority: 'low' }), context),
      };

      expect(scores.critical).toBeGreaterThan(scores.high);
      expect(scores.high).toBeGreaterThan(scores.medium);
      expect(scores.medium).toBeGreaterThan(scores.low);
    });

    it('should add revenue impact bonus', () => {
      const strategy = new PriorityBasedStrategy();
      const context = createTestContext();

      const highRevenue = createTestInitiative({ priority: 'medium', revenueImpact: 10 });
      const lowRevenue = createTestInitiative({ priority: 'medium', revenueImpact: 1 });

      expect(strategy.score(highRevenue, context)).toBeGreaterThan(
        strategy.score(lowRevenue, context)
      );
    });

    it('should favor low effort initiatives', () => {
      const strategy = new PriorityBasedStrategy();
      const context = createTestContext();

      const lowEffort = createTestInitiative({ priority: 'medium', effort: 1 });
      const highEffort = createTestInitiative({ priority: 'medium', effort: 10 });

      expect(strategy.score(lowEffort, context)).toBeGreaterThan(
        strategy.score(highEffort, context)
      );
    });

    it('should return non-negative scores', () => {
      const strategy = new PriorityBasedStrategy();
      const context = createTestContext();

      const worstCase = createTestInitiative({
        priority: 'low',
        revenueImpact: 0,
        effort: 10,
      });

      expect(strategy.score(worstCase, context)).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('createFocusBasedStrategy', () => {
  it('should create FocusBasedStrategy instance', () => {
    const strategy = createFocusBasedStrategy();

    expect(strategy.name).toBe('focus-based');
    expect(typeof strategy.score).toBe('function');
  });
});

describe('createPriorityBasedStrategy', () => {
  it('should create PriorityBasedStrategy instance', () => {
    const strategy = createPriorityBasedStrategy();

    expect(strategy.name).toBe('priority-based');
    expect(typeof strategy.score).toBe('function');
  });
});
