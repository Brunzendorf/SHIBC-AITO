/**
 * Tests for Initiative Types
 * TASK-037: Type definitions and constants
 */

import { describe, it, expect } from 'vitest';
import {
  STATUS_LABELS,
  DEFAULT_FOCUS,
  type Initiative,
  type InitiativeProvider,
  type ScoringStrategy,
  type ContextSource,
  type FocusSettings,
  type AgentType,
  type Priority,
  type IssueStatus,
} from '../types.js';

describe('STATUS_LABELS', () => {
  it('should have all required statuses', () => {
    expect(STATUS_LABELS).toHaveProperty('BACKLOG');
    expect(STATUS_LABELS).toHaveProperty('READY');
    expect(STATUS_LABELS).toHaveProperty('IN_PROGRESS');
    expect(STATUS_LABELS).toHaveProperty('REVIEW');
    expect(STATUS_LABELS).toHaveProperty('DONE');
    expect(STATUS_LABELS).toHaveProperty('BLOCKED');
  });

  it('should use consistent label format', () => {
    Object.values(STATUS_LABELS).forEach((label) => {
      expect(label).toMatch(/^status:/);
    });
  });

  it('should have unique labels', () => {
    const labels = Object.values(STATUS_LABELS);
    const uniqueLabels = new Set(labels);

    expect(uniqueLabels.size).toBe(labels.length);
  });
});

describe('DEFAULT_FOCUS', () => {
  it('should have all required settings', () => {
    expect(DEFAULT_FOCUS).toHaveProperty('revenueFocus');
    expect(DEFAULT_FOCUS).toHaveProperty('communityGrowth');
    expect(DEFAULT_FOCUS).toHaveProperty('marketingVsDev');
    expect(DEFAULT_FOCUS).toHaveProperty('riskTolerance');
    expect(DEFAULT_FOCUS).toHaveProperty('timeHorizon');
  });

  it('should have values between 0 and 100', () => {
    Object.values(DEFAULT_FOCUS).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    });
  });

  it('should be immutable-friendly (object)', () => {
    expect(typeof DEFAULT_FOCUS).toBe('object');
    expect(DEFAULT_FOCUS).not.toBeNull();
  });
});

describe('Type Definitions', () => {
  describe('Initiative', () => {
    it('should accept valid initiative object', () => {
      const initiative: Initiative = {
        title: 'Test',
        description: 'Test description',
        priority: 'high',
        revenueImpact: 5,
        effort: 3,
        suggestedAssignee: 'cmo',
        tags: ['test'],
        source: 'bootstrap',
      };

      expect(initiative.title).toBe('Test');
      expect(initiative.priority).toBe('high');
    });

    it('should support generic payload', () => {
      interface CustomPayload {
        customField: string;
      }

      const initiative: Initiative<CustomPayload> = {
        title: 'Test',
        description: 'Test',
        priority: 'medium',
        revenueImpact: 5,
        effort: 5,
        suggestedAssignee: 'ceo',
        tags: [],
        source: 'agent-proposed',
        payload: { customField: 'value' },
      };

      expect(initiative.payload?.customField).toBe('value');
    });
  });

  describe('AgentType', () => {
    it('should include all valid agent types', () => {
      const agentTypes: AgentType[] = ['ceo', 'cmo', 'cto', 'cfo', 'coo', 'cco', 'dao'];

      expect(agentTypes).toHaveLength(7);
    });
  });

  describe('Priority', () => {
    it('should include all valid priorities', () => {
      const priorities: Priority[] = ['critical', 'high', 'medium', 'low'];

      expect(priorities).toHaveLength(4);
    });
  });

  describe('IssueStatus', () => {
    it('should match STATUS_LABELS keys', () => {
      const statuses: IssueStatus[] = ['BACKLOG', 'READY', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED'];

      statuses.forEach((status) => {
        expect(STATUS_LABELS).toHaveProperty(status);
      });
    });
  });

  describe('FocusSettings', () => {
    it('should allow partial overrides', () => {
      const custom: FocusSettings = {
        ...DEFAULT_FOCUS,
        revenueFocus: 100,
      };

      expect(custom.revenueFocus).toBe(100);
      expect(custom.communityGrowth).toBe(DEFAULT_FOCUS.communityGrowth);
    });
  });

  describe('InitiativeProvider interface', () => {
    it('should require core methods', () => {
      // This is a compile-time check - if it compiles, the interface is correct
      const provider: InitiativeProvider = {
        agentType: 'cmo',
        getContextSources: () => ['rag'],
        getScoringStrategy: () => ({
          name: 'test',
          score: () => 0,
        }),
        getFocusConfig: () => ({
          keyQuestions: [],
          revenueAngles: [],
          scanTopics: [],
        }),
      };

      expect(provider.agentType).toBe('cmo');
    });
  });

  describe('ScoringStrategy interface', () => {
    it('should require name and score method', () => {
      const strategy: ScoringStrategy = {
        name: 'test-strategy',
        score: (initiative, context) => {
          return initiative.revenueImpact * (context.focus.revenueFocus / 100);
        },
      };

      expect(strategy.name).toBe('test-strategy');
    });

    it('should allow optional duplicatePenalty', () => {
      const strategy: ScoringStrategy = {
        name: 'test',
        score: () => 5,
        duplicatePenalty: (_initiative, existing) => {
          return existing.length > 0 ? 10 : 0;
        },
      };

      expect(strategy.duplicatePenalty).toBeDefined();
    });
  });

  describe('ContextSource interface', () => {
    it('should require name, label, and fetch', () => {
      const source: ContextSource = {
        name: 'test-source',
        label: 'Test Source',
        fetch: async () => 'Test data',
      };

      expect(source.name).toBe('test-source');
      expect(source.label).toBe('Test Source');
    });

    it('should allow optional isAvailable and cacheTTL', () => {
      const source: ContextSource = {
        name: 'cached-source',
        label: 'Cached Source',
        fetch: async () => 'Data',
        isAvailable: async () => true,
        cacheTTL: 300,
      };

      expect(source.cacheTTL).toBe(300);
    });
  });
});

describe('Type Compatibility', () => {
  it('should allow creating initiative from proposal', () => {
    const proposal = {
      title: 'Test',
      description: 'Test',
      priority: 'high',
      revenueImpact: 5,
      effort: 3,
      tags: ['test'],
    };

    const initiative: Initiative = {
      ...proposal,
      priority: proposal.priority as Priority,
      suggestedAssignee: 'cmo',
      source: 'agent-proposed',
    };

    expect(initiative.source).toBe('agent-proposed');
  });

  it('should support all initiative sources', () => {
    const sources: Initiative['source'][] = [
      'bootstrap',
      'agent-proposed',
      'human-requested',
      'system-detected',
      'cross-agent',
    ];

    expect(sources).toHaveLength(5);
  });
});
