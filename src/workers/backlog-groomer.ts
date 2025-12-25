/**
 * Backlog Grooming Worker
 *
 * Runs every 3 hours to maintain backlog quality:
 * 1. Duplicate detection via RAG semantic similarity
 * 2. Group related issues into Epics with subtasks
 * 3. Validate effort/revenue estimates
 * 4. Check description completeness
 * 5. CEO prioritization based on market data
 */

import { createLogger } from '../lib/logger.js';
import { search, indexDocument } from '../lib/rag.js';
import { redis, publisher, channels } from '../lib/redis.js';
import { agentRepo, eventRepo } from '../lib/db.js';
import { Octokit } from '@octokit/rest';
import { buildDataContext } from '../lib/data-fetcher.js';
import { triageIssues, formatTriageForCEO, getFocusSettings } from '../lib/triage.js';
import type { EventType } from '../lib/types.js';

const logger = createLogger('backlog-groomer');

// GitHub Rate Limiting
// Secondary rate limit: 80 content-generating requests per minute
// We use a conservative 60/minute to stay safe (1 request per second)
const RATE_LIMIT_DELAY_MS = 1000; // 1 second between write operations
let lastWriteTime = 0;

async function rateLimitedWrite<T>(operation: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const timeSinceLastWrite = now - lastWriteTime;

  if (timeSinceLastWrite < RATE_LIMIT_DELAY_MS) {
    const waitTime = RATE_LIMIT_DELAY_MS - timeSinceLastWrite;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  lastWriteTime = Date.now();
  return operation();
}

// GitHub client
let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN not set');
    octokit = new Octokit({ auth: token });
  }
  return octokit;
}

const GITHUB_OWNER = process.env.GITHUB_ORG || 'Brunzendorf';
const GITHUB_REPO = process.env.GITHUB_REPO || 'SHIBC-AITO';

// Issue status labels
const STATUS_LABELS = {
  BACKLOG: 'status:backlog',
  READY: 'status:ready',
  IN_PROGRESS: 'status:in-progress',
  REVIEW: 'status:review',
  BLOCKED: 'status:blocked',
  DONE: 'status:done',
};

// Similarity threshold for duplicate detection (0-1)
const DUPLICATE_THRESHOLD = 0.85;
const RELATED_THRESHOLD = 0.70;

interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  state: string;
  created_at: string;
  updated_at: string;
  assignee?: string;
}

interface GroomingResult {
  totalIssues: number;
  duplicatesFound: number;
  epicsCreated: number;
  issuesValidated: number;
  prioritized: number;
}

/**
 * Fetch all open issues from GitHub
 */
async function fetchOpenIssues(): Promise<GithubIssue[]> {
  const gh = getOctokit();
  const issues: GithubIssue[] = [];

  let page = 1;
  while (true) {
    const response = await gh.issues.listForRepo({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      state: 'open',
      per_page: 100,
      page,
    });

    if (response.data.length === 0) break;

    for (const issue of response.data) {
      // Skip pull requests
      if (issue.pull_request) continue;

      issues.push({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? null,
        labels: issue.labels.map(l => typeof l === 'string' ? l : l.name || ''),
        state: issue.state,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        assignee: issue.assignee?.login ?? undefined,
      });
    }

    page++;
    if (response.data.length < 100) break;
  }

  return issues;
}

/**
 * Check if issue is in progress (locked from grooming)
 */
function isInProgress(issue: GithubIssue): boolean {
  return issue.labels.includes(STATUS_LABELS.IN_PROGRESS) ||
         issue.labels.includes(STATUS_LABELS.REVIEW);
}

/**
 * Detect duplicates using RAG semantic similarity
 */
async function findDuplicates(issues: GithubIssue[]): Promise<Map<number, number[]>> {
  const duplicateMap = new Map<number, number[]>(); // original -> duplicates[]
  const processed = new Set<number>();

  for (const issue of issues) {
    if (processed.has(issue.number)) continue;
    if (isInProgress(issue)) continue; // Don't touch in-progress

    const searchText = `${issue.title} ${issue.body || ''}`;
    const results = await search(searchText, 5);

    const duplicates: number[] = [];

    for (const result of results) {
      // Check if result is another issue (source format: "github/issue/123")
      const issueMatch = result.source.match(/github\/issue\/(\d+)/);
      if (!issueMatch) continue;

      const otherNumber = parseInt(issueMatch[1]);
      if (otherNumber === issue.number) continue;
      if (processed.has(otherNumber)) continue;

      // Check similarity score
      if (result.score >= DUPLICATE_THRESHOLD) {
        duplicates.push(otherNumber);
        processed.add(otherNumber);
        logger.info({
          original: issue.number,
          duplicate: otherNumber,
          score: result.score,
        }, 'Found duplicate issue');
      }
    }

    if (duplicates.length > 0) {
      duplicateMap.set(issue.number, duplicates);
    }
    processed.add(issue.number);
  }

  return duplicateMap;
}

/**
 * Find related issues that could form an Epic
 */
async function findRelatedGroups(issues: GithubIssue[]): Promise<Map<string, number[]>> {
  const groups = new Map<string, number[]>(); // theme -> issue numbers
  const processed = new Set<number>();

  // Skip issues that are already in progress or are epics
  const backlogIssues = issues.filter(i =>
    !isInProgress(i) &&
    !i.labels.includes('epic') &&
    !i.labels.includes('subtask')
  );

  for (const issue of backlogIssues) {
    if (processed.has(issue.number)) continue;

    const searchText = issue.title;
    const results = await search(searchText, 10);

    const related: number[] = [issue.number];

    for (const result of results) {
      const issueMatch = result.source.match(/github\/issue\/(\d+)/);
      if (!issueMatch) continue;

      const otherNumber = parseInt(issueMatch[1]);
      if (otherNumber === issue.number) continue;
      if (processed.has(otherNumber)) continue;

      // Check if related (lower threshold than duplicate)
      if (result.score >= RELATED_THRESHOLD && result.score < DUPLICATE_THRESHOLD) {
        const otherIssue = issues.find(i => i.number === otherNumber);
        if (otherIssue && !isInProgress(otherIssue)) {
          related.push(otherNumber);
        }
      }
    }

    // Only create group if 3+ related issues
    if (related.length >= 3) {
      // Extract common theme from titles
      const theme = extractTheme(related.map(n =>
        issues.find(i => i.number === n)?.title || ''
      ));

      if (theme) {
        groups.set(theme, related);
        related.forEach(n => processed.add(n));
        logger.info({ theme, issues: related }, 'Found related issue group');
      }
    }
  }

  return groups;
}

/**
 * Extract common theme from issue titles
 */
function extractTheme(titles: string[]): string | null {
  // Simple approach: find common keywords
  const wordCounts = new Map<string, number>();

  for (const title of titles) {
    const words = title.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3); // Skip short words

    const seen = new Set<string>();
    for (const word of words) {
      if (!seen.has(word)) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
        seen.add(word);
      }
    }
  }

  // Find words that appear in most titles
  const threshold = Math.ceil(titles.length * 0.6);
  const commonWords = Array.from(wordCounts.entries())
    .filter(([_, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);

  if (commonWords.length === 0) return null;

  return commonWords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Create Epic issue and convert related issues to subtasks
 */
async function createEpic(theme: string, issueNumbers: number[], issues: GithubIssue[]): Promise<number | null> {
  const gh = getOctokit();

  // Build epic description
  const relatedIssues = issueNumbers
    .map(n => issues.find(i => i.number === n))
    .filter(Boolean) as GithubIssue[];

  const subtaskList = relatedIssues
    .map(i => `- [ ] #${i.number} - ${i.title}`)
    .join('\n');

  const totalEffort = relatedIssues.reduce((sum, i) => {
    const effortMatch = i.body?.match(/effort[:\s]+(\d+)/i);
    return sum + (effortMatch ? parseInt(effortMatch[1]) : 3);
  }, 0);

  const body = `## Epic: ${theme}

This epic groups ${issueNumbers.length} related initiatives.

### Subtasks
${subtaskList}

### Metadata
- **Total Effort:** ${totalEffort}
- **Subtask Count:** ${issueNumbers.length}
- **Created by:** Backlog Groomer (automated)

---
*This epic was automatically created to group related initiatives.*`;

  try {
    const response = await gh.issues.create({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      title: `[Epic] ${theme}`,
      body,
      labels: ['epic', STATUS_LABELS.BACKLOG, 'auto-generated'],
    });

    // Add 'subtask' label and reference to all child issues
    for (const issueNum of issueNumbers) {
      await gh.issues.addLabels({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        issue_number: issueNum,
        labels: ['subtask'],
      });

      await gh.issues.createComment({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        issue_number: issueNum,
        body: `🔗 This issue is now part of Epic #${response.data.number}: **${theme}**`,
      });
    }

    logger.info({
      epicNumber: response.data.number,
      theme,
      subtasks: issueNumbers,
    }, 'Created epic with subtasks');

    return response.data.number;
  } catch (error) {
    logger.error({ error, theme }, 'Failed to create epic');
    return null;
  }
}

/**
 * Close duplicate issues with reference to original
 */
async function closeDuplicates(duplicateMap: Map<number, number[]>): Promise<number> {
  const gh = getOctokit();
  let closed = 0;

  for (const [original, duplicates] of duplicateMap) {
    for (const duplicate of duplicates) {
      try {
        await gh.issues.createComment({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          issue_number: duplicate,
          body: `🔄 **Duplicate detected**\n\nThis issue appears to be a duplicate of #${original}.\nClosing as duplicate - please continue discussion in the original issue.\n\n*Detected by Backlog Groomer*`,
        });

        await gh.issues.update({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          issue_number: duplicate,
          state: 'closed',
          labels: ['duplicate'],
        });

        closed++;
        logger.info({ duplicate, original }, 'Closed duplicate issue');
      } catch (error) {
        logger.error({ error, duplicate }, 'Failed to close duplicate');
      }
    }
  }

  return closed;
}

/**
 * Validate effort and revenue estimates
 */
async function validateEstimates(issues: GithubIssue[]): Promise<number> {
  const gh = getOctokit();
  let validated = 0;

  for (const issue of issues) {
    if (isInProgress(issue)) continue;

    const body = issue.body || '';
    const hasEffort = /effort[:\s]+\d+/i.test(body);
    const hasRevenue = /revenue[:\s]+\d+|impact[:\s]+\d+/i.test(body);

    // Check if missing estimates
    if (!hasEffort || !hasRevenue) {
      const missingFields: string[] = [];
      if (!hasEffort) missingFields.push('Effort (1-10)');
      if (!hasRevenue) missingFields.push('Revenue Impact (1-10)');

      // Add comment requesting estimates
      const existingComments = await gh.issues.listComments({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        issue_number: issue.number,
      });

      const alreadyRequested = existingComments.data.some(c =>
        c.body?.includes('Missing estimates')
      );

      if (!alreadyRequested) {
        await gh.issues.createComment({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          issue_number: issue.number,
          body: `⚠️ **Missing estimates**\n\nThis initiative needs the following before it can be prioritized:\n${missingFields.map(f => `- ${f}`).join('\n')}\n\nPlease update the issue description with these estimates.\n\n*Backlog Groomer*`,
        });

        // Add needs-estimate label
        await gh.issues.addLabels({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          issue_number: issue.number,
          labels: ['needs-estimate'],
        });
      }
    } else {
      // Remove needs-estimate label if present and estimates are complete
      if (issue.labels.includes('needs-estimate')) {
        try {
          await gh.issues.removeLabel({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            issue_number: issue.number,
            name: 'needs-estimate',
          });
        } catch {
          // Label might not exist
        }
      }
      validated++;
    }
  }

  return validated;
}

/**
 * Automatically set top issues to status:ready per agent
 * Ensures agents always have work in their ready queue
 *
 * Logic:
 * - For each agent (cto, cmo, cfo, coo, cco, dao)
 * - Find issues with that agent label AND a priority label
 * - Skip issues already in ready/in-progress/review/blocked
 * - Set top 2 issues to status:ready
 */
async function autoSetReadyIssues(issues: GithubIssue[]): Promise<number> {
  const gh = getOctokit();
  const agents = ['ceo', 'cto', 'cmo', 'cfo', 'coo', 'cco', 'dao'];
  let totalSet = 0;

  // Priority order for scoring
  const priorityScore: Record<string, number> = {
    'priority:critical': 4,
    'priority:high': 3,
    'priority:medium': 2,
    'priority:low': 1,
  };

  for (const agent of agents) {
    // Find issues for this agent that could be moved to ready
    const agentIssues = issues.filter(i => {
      const hasAgent = i.labels.includes(`agent:${agent}`);
      const hasPriority = i.labels.some(l => l.startsWith('priority:'));
      const notReady = !i.labels.includes(STATUS_LABELS.READY);
      const notInProgress = !i.labels.includes(STATUS_LABELS.IN_PROGRESS);
      const notReview = !i.labels.includes(STATUS_LABELS.REVIEW);
      const notBlocked = !i.labels.includes(STATUS_LABELS.BLOCKED);
      const notDone = !i.labels.includes(STATUS_LABELS.DONE);
      const notNeedsEstimate = !i.labels.includes('needs-estimate');
      const notDuplicate = !i.labels.includes('duplicate');
      const notSubtask = !i.labels.includes('subtask');

      return hasAgent && hasPriority && notReady && notInProgress &&
             notReview && notBlocked && notDone && notNeedsEstimate &&
             notDuplicate && notSubtask;
    });

    // Skip if already has ready issues (check current ready count)
    const currentReadyCount = issues.filter(i =>
      i.labels.includes(`agent:${agent}`) &&
      i.labels.includes(STATUS_LABELS.READY)
    ).length;

    if (currentReadyCount >= 2) {
      logger.debug({ agent, currentReadyCount }, 'Agent already has enough ready issues');
      continue;
    }

    // Sort by priority (critical > high > medium > low)
    const sorted = agentIssues.sort((a, b) => {
      const scoreA = a.labels.reduce((s, l) => s + (priorityScore[l] || 0), 0);
      const scoreB = b.labels.reduce((s, l) => s + (priorityScore[l] || 0), 0);
      return scoreB - scoreA;
    });

    // Set top N to ready (up to 2 - currentReadyCount)
    const toSet = sorted.slice(0, 2 - currentReadyCount);

    for (const issue of toSet) {
      try {
        // Remove status:backlog if present (rate-limited)
        if (issue.labels.includes(STATUS_LABELS.BACKLOG)) {
          try {
            await rateLimitedWrite(() => gh.issues.removeLabel({
              owner: GITHUB_OWNER,
              repo: GITHUB_REPO,
              issue_number: issue.number,
              name: STATUS_LABELS.BACKLOG,
            }));
          } catch {
            // Label might not exist
          }
        }

        // Add status:ready (rate-limited)
        await rateLimitedWrite(() => gh.issues.addLabels({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          issue_number: issue.number,
          labels: [STATUS_LABELS.READY],
        }));

        logger.info({
          agent,
          issueNumber: issue.number,
          title: issue.title,
        }, 'Auto-set issue to status:ready');

        totalSet++;
      } catch (error) {
        logger.warn({ error, issueNumber: issue.number }, 'Failed to set status:ready');
      }
    }
  }

  return totalSet;
}

/**
 * Send prioritization request to CEO with focus-based triage suggestions
 */
async function requestCEOPrioritization(issues: GithubIssue[]): Promise<void> {
  // Filter backlog issues that need triage (no agent assigned yet)
  const needsTriage = issues.filter(i =>
    !isInProgress(i) &&
    !i.labels.includes('needs-estimate') &&
    !i.labels.includes('duplicate') &&
    !i.labels.includes('subtask') &&
    !i.labels.some(l => l.startsWith('agent:')) // No agent assigned yet
  );

  // Filter issues that are triaged but need prioritization
  const readyForPrio = issues.filter(i =>
    !isInProgress(i) &&
    !i.labels.includes('needs-estimate') &&
    !i.labels.includes('duplicate') &&
    !i.labels.includes('subtask') &&
    i.labels.some(l => l.startsWith('agent:')) && // Has agent
    !i.labels.some(l => l.startsWith('priority:')) // But no priority
  );

  if (needsTriage.length === 0 && readyForPrio.length === 0) {
    logger.info('No issues need triage or prioritization');
    return;
  }

  // Find CEO agent
  const ceoAgent = await agentRepo.findByType('ceo');
  if (!ceoAgent) {
    logger.warn('CEO agent not found');
    return;
  }

  // Get focus settings and triage suggestions
  const focusSettings = await getFocusSettings();
  const triageResults = await triageIssues(needsTriage.map(i => ({
    number: i.number,
    title: i.title,
    body: i.body,
    labels: i.labels,
  })));

  // Format triage section
  const triageSection = triageResults.length > 0
    ? formatTriageForCEO(triageResults, focusSettings)
    : '';

  // Get market context for prioritization
  const marketContext = await buildDataContext();

  // Build prioritization list for already-triaged issues
  const prioList = readyForPrio.slice(0, 10).map(i => {
    const effortMatch = i.body?.match(/effort[:\s]+(\d+)/i);
    const revenueMatch = i.body?.match(/revenue[:\s]+(\d+)|impact[:\s]+(\d+)/i);
    const effort = effortMatch ? effortMatch[1] : '?';
    const revenue = revenueMatch ? (revenueMatch[1] || revenueMatch[2]) : '?';
    const agent = i.labels.find(l => l.startsWith('agent:'))?.replace('agent:', '').toUpperCase() || '?';
    return `#${i.number}: ${i.title} [Agent: ${agent}, E:${effort} R:${revenue}]`;
  }).join('\n');

  const prioritizationTask = {
    type: 'task' as const,
    from: 'backlog-groomer',
    to: ceoAgent.id,
    payload: {
      task_id: `prio-${Date.now()}`,
      title: 'Backlog Triage & Prioritization',
      description: `## Backlog Management Required

### Summary
- **${needsTriage.length}** issues need triage (agent assignment)
- **${readyForPrio.length}** issues need prioritization

---

${triageSection}

${readyForPrio.length > 0 ? `
---

## Issues Needing Priority Assignment

These issues have agents assigned but need priority labels:

${prioList}

**Set priorities with:**
\`\`\`json
{
  "actions": [{
    "type": "spawn_worker",
    "task": "Action: triage\\nIssue: #42\\nPriority: high\\nReason: Market opportunity",
    "agent": "issue-manager"
  }]
}
\`\`\`
` : ''}

---

### Current Market Context
${marketContext}

---

## Your Task as CEO

1. **Review triage suggestions** - Accept or override agent assignments
2. **Set priorities** - critical/high/medium/low based on focus settings
3. **Move to ready** - Top 3-5 issues should go to status:ready

**Focus Alignment:** ${focusSettings.marketingVsDev > 50 ? 'Marketing-heavy' : 'Development-heavy'}, Revenue: ${focusSettings.revenueFocus}%
`,
      deadline: new Date(Date.now() + 3600000).toISOString(),
    },
    priority: 'high' as const,
    timestamp: new Date(),
    requiresResponse: false,
  };

  // Publish to CEO's channel
  await publisher.publish(channels.agent(ceoAgent.id), JSON.stringify({
    id: `grooming-triage-${Date.now()}`,
    ...prioritizationTask,
  }));

  // Log event
  await eventRepo.log({
    eventType: 'backlog_grooming' as EventType,
    sourceAgent: 'backlog-groomer',
    targetAgent: ceoAgent.id,
    payload: {
      action: 'triage_request',
      needsTriage: needsTriage.length,
      needsPriority: readyForPrio.length,
      focusSettings: {
        marketingVsDev: focusSettings.marketingVsDev,
        revenueFocus: focusSettings.revenueFocus,
      },
    },
  });

  logger.info({
    needsTriage: needsTriage.length,
    needsPriority: readyForPrio.length,
    triageSuggestions: triageResults.length,
    ceoId: ceoAgent.id,
  }, 'Sent triage request to CEO with focus-based suggestions');
}

/**
 * Index only NEW or UPDATED issues to RAG for semantic search
 * Uses Redis to track last indexed timestamp per issue
 */
async function indexIssuesToRAG(issues: GithubIssue[]): Promise<void> {
  const REDIS_KEY_PREFIX = 'rag:issue:lastIndexed:';
  let indexedCount = 0;
  let skippedCount = 0;

  for (const issue of issues) {
    // Check if issue was updated since last indexing
    const lastIndexedKey = `${REDIS_KEY_PREFIX}${issue.number}`;
    const lastIndexed = await redis.get(lastIndexedKey);
    const issueUpdated = new Date(issue.updated_at).getTime();

    // Skip if already indexed and not updated
    if (lastIndexed && parseInt(lastIndexed) >= issueUpdated) {
      skippedCount++;
      continue;
    }

    const content = `Issue #${issue.number}: ${issue.title}\n\n${issue.body || ''}\n\nLabels: ${issue.labels.join(', ')}`;

    await indexDocument(
      content,
      `github/issue/${issue.number}`,
      'project_doc',
      {
        issueNumber: issue.number,
        status: issue.labels.find(l => l.startsWith('status:')) || 'unknown',
        created: issue.created_at,
      }
    );

    // Mark as indexed with current timestamp
    await redis.set(lastIndexedKey, Date.now().toString());
    indexedCount++;
  }

  logger.info({
    total: issues.length,
    indexed: indexedCount,
    skipped: skippedCount
  }, 'RAG indexing completed (only new/updated issues)');
}

/**
 * Store current backlog state in Redis for agent context
 */
async function updateBacklogContext(issues: GithubIssue[]): Promise<void> {
  const backlogState = {
    timestamp: new Date().toISOString(),
    total: issues.length,
    byStatus: {
      backlog: issues.filter(i => i.labels.includes(STATUS_LABELS.BACKLOG)).length,
      ready: issues.filter(i => i.labels.includes(STATUS_LABELS.READY)).length,
      inProgress: issues.filter(i => i.labels.includes(STATUS_LABELS.IN_PROGRESS)).length,
      review: issues.filter(i => i.labels.includes(STATUS_LABELS.REVIEW)).length,
      blocked: issues.filter(i => i.labels.includes(STATUS_LABELS.BLOCKED)).length,
    },
    // Full issues array for dashboard Kanban board
    issues: issues.map(i => ({
      number: i.number,
      title: i.title,
      body: i.body,
      labels: i.labels,
      state: i.state,
      created_at: i.created_at,
      assignee: i.assignee,
      html_url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${i.number}`,
    })),
    inProgress: issues
      .filter(i => isInProgress(i))
      .map(i => ({
        number: i.number,
        title: i.title,
        assignee: i.assignee,
      })),
    highPriority: issues
      .filter(i => i.labels.includes('priority:critical') || i.labels.includes('priority:high'))
      .slice(0, 10)
      .map(i => `#${i.number}: ${i.title}`),
  };

  // Store in Redis with 4 hour TTL (refreshed every 3 hours)
  await redis.setex('context:backlog', 14400, JSON.stringify(backlogState));

  logger.info({
    total: backlogState.total,
    inProgress: backlogState.byStatus.inProgress,
  }, 'Updated backlog context in Redis');
}

/**
 * Main grooming function
 */
export async function runBacklogGrooming(): Promise<GroomingResult> {
  logger.info('Starting backlog grooming...');

  const result: GroomingResult = {
    totalIssues: 0,
    duplicatesFound: 0,
    epicsCreated: 0,
    issuesValidated: 0,
    prioritized: 0,
  };

  try {
    // 1. Fetch all open issues
    const issues = await fetchOpenIssues();
    result.totalIssues = issues.length;
    logger.info({ count: issues.length }, 'Fetched open issues');

    // 2. AUTO-READY FIRST! Set top issues to status:ready per agent
    // This is the MOST CRITICAL step - runs before anything else to avoid rate limits
    try {
      const autoReadyCount = await autoSetReadyIssues(issues);
      logger.info({ autoReadyCount }, 'Auto-set issues to status:ready');
    } catch (readyError) {
      logger.warn({ error: readyError }, 'Auto-ready failed, continuing');
    }

    // 3. Update backlog context in Redis - CRITICAL for agent Kanban views
    await updateBacklogContext(issues);

    // 4. Index issues to RAG for semantic search (non-blocking - RAG may be unavailable)
    // TASK-100 FIX: Wrap in try-catch so grooming continues even if Ollama is down
    let ragAvailable = false;
    try {
      await indexIssuesToRAG(issues);
      ragAvailable = true;
    } catch (ragError) {
      logger.warn({ error: ragError }, 'RAG indexing failed, continuing without semantic search');
    }

    // 5. Detect duplicates (only if RAG is available)
    if (ragAvailable) {
      try {
        const duplicates = await findDuplicates(issues);
        result.duplicatesFound = Array.from(duplicates.values()).flat().length;

        if (duplicates.size > 0) {
          await closeDuplicates(duplicates);
        }
      } catch (dupError) {
        logger.warn({ error: dupError }, 'Duplicate detection failed, skipping');
      }
    } else {
      logger.info('Skipping duplicate detection (RAG unavailable)');
    }

    // 6. Find related issues and create epics (only if RAG is available)
    if (ragAvailable) {
      try {
        const relatedGroups = await findRelatedGroups(issues);
        for (const [theme, issueNums] of relatedGroups) {
          const epicNum = await createEpic(theme, issueNums, issues);
          if (epicNum) result.epicsCreated++;
        }
      } catch (epicError) {
        logger.warn({ error: epicError }, 'Epic creation failed, skipping');
      }
    } else {
      logger.info('Skipping epic creation (RAG unavailable)');
    }

    // 7. Validate estimates (lower priority - can fail without breaking workflow)
    try {
      result.issuesValidated = await validateEstimates(issues);
    } catch (validateError) {
      logger.warn({ error: validateError }, 'Estimate validation failed, skipping');
    }

    // 8. Request CEO prioritization (optional - informational only)
    await requestCEOPrioritization(issues);
    result.prioritized = issues.filter(i =>
      !i.labels.includes('needs-estimate') && !isInProgress(i)
    ).length;

    logger.info(result, 'Backlog grooming complete');

    // Log event
    await eventRepo.log({
      eventType: 'backlog_grooming' as EventType,
      sourceAgent: 'backlog-groomer',
      payload: result,
    });

    return result;
  } catch (error) {
    logger.error({ error }, 'Backlog grooming failed');
    throw error;
  }
}

/**
 * Get backlog stats for dashboard
 */
export async function getBacklogStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  lastGrooming: string | null;
}> {
  const cached = await redis.get('context:backlog');
  if (cached) {
    const data = JSON.parse(cached);
    return {
      total: data.total,
      byStatus: data.byStatus,
      lastGrooming: data.timestamp,
    };
  }

  return {
    total: 0,
    byStatus: {},
    lastGrooming: null,
  };
}
