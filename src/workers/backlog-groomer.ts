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
import type { EventType } from '../lib/types.js';

const logger = createLogger('backlog-groomer');

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
 * Send prioritization request to CEO
 */
async function requestCEOPrioritization(issues: GithubIssue[]): Promise<void> {
  // Filter backlog issues that are ready for prioritization
  const readyForPrio = issues.filter(i =>
    !isInProgress(i) &&
    !i.labels.includes('needs-estimate') &&
    !i.labels.includes('duplicate') &&
    !i.labels.includes('subtask') // Subtasks are prioritized via their epic
  );

  if (readyForPrio.length === 0) {
    logger.info('No issues ready for prioritization');
    return;
  }

  // Get market context for prioritization
  const marketContext = await buildDataContext();

  // Find CEO agent
  const ceoAgent = await agentRepo.findByType('ceo');
  if (!ceoAgent) {
    logger.warn('CEO agent not found');
    return;
  }

  // Build prioritization task
  const issueList = readyForPrio.slice(0, 20).map(i => {
    const effortMatch = i.body?.match(/effort[:\s]+(\d+)/i);
    const revenueMatch = i.body?.match(/revenue[:\s]+(\d+)|impact[:\s]+(\d+)/i);
    const effort = effortMatch ? effortMatch[1] : '?';
    const revenue = revenueMatch ? (revenueMatch[1] || revenueMatch[2]) : '?';
    const labels = i.labels.filter(l => !l.startsWith('status:')).join(', ');
    return `#${i.number}: ${i.title} [E:${effort} R:${revenue}] (${labels})`;
  }).join('\n');

  const prioritizationTask = {
    type: 'task' as const,
    from: 'backlog-groomer',
    to: ceoAgent.id,
    payload: {
      task_id: `prio-${Date.now()}`,
      title: 'Backlog Prioritization Review',
      description: `## Backlog Prioritization Required

The backlog has ${readyForPrio.length} issues ready for prioritization.

### Current Market Context
${marketContext}

### Issues to Prioritize (Top 20)
${issueList}

### Your Task
1. Review the issues in context of current market conditions
2. Set priority labels: priority:critical, priority:high, priority:medium, priority:low
3. Move top 3-5 highest priority to status:ready

Use this action to update priorities:
\`\`\`json
{
  "actions": [
    {"type": "update_issue", "data": {"issueNumber": 42, "comment": "Priority set to high based on market conditions"}},
    {"type": "spawn_worker", "task": "Add label priority:high to issue 42", "servers": ["fetch"]}
  ]
}
\`\`\`
`,
      deadline: new Date(Date.now() + 3600000).toISOString(), // 1 hour
    },
    priority: 'high' as const,
    timestamp: new Date(),
    requiresResponse: false,
  };

  // Publish to CEO's channel
  await publisher.publish(channels.agent(ceoAgent.id), JSON.stringify({
    id: `grooming-prio-${Date.now()}`,
    ...prioritizationTask,
  }));

  // Log event
  await eventRepo.log({
    eventType: 'backlog_grooming' as EventType,
    sourceAgent: 'backlog-groomer',
    targetAgent: ceoAgent.id,
    payload: {
      action: 'prioritization_request',
      issueCount: readyForPrio.length,
    },
  });

  logger.info({
    issueCount: readyForPrio.length,
    ceoId: ceoAgent.id,
  }, 'Sent prioritization request to CEO');
}

/**
 * Index all issues to RAG for semantic search
 */
async function indexIssuesToRAG(issues: GithubIssue[]): Promise<void> {
  for (const issue of issues) {
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
  }

  logger.info({ count: issues.length }, 'Indexed issues to RAG');
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

    // 2. Index issues to RAG for semantic search
    await indexIssuesToRAG(issues);

    // 3. Detect duplicates
    const duplicates = await findDuplicates(issues);
    result.duplicatesFound = Array.from(duplicates.values()).flat().length;

    if (duplicates.size > 0) {
      await closeDuplicates(duplicates);
    }

    // 4. Find related issues and create epics
    const relatedGroups = await findRelatedGroups(issues);
    for (const [theme, issueNums] of relatedGroups) {
      const epicNum = await createEpic(theme, issueNums, issues);
      if (epicNum) result.epicsCreated++;
    }

    // 5. Validate estimates
    result.issuesValidated = await validateEstimates(issues);

    // 6. Update backlog context in Redis
    await updateBacklogContext(issues);

    // 7. Request CEO prioritization
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
