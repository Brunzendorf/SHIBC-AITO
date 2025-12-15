/**
 * Initiative System - Proactive Agent Autonomy
 *
 * Enables agents to generate their own work instead of waiting for tasks.
 * Each agent scans their domain, identifies opportunities, and creates
 * GitHub issues or self-assigns work.
 */

import { createLogger } from '../lib/logger.js';
import { search } from '../lib/rag.js';
import { redis } from '../lib/redis.js';
import { Octokit } from '@octokit/rest';

const logger = createLogger('initiative');

// GitHub client (initialized lazily)
let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN not set');
    }
    octokit = new Octokit({ auth: token });
  }
  return octokit;
}

// Agent types
export type AgentType = 'ceo' | 'cmo' | 'cto' | 'cfo' | 'coo' | 'cco' | 'dao';

// Initiative definition
export interface Initiative {
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  revenueImpact: number; // 0-10
  effort: number; // 0-10 (story points)
  suggestedAssignee: AgentType;
  tags: string[];
  source: string; // Where this initiative came from
}

// Domain-specific focus areas
const AGENT_FOCUS: Record<AgentType, {
  keyQuestions: string[];
  revenueAngles: string[];
  scanTopics: string[];
}> = {
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
};

// Pre-defined initiatives for bootstrapping (revenue-focused)
const BOOTSTRAP_INITIATIVES: Initiative[] = [
  {
    title: 'Activate X/Twitter for organic reach',
    description: 'Twitter is the primary channel for crypto marketing. Need to post regularly, engage with community, build follower base. Target: 1000 followers in first month.',
    priority: 'critical',
    revenueImpact: 9,
    effort: 2,
    suggestedAssignee: 'cmo',
    tags: ['marketing', 'social', 'growth'],
    source: 'bootstrap',
  },
  {
    title: 'Apply for CoinGecko listing',
    description: 'CoinGecko listing provides legitimacy and visibility. Free to apply, high impact. Submit token details, contract address, social links.',
    priority: 'high',
    revenueImpact: 8,
    effort: 3,
    suggestedAssignee: 'cmo',
    tags: ['listing', 'visibility', 'growth'],
    source: 'bootstrap',
  },
  {
    title: 'Apply for CoinMarketCap listing',
    description: 'CMC is the most visited crypto data site. Listing drives organic traffic and trading volume.',
    priority: 'high',
    revenueImpact: 8,
    effort: 3,
    suggestedAssignee: 'cmo',
    tags: ['listing', 'visibility', 'growth'],
    source: 'bootstrap',
  },
  {
    title: 'Research and apply for crypto grants',
    description: 'Many foundations offer grants: Ethereum Foundation, Gitcoin, Optimism RPGF, etc. Research eligibility and apply.',
    priority: 'high',
    revenueImpact: 10,
    effort: 5,
    suggestedAssignee: 'cfo',
    tags: ['funding', 'grants', 'revenue'],
    source: 'bootstrap',
  },
  {
    title: 'Define token utility features',
    description: 'Pure meme tokens struggle. Define utility: staking, governance, access to features. Increases token value proposition.',
    priority: 'medium',
    revenueImpact: 7,
    effort: 5,
    suggestedAssignee: 'cto',
    tags: ['tokenomics', 'utility', 'product'],
    source: 'bootstrap',
  },
  {
    title: 'Launch community meme contest',
    description: 'User-generated content drives engagement. Prize pool from treasury. Winners get tokens + recognition.',
    priority: 'medium',
    revenueImpact: 6,
    effort: 3,
    suggestedAssignee: 'cmo',
    tags: ['community', 'engagement', 'marketing'],
    source: 'bootstrap',
  },
  {
    title: 'Create ambassador program',
    description: 'Recruit community members as ambassadors. Provide incentives for promotion, content creation, community moderation.',
    priority: 'medium',
    revenueImpact: 7,
    effort: 4,
    suggestedAssignee: 'coo',
    tags: ['community', 'growth', 'partnerships'],
    source: 'bootstrap',
  },
  {
    title: 'Security audit preparation',
    description: 'Prepare documentation for security audit. Clean up contracts, document functions, prepare test suite.',
    priority: 'high',
    revenueImpact: 5,
    effort: 6,
    suggestedAssignee: 'cto',
    tags: ['security', 'audit', 'trust'],
    source: 'bootstrap',
  },
];

// Redis key for tracking created initiatives
const INITIATIVE_CREATED_KEY = 'initiatives:created';
const INITIATIVE_COOLDOWN_KEY = 'initiatives:cooldown';

/**
 * Check if an initiative was already created
 */
async function wasInitiativeCreated(title: string): Promise<boolean> {
  const hash = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  return await redis.sismember(INITIATIVE_CREATED_KEY, hash) === 1;
}

/**
 * Mark an initiative as created
 */
async function markInitiativeCreated(title: string): Promise<void> {
  const hash = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  await redis.sadd(INITIATIVE_CREATED_KEY, hash);
}

/**
 * Check if agent is in cooldown (prevent spam)
 */
async function isInCooldown(agentType: AgentType): Promise<boolean> {
  const key = `${INITIATIVE_COOLDOWN_KEY}:${agentType}`;
  return await redis.exists(key) === 1;
}

/**
 * Set cooldown for agent (1 hour)
 */
async function setCooldown(agentType: AgentType): Promise<void> {
  const key = `${INITIATIVE_COOLDOWN_KEY}:${agentType}`;
  await redis.setex(key, 3600, '1'); // 1 hour cooldown
}

/**
 * Scan RAG for relevant context
 */
async function scanRAG(topics: string[]): Promise<string[]> {
  const results: string[] = [];

  for (const topic of topics) {
    try {
      const hits = await search(topic, 3);
      for (const hit of hits) {
        results.push(`[${hit.source}] ${hit.text.slice(0, 200)}`);
      }
    } catch (error) {
      logger.debug({ topic, error }, 'RAG scan failed for topic');
    }
  }

  return results;
}

/**
 * Generate initiatives for an agent
 */
export async function generateInitiatives(agentType: AgentType): Promise<Initiative[]> {
  // Check cooldown
  if (await isInCooldown(agentType)) {
    logger.debug({ agentType }, 'Agent in initiative cooldown');
    return [];
  }

  const focus = AGENT_FOCUS[agentType];
  if (!focus) {
    logger.warn({ agentType }, 'Unknown agent type');
    return [];
  }

  // Scan RAG for context
  const ragContext = await scanRAG(focus.scanTopics);

  // Filter bootstrap initiatives relevant to this agent
  const relevantInitiatives = BOOTSTRAP_INITIATIVES.filter(
    i => i.suggestedAssignee === agentType
  );

  // Filter out already-created initiatives
  const newInitiatives: Initiative[] = [];
  for (const initiative of relevantInitiatives) {
    if (!(await wasInitiativeCreated(initiative.title))) {
      newInitiatives.push(initiative);
    }
  }

  // Sort by revenue impact (descending) then effort (ascending)
  newInitiatives.sort((a, b) => {
    const scoreA = a.revenueImpact * 2 - a.effort;
    const scoreB = b.revenueImpact * 2 - b.effort;
    return scoreB - scoreA;
  });

  logger.info({
    agentType,
    totalInitiatives: newInitiatives.length,
    ragContextItems: ragContext.length,
  }, 'Generated initiatives');

  return newInitiatives;
}

/**
 * Create a GitHub issue for an initiative
 */
export async function createGitHubIssue(initiative: Initiative): Promise<string | null> {
  const owner = process.env.GITHUB_ORG || 'Brunzendorf';
  const repo = 'SHIBC-AITO';

  try {
    const gh = getOctokit();

    // Map priority to labels
    const priorityLabel = `priority:${initiative.priority}`;
    const labels = [
      priorityLabel,
      `agent:${initiative.suggestedAssignee}`,
      ...initiative.tags.map(t => t.toLowerCase()),
    ];

    // Create issue body
    const body = `## Description

${initiative.description}

## Priority

**${initiative.priority.toUpperCase()}** (Revenue Impact: ${initiative.revenueImpact}/10, Effort: ${initiative.effort}/10)

## Revenue Angle

This initiative contributes to revenue by: ${AGENT_FOCUS[initiative.suggestedAssignee]?.revenueAngles.join(', ') || 'TBD'}

## Suggested Assignee

@${initiative.suggestedAssignee}-agent

## Source

Auto-generated by AITO Initiative System from: ${initiative.source}

---
*Created by AITO autonomous initiative system*`;

    const response = await gh.issues.create({
      owner,
      repo,
      title: initiative.title,
      body,
      labels,
    });

    // Mark as created
    await markInitiativeCreated(initiative.title);

    logger.info({
      issueNumber: response.data.number,
      title: initiative.title,
    }, 'Created GitHub issue');

    return response.data.html_url;
  } catch (error) {
    logger.error({ error, initiative: initiative.title }, 'Failed to create GitHub issue');
    return null;
  }
}

/**
 * Run initiative phase for an agent
 * Returns true if an initiative was created/executed
 */
export async function runInitiativePhase(agentType: AgentType): Promise<{
  created: boolean;
  initiative?: Initiative;
  issueUrl?: string;
}> {
  logger.info({ agentType }, 'Running initiative phase');

  // Generate initiatives
  const initiatives = await generateInitiatives(agentType);

  if (initiatives.length === 0) {
    logger.debug({ agentType }, 'No new initiatives to create');
    return { created: false };
  }

  // Take top initiative
  const topInitiative = initiatives[0];

  // Create GitHub issue
  const issueUrl = await createGitHubIssue(topInitiative);

  if (issueUrl) {
    // Set cooldown to prevent spam
    await setCooldown(agentType);

    return {
      created: true,
      initiative: topInitiative,
      issueUrl,
    };
  }

  return { created: false };
}

/**
 * Get initiative stats
 */
export async function getInitiativeStats(): Promise<{
  totalCreated: number;
  agentCooldowns: Record<string, boolean>;
}> {
  const totalCreated = await redis.scard(INITIATIVE_CREATED_KEY);

  const agentCooldowns: Record<string, boolean> = {};
  for (const agent of Object.keys(AGENT_FOCUS)) {
    agentCooldowns[agent] = await isInCooldown(agent as AgentType);
  }

  return {
    totalCreated,
    agentCooldowns,
  };
}
