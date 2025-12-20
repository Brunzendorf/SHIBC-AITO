/**
 * Initiative System - Proactive Agent Autonomy
 *
 * Enables agents to generate their own work instead of waiting for tasks.
 * Each agent scans their domain, identifies opportunities, and creates
 * GitHub issues or self-assigns work.
 */

import { createLogger } from '../lib/logger.js';
import { search } from '../lib/rag.js';
import { redis, publisher, channels } from '../lib/redis.js';
import { agentRepo } from '../lib/db.js';
import { Octokit } from '@octokit/rest';
import { buildDataContext } from '../lib/data-fetcher.js';

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

// Redis keys
const INITIATIVE_CREATED_KEY = 'initiatives:created';
const INITIATIVE_COOLDOWN_KEY = 'initiatives:cooldown';
const FOCUS_KEY = 'settings:focus';

// Focus settings interface
interface FocusSettings {
  revenueFocus: number;
  communityGrowth: number;
  marketingVsDev: number;
  riskTolerance: number;
  timeHorizon: number;
}

const DEFAULT_FOCUS: FocusSettings = {
  revenueFocus: 80,
  communityGrowth: 60,
  marketingVsDev: 50,
  riskTolerance: 40,
  timeHorizon: 30,
};

/**
 * Get current focus settings from Redis
 */
async function getFocusSettings(): Promise<FocusSettings> {
  try {
    const stored = await redis.get(FOCUS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to load focus settings, using defaults');
  }
  return DEFAULT_FOCUS;
}

/**
 * Calculate initiative score based on focus settings
 */
function calculateInitiativeScore(initiative: Initiative, focus: FocusSettings, agentType: AgentType): number {
  let score = 0;

  // Base score from revenue impact
  score += initiative.revenueImpact * (focus.revenueFocus / 100) * 2;

  // Adjust based on agent type and marketingVsDev slider
  const isMarketingAgent = ['cmo', 'coo'].includes(agentType);
  const isDevAgent = ['cto', 'cfo'].includes(agentType);

  if (isMarketingAgent) {
    score += (focus.marketingVsDev / 100) * 3;
  } else if (isDevAgent) {
    score += ((100 - focus.marketingVsDev) / 100) * 3;
  }

  // Community growth bonus for community-related initiatives
  if (initiative.tags.some(t => ['community', 'growth', 'social'].includes(t))) {
    score += (focus.communityGrowth / 100) * 2;
  }

  // Risk adjustment
  const isRisky = initiative.tags.some(t => ['aggressive', 'experimental'].includes(t));
  if (isRisky) {
    score *= (focus.riskTolerance / 100);
  }

  // Time horizon adjustment
  const isLongTerm = initiative.effort > 5;
  if (isLongTerm) {
    score *= (focus.timeHorizon / 100);
  } else {
    score *= ((100 - focus.timeHorizon) / 100) + 0.5; // Boost quick wins when short-term focused
  }

  // Subtract effort
  score -= initiative.effort * 0.5;

  return score;
}

/**
 * Check if an initiative was already created (IMPROVED: checks GitHub too)
 */
async function wasInitiativeCreated(title: string): Promise<boolean> {
  // First, check Redis cache (fast path)
  const hash = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const inRedis = await redis.sismember(INITIATIVE_CREATED_KEY, hash) === 1;
  if (inRedis) {
    logger.debug({ title }, 'Initiative found in Redis cache');
    return true;
  }

  // Second, check GitHub for similar issues (slow path, but accurate)
  try {
    const gh = getOctokit();
    const owner = process.env.GITHUB_ORG || 'Brunzendorf';
    const repo = 'SHIBC-AITO';

    // Extract key words from title for search
    const keywords = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 5)
      .join(' ');

    if (!keywords) return false;

    // Search both open and closed issues
    const searchQuery = `repo:${owner}/${repo} is:issue ${keywords}`;
    const searchResult = await gh.search.issuesAndPullRequests({
      q: searchQuery,
      per_page: 10,
    });

    // Check for similar titles using fuzzy matching
    const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const issue of searchResult.data.items) {
      const issueTitle = issue.title.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Check for exact match
      if (issueTitle === normalizedTitle) {
        logger.info({ title, existingIssue: issue.number }, 'Exact duplicate found on GitHub');
        await markInitiativeCreated(title); // Cache for next time
        return true;
      }

      // Check for high similarity (>80% overlap)
      const similarity = calculateSimilarity(normalizedTitle, issueTitle);
      if (similarity > 0.8) {
        logger.info({ title, existingIssue: issue.number, similarity }, 'Similar issue found on GitHub');
        return true;
      }
    }
  } catch (error) {
    logger.warn({ error, title }, 'Failed to check GitHub for duplicates');
    // Fall through - don't block on GitHub errors
  }

  return false;
}

/**
 * Calculate similarity between two strings (Jaccard index on words)
 */
function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.match(/[a-z0-9]+/g) || []);
  const wordsB = new Set(b.match(/[a-z0-9]+/g) || []);

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
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
 * Fetch open GitHub issues for context
 */
async function fetchGitHubIssues(): Promise<{ open: string[]; recent: string[] }> {
  try {
    const gh = getOctokit();
    const owner = process.env.GITHUB_ORG || 'Brunzendorf';
    const repo = 'SHIBC-AITO';

    // Get open issues
    const openIssues = await gh.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: 15,
    });

    // Get recently closed issues
    const closedIssues = await gh.issues.listForRepo({
      owner,
      repo,
      state: 'closed',
      per_page: 10,
      sort: 'updated',
      direction: 'desc',
    });

    return {
      open: openIssues.data.map(i => {
        const labelNames = i.labels.map(l => typeof l === 'string' ? l : l.name).filter(Boolean);
        return `#${i.number}: ${i.title} [${labelNames.join(', ')}]`;
      }),
      recent: closedIssues.data.map(i => `#${i.number}: ${i.title} (closed)`),
    };
  } catch (error) {
    logger.debug({ error }, 'Failed to fetch GitHub issues');
    return { open: [], recent: [] };
  }
}

/**
 * Get other agents' current status from PostgreSQL
 */
async function getTeamStatus(): Promise<Record<string, string>> {
  const status: Record<string, string> = {};
  const agents: AgentType[] = ['ceo', 'cmo', 'cto', 'cfo', 'coo', 'cco', 'dao'];

  for (const agentType of agents) {
    try {
      // Get agent from DB to get their ID
      const agent = await agentRepo.findByType(agentType);
      if (!agent) continue;

      // Query PostgreSQL for agent state
      const { stateRepo } = await import('../lib/db.js');
      const stateData = await stateRepo.getAll(agent.id);

      if (stateData && Object.keys(stateData).length > 0) {
        const loopCount = stateData.loop_count || '?';
        const lastActive = stateData.last_loop_at
          ? new Date(String(stateData.last_loop_at)).toLocaleString()
          : 'unknown';
        const currentStatus = stateData.status || stateData.current_focus || 'active';
        status[agentType.toUpperCase()] = `Loop ${loopCount}, ${currentStatus}, last: ${lastActive}`;
      }
    } catch {
      // ignore individual agent errors
    }
  }

  return status;
}

/**
 * Build rich initiative context for agent prompts
 */
export async function buildInitiativeContext(
  agentType: AgentType,
  ragContext: string[],
  focusSettings: FocusSettings,
  existingTitles: string[]
): Promise<string> {
  const agentFocus = AGENT_FOCUS[agentType];
  if (!agentFocus) return '';

  // Fetch additional context in parallel
  const [githubIssues, teamStatus, dataContext] = await Promise.all([
    fetchGitHubIssues(),
    getTeamStatus(),
    buildDataContext(), // Live market data, news, fear & greed
  ]);

  const teamStatusStr = Object.entries(teamStatus)
    .map(([agent, status]) => `- ${agent}: ${status}`)
    .join('\n') || 'No team data available';

  // Rich, data-driven context for AI decision making
  return `
## 🧠 Strategic Context for ${agentType.toUpperCase()}

You MUST use \`propose_initiative\` action to create new initiatives based on this data.
Analyze the market conditions, news, and project status to identify opportunities.

### Focus Settings (Dashboard Controls)
- Revenue Priority: ${focusSettings.revenueFocus}%
- Community Growth: ${focusSettings.communityGrowth}%
- Marketing vs Dev: ${focusSettings.marketingVsDev}% (higher = more marketing)
- Risk Tolerance: ${focusSettings.riskTolerance}%
- Time Horizon: ${focusSettings.timeHorizon}% (higher = longer term)

---

${dataContext}

---

### Team Status (Live)
${teamStatusStr}

### Open GitHub Issues (${githubIssues.open.length})
${githubIssues.open.slice(0, 10).join('\n') || 'None'}

### Recently Completed
${githubIssues.recent.slice(0, 5).join('\n') || 'None'}

### Existing Initiatives (avoid duplicates!)
${existingTitles.slice(0, 15).join(', ') || 'None'}

### RAG Knowledge
${ragContext.slice(0, 5).join('\n') || 'None'}

---

## Your Role: ${agentType.toUpperCase()}

### Key Questions to Consider
${agentFocus.keyQuestions.map(q => `- ${q}`).join('\n')}

### Revenue Angles for Your Domain
${agentFocus.revenueAngles.map(r => `- ${r}`).join('\n')}

---

## ACTION REQUIRED

Based on the data above, propose a NEW initiative using:
\`\`\`json
{
  "actions": [{
    "type": "propose_initiative",
    "data": {
      "title": "Clear, actionable title",
      "description": "What, why, expected outcome",
      "rationale": "Why NOW based on current data?",
      "priority": "high|medium|low",
      "effort": 1-5,
      "revenueImpact": 0-5,
      "communityImpact": 0-5,
      "tags": ["relevant", "tags"]
    }
  }]
}
\`\`\`

Think strategically. Use the market data and news to inform your proposal.
`;
}

/**
 * Get initiative context for agent prompt injection
 * This provides agents with context to propose their own initiatives
 */
export async function getInitiativePromptContext(agentType: AgentType): Promise<string> {
  const agentFocus = AGENT_FOCUS[agentType];
  if (!agentFocus) return '';

  const focusSettings = await getFocusSettings();
  const ragContext = await scanRAG(agentFocus.scanTopics);
  const createdTitles = await redis.smembers(INITIATIVE_CREATED_KEY);

  return buildInitiativeContext(agentType, ragContext, focusSettings, createdTitles);
}

/**
 * Generate bootstrap initiatives for an agent (fallback if agent doesn't propose)
 */
export async function generateInitiatives(agentType: AgentType): Promise<Initiative[]> {
  // Check cooldown
  if (await isInCooldown(agentType)) {
    logger.debug({ agentType }, 'Agent in initiative cooldown');
    return [];
  }

  const agentFocus = AGENT_FOCUS[agentType];
  if (!agentFocus) {
    logger.warn({ agentType }, 'Unknown agent type');
    return [];
  }

  // Get focus settings from dashboard
  const focusSettings = await getFocusSettings();

  // Scan RAG for context
  const ragContext = await scanRAG(agentFocus.scanTopics);

  // Filter bootstrap initiatives relevant to this agent (that haven't been created)
  const relevantBootstrap = BOOTSTRAP_INITIATIVES.filter(
    i => i.suggestedAssignee === agentType
  );
  const newBootstrapInitiatives: Initiative[] = [];
  for (const initiative of relevantBootstrap) {
    if (!(await wasInitiativeCreated(initiative.title))) {
      newBootstrapInitiatives.push(initiative);
    }
  }

  // Sort by focus-adjusted score (uses dashboard slider settings)
  newBootstrapInitiatives.sort((a, b) => {
    const scoreA = calculateInitiativeScore(a, focusSettings, agentType);
    const scoreB = calculateInitiativeScore(b, focusSettings, agentType);
    return scoreB - scoreA;
  });

  logger.info({
    agentType,
    totalInitiatives: newBootstrapInitiatives.length,
    ragContextItems: ragContext.length,
    focusSettings: {
      revenueFocus: focusSettings.revenueFocus,
      marketingVsDev: focusSettings.marketingVsDev,
    },
  }, 'Generated bootstrap initiatives with focus-adjusted scoring');

  return newBootstrapInitiatives;
}

/**
 * Create initiative from agent proposal
 */
export async function createInitiativeFromProposal(
  agentType: AgentType,
  proposal: {
    title: string;
    description: string;
    priority: string;
    revenueImpact: number;
    effort: number;
    tags: string[];
  }
): Promise<{ initiative: Initiative; issueUrl: string | null }> {
  const initiative: Initiative = {
    title: proposal.title,
    description: proposal.description,
    priority: (['critical', 'high', 'medium', 'low'].includes(proposal.priority)
      ? proposal.priority : 'medium') as Initiative['priority'],
    revenueImpact: Math.min(10, Math.max(1, proposal.revenueImpact || 5)),
    effort: Math.min(10, Math.max(1, proposal.effort || 5)),
    suggestedAssignee: agentType,
    tags: Array.isArray(proposal.tags) ? proposal.tags : [],
    source: 'agent-proposed',
  };

  // Check if already exists
  if (await wasInitiativeCreated(initiative.title)) {
    logger.info({ title: initiative.title }, 'Initiative already exists, skipping');
    return { initiative, issueUrl: null };
  }

  // Create GitHub issue
  const issueUrl = await createGitHubIssue(initiative);

  if (issueUrl) {
    await markInitiativeCreated(initiative.title);
    await setCooldown(agentType);

    // Auto-assign: Queue as task for the assigned agent
    await assignInitiativeAsTask(initiative, issueUrl);
  }

  return { initiative, issueUrl };
}

/**
 * Auto-assign an initiative as a task to the suggested agent
 */
async function assignInitiativeAsTask(initiative: Initiative, issueUrl: string): Promise<void> {
  try {
    // Find the agent in DB
    const agent = await agentRepo.findByType(initiative.suggestedAssignee);
    if (!agent) {
      logger.warn({ agentType: initiative.suggestedAssignee }, 'Cannot auto-assign: agent not found');
      return;
    }

    // Create task payload
    const task = {
      title: `[Initiative] ${initiative.title}`,
      description: `${initiative.description}\n\nGitHub Issue: ${issueUrl}\nPriority: ${initiative.priority}\nRevenue Impact: ${initiative.revenueImpact}/10\nEffort: ${initiative.effort}/10`,
      priority: initiative.priority,
      from: 'initiative-system',
      issueUrl,
      tags: initiative.tags,
      createdAt: new Date().toISOString(),
    };

    // Queue to agent's task queue
    const taskQueueKey = `queue:tasks:${initiative.suggestedAssignee}`;
    await redis.rpush(taskQueueKey, JSON.stringify(task));

    // Notify the agent via Redis pub/sub
    await publisher.publish(channels.agent(agent.id), JSON.stringify({
      id: crypto.randomUUID(),
      type: 'task_queued',
      from: 'initiative-system',
      to: agent.id,
      payload: { title: task.title, queueKey: taskQueueKey },
      priority: initiative.priority,
      timestamp: new Date(),
      requiresResponse: false,
    }));

    logger.info({
      agentType: initiative.suggestedAssignee,
      title: initiative.title,
      issueUrl,
    }, 'Initiative auto-assigned as task to agent');
  } catch (error) {
    logger.warn({ error, title: initiative.title }, 'Failed to auto-assign initiative');
  }
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
 * Create a GitHub issue for human action request (assigned to human)
 */
export async function createHumanActionRequest(request: {
  title: string;
  description: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  requestedBy: string;
  blockedInitiatives?: string[];
  category?: string;
}): Promise<{ issueUrl: string | null; issueNumber: number | null }> {
  const owner = process.env.GITHUB_ORG || 'Brunzendorf';
  const repo = 'SHIBC-AITO';
  const humanUsername = process.env.GITHUB_HUMAN_USERNAME || 'Brunzendorf';

  try {
    const gh = getOctokit();

    const urgencyEmoji = {
      low: '📋',
      medium: '⚠️',
      high: '🔴',
      critical: '🚨',
    }[request.urgency];

    const labels = [
      'human-action-required',
      `urgency:${request.urgency}`,
      `from:${request.requestedBy}`,
    ];
    if (request.category) labels.push(request.category);

    const body = `${urgencyEmoji} **Human Action Required**

## Request
${request.description}

## Urgency
**${request.urgency.toUpperCase()}**

## Requested By
${request.requestedBy.toUpperCase()} Agent

${request.blockedInitiatives?.length ? `## Blocked Initiatives
${request.blockedInitiatives.map(i => `- ${i}`).join('\n')}` : ''}

---
*This issue was automatically created by AITO because an agent needs human input to proceed.*
*Please resolve this and close the issue when done - the agent will be notified.*`;

    const response = await gh.issues.create({
      owner,
      repo,
      title: `${urgencyEmoji} [Human Required] ${request.title}`,
      body,
      labels,
      assignees: [humanUsername],
    });

    logger.info({
      issueNumber: response.data.number,
      title: request.title,
      assignee: humanUsername,
    }, 'Created human action request issue');

    return {
      issueUrl: response.data.html_url,
      issueNumber: response.data.number,
    };
  } catch (error) {
    logger.error({ error, title: request.title }, 'Failed to create human action request');
    return { issueUrl: null, issueNumber: null };
  }
}

/**
 * Add a comment to a GitHub issue (for agent progress updates)
 */
export async function addIssueComment(
  issueNumber: number,
  comment: string,
  agentType: string
): Promise<boolean> {
  const owner = process.env.GITHUB_ORG || 'Brunzendorf';
  const repo = 'SHIBC-AITO';

  try {
    const gh = getOctokit();

    const body = `**[${agentType.toUpperCase()} Agent Update]**

${comment}

---
*Automated update from AITO agent system*`;

    await gh.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });

    logger.info({ issueNumber, agentType }, 'Added comment to issue');
    return true;
  } catch (error) {
    logger.error({ error, issueNumber }, 'Failed to add issue comment');
    return false;
  }
}

/**
 * Run initiative phase for an agent
 * Now AI-driven: If no bootstrap initiatives, queues a task for Claude Code to generate ideas
 * Returns true if an initiative was created/executed
 */
export async function runInitiativePhase(agentType: AgentType): Promise<{
  created: boolean;
  initiative?: Initiative;
  issueUrl?: string;
  needsAIGeneration?: boolean;
}> {
  logger.info({ agentType }, 'Running initiative phase');

  // Check cooldown first
  if (await isInCooldown(agentType)) {
    logger.debug({ agentType }, 'Agent in initiative cooldown');
    return { created: false };
  }

  // Try bootstrap initiatives first
  const bootstrapInitiatives = await generateInitiatives(agentType);

  if (bootstrapInitiatives.length > 0) {
    // Use bootstrap initiative
    const topInitiative = bootstrapInitiatives[0];
    const issueUrl = await createGitHubIssue(topInitiative);

    if (issueUrl) {
      await setCooldown(agentType);
      await assignInitiativeAsTask(topInitiative, issueUrl);
      return {
        created: true,
        initiative: topInitiative,
        issueUrl,
        needsAIGeneration: false,
      };
    }
  }

  // No bootstrap available - signal that AI generation is needed
  // The daemon will handle this by running a Claude Code session with initiative context
  logger.info({ agentType }, 'No bootstrap initiatives, AI generation needed');
  return { created: false, needsAIGeneration: true };
}

/**
 * Build a prompt for AI initiative generation (used by daemon with Claude Code CLI)
 */
export async function buildInitiativeGenerationPrompt(agentType: AgentType): Promise<string> {
  const agentFocus = AGENT_FOCUS[agentType];
  if (!agentFocus) return '';

  const focusSettings = await getFocusSettings();
  const ragContext = await scanRAG(agentFocus.scanTopics);
  const createdTitles = await redis.smembers(INITIATIVE_CREATED_KEY);
  const context = await buildInitiativeContext(agentType, ragContext, focusSettings, createdTitles);

  // Current date/time for time-aware initiatives
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = days[now.getUTCDay()];
  const dateStr = now.toISOString().split('T')[0];

  return `# INITIATIVE GENERATION TASK

⚠️ **TODAY IS: ${dayName}, ${dateStr}** - Use this date for any time-sensitive planning!

You are the ${agentType.toUpperCase()} agent. Your ONLY task right now is to propose ONE new initiative.

${context}

## REQUIRED ACTION

You MUST respond with a propose_initiative action. Example:

\`\`\`json
{
  "actions": [{
    "type": "propose_initiative",
    "data": {
      "title": "Specific, actionable title",
      "description": "What to do, why it matters, expected outcome (2-3 sentences)",
      "rationale": "Why NOW based on the market data above?",
      "priority": "high",
      "effort": 3,
      "revenueImpact": 5,
      "communityImpact": 4,
      "tags": ["relevant", "tags"]
    }
  }]
}
\`\`\`

## GUIDELINES

- Be SPECIFIC and ACTIONABLE (can start TODAY)
- Consider market conditions: Fear & Greed is ${focusSettings.riskTolerance > 50 ? 'favorable for risks' : 'suggesting caution'}
- Revenue focus: ${focusSettings.revenueFocus}%
- DON'T propose things already in "Existing Initiatives" list
- Base your proposal on the news, market data, and team status above

NOW PROPOSE YOUR INITIATIVE:`;
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

// === GITHUB ISSUE STATUS MANAGEMENT ===

const STATUS_LABELS = {
  BACKLOG: 'status:backlog',
  READY: 'status:ready',
  IN_PROGRESS: 'status:in-progress',
  REVIEW: 'status:review',
  DONE: 'status:done',
  BLOCKED: 'status:blocked',
};

/**
 * Update an issue's status label on GitHub
 */
export async function updateIssueStatus(
  issueNumber: number,
  newStatus: keyof typeof STATUS_LABELS,
  agentType?: string
): Promise<boolean> {
  const owner = process.env.GITHUB_ORG || 'Brunzendorf';
  const repo = 'SHIBC-AITO';

  try {
    const gh = getOctokit();

    // Get current labels
    const issue = await gh.issues.get({ owner, repo, issue_number: issueNumber });
    const currentLabels = issue.data.labels.map((l) =>
      typeof l === 'string' ? l : l.name || ''
    );

    // Remove old status labels, keep others
    const newLabels = currentLabels.filter((l) => !l.startsWith('status:'));

    // Add new status label
    newLabels.push(STATUS_LABELS[newStatus]);

    // Update labels
    await gh.issues.setLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: newLabels,
    });

    logger.info({
      issueNumber,
      newStatus: STATUS_LABELS[newStatus],
      agentType,
    }, 'Updated GitHub issue status');

    // Refresh backlog cache
    await refreshBacklogCache();

    return true;
  } catch (error) {
    logger.error({ error, issueNumber, newStatus }, 'Failed to update issue status');
    return false;
  }
}

/**
 * Claim an issue - set to in-progress and assign to agent
 */
export async function claimIssue(
  issueNumber: number,
  agentType: string
): Promise<boolean> {
  const owner = process.env.GITHUB_ORG || 'Brunzendorf';
  const repo = 'SHIBC-AITO';

  try {
    const gh = getOctokit();

    // Get current labels
    const issue = await gh.issues.get({ owner, repo, issue_number: issueNumber });
    const currentLabels = issue.data.labels.map((l) =>
      typeof l === 'string' ? l : l.name || ''
    );

    // Check if already in-progress by another agent
    const hasOtherAgent = currentLabels.some(
      (l) => l.startsWith('agent:') && l !== `agent:${agentType}`
    );
    if (hasOtherAgent && currentLabels.includes(STATUS_LABELS.IN_PROGRESS)) {
      logger.warn({ issueNumber, agentType }, 'Issue already claimed by another agent');
      return false;
    }

    // Remove old status labels and agent labels
    const newLabels = currentLabels.filter(
      (l) => !l.startsWith('status:') && !l.startsWith('agent:')
    );

    // Add in-progress status and agent label
    newLabels.push(STATUS_LABELS.IN_PROGRESS);
    newLabels.push(`agent:${agentType}`);

    // Update labels
    await gh.issues.setLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: newLabels,
    });

    // Add comment
    await gh.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `🤖 **${agentType.toUpperCase()} Agent** is now working on this issue.`,
    });

    logger.info({ issueNumber, agentType }, 'Agent claimed issue');

    // Refresh backlog cache
    await refreshBacklogCache();

    return true;
  } catch (error) {
    logger.error({ error, issueNumber, agentType }, 'Failed to claim issue');
    return false;
  }
}

/**
 * Complete an issue - set to done or review
 */
export async function completeIssue(
  issueNumber: number,
  agentType: string,
  setToReview = false,
  completionComment?: string
): Promise<boolean> {
  const owner = process.env.GITHUB_ORG || 'Brunzendorf';
  const repo = 'SHIBC-AITO';

  try {
    const gh = getOctokit();

    // Update status
    const newStatus = setToReview ? 'REVIEW' : 'DONE';
    await updateIssueStatus(issueNumber, newStatus, agentType);

    // Add completion comment
    const comment = completionComment ||
      (setToReview
        ? `✅ **${agentType.toUpperCase()} Agent** has completed work and moved this to review.`
        : `✅ **${agentType.toUpperCase()} Agent** has completed this issue.`);

    await gh.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: comment,
    });

    // Close issue if done (not review)
    if (!setToReview) {
      await gh.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        state: 'closed',
      });
    }

    logger.info({ issueNumber, agentType, setToReview }, 'Agent completed issue');

    return true;
  } catch (error) {
    logger.error({ error, issueNumber, agentType }, 'Failed to complete issue');
    return false;
  }
}

/**
 * Refresh the backlog cache in Redis after status changes
 */
async function refreshBacklogCache(): Promise<void> {
  try {
    const owner = process.env.GITHUB_ORG || 'Brunzendorf';
    const repo = 'SHIBC-AITO';
    const gh = getOctokit();

    // Fetch all open issues
    const issues = await gh.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: 100,
    });

    const backlogData = {
      issues: issues.data.map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body,
        labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name || '')),
        state: issue.state,
        created_at: issue.created_at,
        assignee: issue.assignee?.login,
        html_url: issue.html_url,
      })),
      lastGroomed: new Date().toISOString(),
    };

    await redis.set('context:backlog', JSON.stringify(backlogData));
    logger.debug({ issueCount: issues.data.length }, 'Refreshed backlog cache');
  } catch (error) {
    logger.warn({ error }, 'Failed to refresh backlog cache');
  }
}
