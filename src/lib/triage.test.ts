/**
 * Tests for Focus-based Triage System
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock redis
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('./redis.js', () => ({
  redis: mockRedis,
}));

// Mock logger
vi.mock('./logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Triage System', () => {
  let triageModule: typeof import('./triage.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockRedis.get.mockResolvedValue(null); // Use defaults
    triageModule = await import('./triage.js');
  });

  describe('AGENT_KEYWORDS', () => {
    it('should define keywords for all agents', () => {
      const { AGENT_KEYWORDS } = triageModule;

      expect(AGENT_KEYWORDS.ceo).toBeDefined();
      expect(AGENT_KEYWORDS.cmo).toBeDefined();
      expect(AGENT_KEYWORDS.cto).toBeDefined();
      expect(AGENT_KEYWORDS.cfo).toBeDefined();
      expect(AGENT_KEYWORDS.coo).toBeDefined();
      expect(AGENT_KEYWORDS.cco).toBeDefined();
      expect(AGENT_KEYWORDS.dao).toBeDefined();
    });

    it('should have primary and secondary keywords for each agent', () => {
      const { AGENT_KEYWORDS } = triageModule;

      for (const agent of Object.values(AGENT_KEYWORDS)) {
        expect(agent.primary).toBeInstanceOf(Array);
        expect(agent.secondary).toBeInstanceOf(Array);
        expect(agent.primary.length).toBeGreaterThan(0);
      }
    });

    it('should have category for each agent', () => {
      const { AGENT_KEYWORDS } = triageModule;
      const validCategories = ['marketing', 'tech', 'finance', 'operations', 'governance'];

      for (const agent of Object.values(AGENT_KEYWORDS)) {
        expect(validCategories).toContain(agent.category);
      }
    });
  });

  describe('getFocusSettings', () => {
    it('should return stored settings from Redis', async () => {
      const customFocus = {
        revenueFocus: 90,
        communityGrowth: 80,
        marketingVsDev: 70,
        riskTolerance: 60,
        timeHorizon: 50,
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(customFocus));

      const settings = await triageModule.getFocusSettings();

      expect(settings).toEqual(customFocus);
      expect(mockRedis.get).toHaveBeenCalledWith('settings:focus');
    });

    it('should return defaults when Redis is empty', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const settings = await triageModule.getFocusSettings();

      expect(settings.revenueFocus).toBe(80);
      expect(settings.communityGrowth).toBe(60);
      expect(settings.marketingVsDev).toBe(50);
    });

    it('should return defaults on Redis error', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('Redis down'));

      const settings = await triageModule.getFocusSettings();

      expect(settings.revenueFocus).toBe(80); // Default value
    });
  });

  describe('suggestAgentForIssue', () => {
    it('should suggest CMO for marketing-related issues', async () => {
      const result = await triageModule.suggestAgentForIssue(
        1,
        'Create social media campaign for launch',
        'We need a Twitter thread and Telegram announcement',
        []
      );

      expect(result.recommendedAgent).toBe('cmo');
      expect(result.suggestions[0].confidence).toBeGreaterThan(0);
      expect(result.suggestions[0].keywordsMatched.length).toBeGreaterThan(0);
    });

    it('should suggest CTO for technical issues', async () => {
      const result = await triageModule.suggestAgentForIssue(
        2,
        'Fix smart contract bug',
        'The solidity code needs a security audit',
        []
      );

      expect(result.recommendedAgent).toBe('cto');
      expect(result.suggestions[0].keywordsMatched).toContain('smart contract');
    });

    it('should suggest CFO for financial issues', async () => {
      const result = await triageModule.suggestAgentForIssue(
        3,
        'Treasury allocation review',
        'Need to check budget and liquidity',
        []
      );

      expect(result.recommendedAgent).toBe('cfo');
    });

    it('should suggest COO for operations issues', async () => {
      const result = await triageModule.suggestAgentForIssue(
        4,
        'Improve team workflow efficiency',
        'Need to track KPI metrics and delivery',
        []
      );

      expect(result.recommendedAgent).toBe('coo');
    });

    it('should suggest CCO for compliance issues', async () => {
      const result = await triageModule.suggestAgentForIssue(
        5,
        'Legal compliance audit',
        'Check regulation and policy requirements',
        []
      );

      expect(result.recommendedAgent).toBe('cco');
    });

    it('should detect critical priority', async () => {
      const result = await triageModule.suggestAgentForIssue(
        6,
        'URGENT: Security vulnerability found',
        'Critical bug needs immediate fix',
        []
      );

      expect(result.recommendedPriority).toBe('critical');
    });

    it('should detect high priority', async () => {
      const result = await triageModule.suggestAgentForIssue(
        7,
        'Important deadline approaching',
        'High priority blocker issue',
        []
      );

      expect(result.recommendedPriority).toBe('high');
    });

    it('should detect low priority', async () => {
      const result = await triageModule.suggestAgentForIssue(
        8,
        'Nice to have feature',
        'Add to backlog, low priority',
        []
      );

      expect(result.recommendedPriority).toBe('low');
    });

    it('should default to medium priority', async () => {
      const result = await triageModule.suggestAgentForIssue(
        9,
        'Regular feature request',
        'Standard task description',
        []
      );

      expect(result.recommendedPriority).toBe('medium');
    });

    it('should provide default when no keywords match', async () => {
      const result = await triageModule.suggestAgentForIssue(
        10,
        'Generic task',
        'No specific keywords here',
        []
      );

      // Should default based on focus (50% = balanced, may return CMO or CTO)
      expect(['cmo', 'cto']).toContain(result.recommendedAgent);
      expect(result.suggestions[0].confidence).toBe(30);
    });

    it('should sort suggestions by confidence', async () => {
      const result = await triageModule.suggestAgentForIssue(
        11,
        'Marketing campaign with budget review',
        'Social media content and treasury allocation',
        []
      );

      // Should have multiple suggestions
      if (result.suggestions.length > 1) {
        expect(result.suggestions[0].confidence).toBeGreaterThanOrEqual(
          result.suggestions[1].confidence
        );
      }
    });

    it('should apply focus modifiers', async () => {
      // Set high marketing focus
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({
        revenueFocus: 50,
        communityGrowth: 50,
        marketingVsDev: 80, // Strong marketing bias
        riskTolerance: 50,
        timeHorizon: 50,
      }));
      vi.resetModules();
      const freshModule = await import('./triage.js');

      const result = await freshModule.suggestAgentForIssue(
        12,
        'Content strategy discussion',
        'Communication and announcement planning',
        []
      );

      // Marketing should be boosted
      expect(result.recommendedAgent).toBe('cmo');
    });
  });

  describe('triageIssues', () => {
    it('should triage multiple issues', async () => {
      const issues = [
        { number: 1, title: 'Marketing task', body: 'Social media content', labels: [] },
        { number: 2, title: 'Technical bug', body: 'Fix the code', labels: [] },
      ];

      const results = await triageModule.triageIssues(issues);

      expect(results).toHaveLength(2);
      expect(results[0].issueNumber).toBe(1);
      expect(results[1].issueNumber).toBe(2);
    });

    it('should skip already assigned issues', async () => {
      const issues = [
        { number: 1, title: 'Already assigned', body: 'Task', labels: ['agent:cmo'] },
        { number: 2, title: 'Needs triage', body: 'New task', labels: [] },
      ];

      const results = await triageModule.triageIssues(issues);

      expect(results).toHaveLength(1);
      expect(results[0].issueNumber).toBe(2);
    });

    it('should return empty array for empty input', async () => {
      const results = await triageModule.triageIssues([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('formatTriageForCEO', () => {
    it('should return message when no issues', () => {
      const focus = {
        revenueFocus: 80,
        communityGrowth: 60,
        marketingVsDev: 50,
        riskTolerance: 40,
        timeHorizon: 30,
      };

      const output = triageModule.formatTriageForCEO([], focus);

      expect(output).toBe('No issues need triage at this time.');
    });

    it('should format triage results with focus settings', async () => {
      const focus = {
        revenueFocus: 80,
        communityGrowth: 60,
        marketingVsDev: 70,
        riskTolerance: 40,
        timeHorizon: 60,
      };

      const results: triageModule.TriageResult[] = [
        {
          issueNumber: 42,
          issueTitle: 'Test Issue',
          suggestions: [
            {
              agent: 'cmo',
              confidence: 75,
              reasons: ['Matched keywords: social media'],
              keywordsMatched: ['social media'],
            },
          ],
          recommendedAgent: 'cmo',
          recommendedPriority: 'high',
          focusAlignment: 'Marketing-focused',
        },
      ];

      const output = triageModule.formatTriageForCEO(results, focus);

      expect(output).toContain('Issues Awaiting Triage');
      expect(output).toContain('Marketing vs Dev: 70%');
      expect(output).toContain('#42: Test Issue');
      expect(output).toContain('CMO');
      expect(output).toContain('HIGH');
    });

    it('should show confidence emoji based on score', async () => {
      const focus = {
        revenueFocus: 50,
        communityGrowth: 50,
        marketingVsDev: 50,
        riskTolerance: 50,
        timeHorizon: 50,
      };

      const highConfidence: triageModule.TriageResult = {
        issueNumber: 1,
        issueTitle: 'High confidence',
        suggestions: [{ agent: 'cmo', confidence: 80, reasons: [], keywordsMatched: [] }],
        recommendedAgent: 'cmo',
        recommendedPriority: 'medium',
        focusAlignment: '',
      };

      const output = triageModule.formatTriageForCEO([highConfidence], focus);
      expect(output).toContain('🟢'); // High confidence = green
    });

    it('should show alternatives for low confidence', async () => {
      const focus = {
        revenueFocus: 50,
        communityGrowth: 50,
        marketingVsDev: 50,
        riskTolerance: 50,
        timeHorizon: 50,
      };

      const lowConfidence: triageModule.TriageResult = {
        issueNumber: 1,
        issueTitle: 'Low confidence',
        suggestions: [
          { agent: 'cmo', confidence: 40, reasons: [], keywordsMatched: [] },
          { agent: 'cto', confidence: 35, reasons: [], keywordsMatched: [] },
        ],
        recommendedAgent: 'cmo',
        recommendedPriority: 'medium',
        focusAlignment: '',
      };

      const output = triageModule.formatTriageForCEO([lowConfidence], focus);
      expect(output).toContain('Alternatives');
      expect(output).toContain('CTO');
    });
  });
});
