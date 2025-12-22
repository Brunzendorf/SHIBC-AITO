/**
 * Focus-based Triage System
 *
 * Suggests agent assignments for issues based on:
 * 1. Keyword matching with agent domains
 * 2. Focus settings from dashboard
 * 3. Current agent workload
 */

import { redis } from './redis.js';
import { createLogger } from './logger.js';
import type { AgentType } from './types.js';

const logger = createLogger('triage');

// Focus settings interface (matches dashboard)
export interface FocusSettings {
  revenueFocus: number;      // 0-100: Higher = prioritize revenue
  communityGrowth: number;   // 0-100: Higher = prioritize community
  marketingVsDev: number;    // 0-100: Higher = more marketing focus
  riskTolerance: number;     // 0-100: Higher = accept more risk
  timeHorizon: number;       // 0-100: Higher = longer term focus
}

const DEFAULT_FOCUS: FocusSettings = {
  revenueFocus: 80,
  communityGrowth: 60,
  marketingVsDev: 50,
  riskTolerance: 40,
  timeHorizon: 30,
};

// Agent domain keywords for matching
export const AGENT_KEYWORDS: Record<AgentType, {
  primary: string[];    // Strong match keywords
  secondary: string[];  // Weaker match keywords
  category: 'marketing' | 'tech' | 'finance' | 'operations' | 'governance';
}> = {
  ceo: {
    primary: ['strategy', 'vision', 'leadership', 'executive', 'company-wide', 'cross-team'],
    secondary: ['priority', 'decision', 'approval', 'roadmap'],
    category: 'governance',
  },
  cmo: {
    primary: ['marketing', 'social media', 'twitter', 'x.com', 'telegram', 'content', 'brand', 'campaign', 'influencer', 'community growth'],
    secondary: ['announcement', 'communication', 'engagement', 'followers', 'viral', 'meme', 'post', 'thread'],
    category: 'marketing',
  },
  cto: {
    primary: ['technical', 'development', 'code', 'smart contract', 'solidity', 'api', 'integration', 'bug', 'feature', 'architecture'],
    secondary: ['github', 'deploy', 'test', 'security audit', 'upgrade', 'optimization', 'infrastructure'],
    category: 'tech',
  },
  cfo: {
    primary: ['treasury', 'budget', 'financial', 'revenue', 'expenses', 'liquidity', 'tokenomics', 'price', 'market cap'],
    secondary: ['allocation', 'profit', 'cost', 'investment', 'roi', 'burn', 'staking', 'yield'],
    category: 'finance',
  },
  coo: {
    primary: ['operations', 'process', 'workflow', 'efficiency', 'automation', 'coordination', 'team'],
    secondary: ['schedule', 'milestone', 'delivery', 'quality', 'reporting', 'metrics', 'kpi'],
    category: 'operations',
  },
  cco: {
    primary: ['compliance', 'legal', 'regulation', 'policy', 'risk', 'audit', 'governance'],
    secondary: ['terms', 'privacy', 'kyc', 'aml', 'license', 'jurisdiction'],
    category: 'governance',
  },
  dao: {
    primary: ['governance', 'voting', 'proposal', 'community decision', 'token holder', 'decentralized'],
    secondary: ['quorum', 'delegate', 'snapshot', 'multisig'],
    category: 'governance',
  },
  test: {
    primary: ['test', 'testing', 'e2e', 'integration'],
    secondary: ['validate', 'verify', 'check'],
    category: 'tech',
  },
};

// Priority keywords that indicate urgency
const PRIORITY_KEYWORDS = {
  critical: ['urgent', 'critical', 'emergency', 'asap', 'immediately', 'security vulnerability', 'exploit'],
  high: ['important', 'high priority', 'blocker', 'deadline', 'time-sensitive'],
  low: ['nice to have', 'eventually', 'backlog', 'when time permits', 'low priority'],
};

export interface AgentSuggestion {
  agent: AgentType;
  confidence: number;  // 0-100
  reasons: string[];
  keywordsMatched: string[];
}

export interface TriageResult {
  issueNumber: number;
  issueTitle: string;
  suggestions: AgentSuggestion[];
  recommendedAgent: AgentType;
  recommendedPriority: 'critical' | 'high' | 'medium' | 'low';
  focusAlignment: string;  // Human-readable explanation
}

/**
 * Get current focus settings from Redis
 */
export async function getFocusSettings(): Promise<FocusSettings> {
  try {
    const stored = await redis.get('settings:focus');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to load focus settings, using defaults');
  }
  return DEFAULT_FOCUS;
}

/**
 * Calculate keyword match score for an agent
 */
function calculateKeywordScore(
  text: string,
  agentType: AgentType
): { score: number; matched: string[] } {
  const keywords = AGENT_KEYWORDS[agentType];
  const lowerText = text.toLowerCase();
  const matched: string[] = [];
  let score = 0;

  // Primary keywords (strong match)
  for (const keyword of keywords.primary) {
    if (lowerText.includes(keyword.toLowerCase())) {
      score += 10;
      matched.push(keyword);
    }
  }

  // Secondary keywords (weaker match)
  for (const keyword of keywords.secondary) {
    if (lowerText.includes(keyword.toLowerCase())) {
      score += 5;
      matched.push(keyword);
    }
  }

  return { score, matched };
}

/**
 * Apply focus settings to agent scores
 */
function applyFocusModifier(
  agentType: AgentType,
  baseScore: number,
  focus: FocusSettings
): number {
  const category = AGENT_KEYWORDS[agentType].category;
  let modifier = 1.0;

  // Marketing vs Dev slider
  if (category === 'marketing') {
    // Higher marketingVsDev = boost marketing agents
    modifier *= 0.5 + (focus.marketingVsDev / 100);
  } else if (category === 'tech') {
    // Lower marketingVsDev = boost tech agents
    modifier *= 0.5 + ((100 - focus.marketingVsDev) / 100);
  } else if (category === 'finance') {
    // Revenue focus boosts finance
    modifier *= 0.7 + (focus.revenueFocus / 100) * 0.6;
  } else if (category === 'operations') {
    // Balanced modifier
    modifier *= 0.8 + (focus.communityGrowth / 100) * 0.4;
  }

  return baseScore * modifier;
}

/**
 * Detect priority from issue text
 */
function detectPriority(text: string): 'critical' | 'high' | 'medium' | 'low' {
  const lowerText = text.toLowerCase();

  for (const keyword of PRIORITY_KEYWORDS.critical) {
    if (lowerText.includes(keyword)) return 'critical';
  }
  for (const keyword of PRIORITY_KEYWORDS.high) {
    if (lowerText.includes(keyword)) return 'high';
  }
  for (const keyword of PRIORITY_KEYWORDS.low) {
    if (lowerText.includes(keyword)) return 'low';
  }

  return 'medium';
}

/**
 * Suggest best agent for an issue based on keywords + focus
 */
export async function suggestAgentForIssue(
  issueNumber: number,
  issueTitle: string,
  issueBody: string | null,
  existingLabels: string[] = []
): Promise<TriageResult> {
  const focus = await getFocusSettings();
  const fullText = `${issueTitle} ${issueBody || ''}`;
  const suggestions: AgentSuggestion[] = [];

  // Skip CEO and DAO for regular task assignment
  const assignableAgents: AgentType[] = ['cmo', 'cto', 'cfo', 'coo', 'cco'];

  for (const agentType of assignableAgents) {
    const { score: keywordScore, matched } = calculateKeywordScore(fullText, agentType);

    if (keywordScore > 0 || matched.length > 0) {
      const focusAdjustedScore = applyFocusModifier(agentType, keywordScore, focus);
      const confidence = Math.min(100, Math.round(focusAdjustedScore * 2));

      const reasons: string[] = [];
      if (matched.length > 0) {
        reasons.push(`Matched keywords: ${matched.slice(0, 3).join(', ')}`);
      }

      const category = AGENT_KEYWORDS[agentType].category;
      if (category === 'marketing' && focus.marketingVsDev > 60) {
        reasons.push('Focus slider favors marketing');
      } else if (category === 'tech' && focus.marketingVsDev < 40) {
        reasons.push('Focus slider favors development');
      } else if (category === 'finance' && focus.revenueFocus > 70) {
        reasons.push('High revenue focus');
      }

      suggestions.push({
        agent: agentType,
        confidence,
        reasons,
        keywordsMatched: matched,
      });
    }
  }

  // Sort by confidence
  suggestions.sort((a, b) => b.confidence - a.confidence);

  // If no matches, default based on focus
  if (suggestions.length === 0) {
    const defaultAgent: AgentType = focus.marketingVsDev > 50 ? 'cmo' : 'cto';
    suggestions.push({
      agent: defaultAgent,
      confidence: 30,
      reasons: ['No keyword matches, assigned by focus preference'],
      keywordsMatched: [],
    });
  }

  const recommendedAgent = suggestions[0].agent;
  const recommendedPriority = detectPriority(fullText);

  // Build focus alignment explanation
  const focusExplanation = buildFocusExplanation(focus, recommendedAgent);

  logger.info({
    issueNumber,
    recommendedAgent,
    confidence: suggestions[0].confidence,
    priority: recommendedPriority,
  }, 'Triage suggestion generated');

  return {
    issueNumber,
    issueTitle,
    suggestions,
    recommendedAgent,
    recommendedPriority,
    focusAlignment: focusExplanation,
  };
}

/**
 * Build human-readable focus explanation
 */
function buildFocusExplanation(focus: FocusSettings, agent: AgentType): string {
  const parts: string[] = [];

  if (focus.marketingVsDev > 60) {
    parts.push('Marketing-focused');
  } else if (focus.marketingVsDev < 40) {
    parts.push('Development-focused');
  } else {
    parts.push('Balanced marketing/dev');
  }

  if (focus.revenueFocus > 70) {
    parts.push('Revenue priority');
  }

  if (focus.communityGrowth > 70) {
    parts.push('Community growth emphasis');
  }

  if (focus.timeHorizon > 60) {
    parts.push('Long-term planning');
  } else if (focus.timeHorizon < 40) {
    parts.push('Quick wins preferred');
  }

  return parts.join(', ') || 'Default settings';
}

/**
 * Batch triage multiple issues
 */
export async function triageIssues(
  issues: Array<{
    number: number;
    title: string;
    body: string | null;
    labels: string[];
  }>
): Promise<TriageResult[]> {
  const results: TriageResult[] = [];

  for (const issue of issues) {
    // Skip already assigned issues
    const hasAgentLabel = issue.labels.some(l => l.startsWith('agent:'));
    if (hasAgentLabel) continue;

    const result = await suggestAgentForIssue(
      issue.number,
      issue.title,
      issue.body,
      issue.labels
    );
    results.push(result);
  }

  return results;
}

/**
 * Format triage results for CEO prompt
 */
export function formatTriageForCEO(results: TriageResult[], focus: FocusSettings): string {
  if (results.length === 0) {
    return 'No issues need triage at this time.';
  }

  const lines: string[] = [
    '## Issues Awaiting Triage',
    '',
    `**Current Focus Settings:**`,
    `- Marketing vs Dev: ${focus.marketingVsDev}% ${focus.marketingVsDev > 50 ? '(Marketing-leaning)' : '(Dev-leaning)'}`,
    `- Revenue Focus: ${focus.revenueFocus}%`,
    `- Community Growth: ${focus.communityGrowth}%`,
    `- Risk Tolerance: ${focus.riskTolerance}%`,
    `- Time Horizon: ${focus.timeHorizon}% ${focus.timeHorizon > 50 ? '(Long-term)' : '(Short-term)'}`,
    '',
    '---',
    '',
  ];

  for (const result of results) {
    const topSuggestion = result.suggestions[0];
    const confidenceEmoji = topSuggestion.confidence >= 70 ? '🟢' :
                            topSuggestion.confidence >= 40 ? '🟡' : '🔴';

    lines.push(`### #${result.issueNumber}: ${result.issueTitle}`);
    lines.push(`- **Recommended:** ${topSuggestion.agent.toUpperCase()} ${confidenceEmoji} (${topSuggestion.confidence}% confidence)`);
    lines.push(`- **Priority:** ${result.recommendedPriority.toUpperCase()}`);

    if (topSuggestion.reasons.length > 0) {
      lines.push(`- **Reasons:** ${topSuggestion.reasons.join('; ')}`);
    }

    // Show alternatives if confidence is low
    if (topSuggestion.confidence < 70 && result.suggestions.length > 1) {
      const alternatives = result.suggestions.slice(1, 3)
        .map(s => `${s.agent.toUpperCase()} (${s.confidence}%)`)
        .join(', ');
      lines.push(`- **Alternatives:** ${alternatives}`);
    }

    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('**To approve suggestions, use:**');
  lines.push('```json');
  lines.push('{');
  lines.push('  "actions": [{');
  lines.push('    "type": "spawn_worker",');
  lines.push('    "task": "Action: triage\\nIssues: #42, #43\\nAssignments: 42:cmo:high, 43:cto:medium",');
  lines.push('    "agent": "issue-manager"');
  lines.push('  }]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('**Or override with your own assignment:**');
  lines.push('```json');
  lines.push('{');
  lines.push('  "actions": [{');
  lines.push('    "type": "spawn_worker",');
  lines.push('    "task": "Action: triage\\nIssue: #42\\nAgent: cfo\\nPriority: critical\\nReason: Treasury impact",');
  lines.push('    "agent": "issue-manager"');
  lines.push('  }]');
  lines.push('}');
  lines.push('```');

  return lines.join('\n');
}
