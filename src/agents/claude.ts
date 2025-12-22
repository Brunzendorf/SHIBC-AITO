/**
 * Claude Code Wrapper
 * Executes Claude Code CLI with agent context
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { createLogger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import type { AgentProfile } from './profile.js';

const logger = createLogger('claude');

/**
 * Kanban Issue for Scrumban workflow
 */
export interface KanbanIssue {
  number: number;
  title: string;
  body?: string;
  labels: string[];
  state: string;
  created_at: string;
  assignee?: string;
  html_url: string;
}

/**
 * Kanban issues grouped by status for an agent
 */
export interface AgentKanbanState {
  inProgress: KanbanIssue[];
  ready: KanbanIssue[];
  review: KanbanIssue[];
  blocked: KanbanIssue[];
}

/**
 * Fetch Kanban issues for a specific agent from Redis
 */
export async function getKanbanIssuesForAgent(agentType: string): Promise<AgentKanbanState> {
  const result: AgentKanbanState = {
    inProgress: [],
    ready: [],
    review: [],
    blocked: [],
  };

  try {
    const cached = await redis.get('context:backlog');
    if (!cached) {
      logger.debug('No backlog context found in Redis');
      return result;
    }

    const backlog = JSON.parse(cached);
    const issues: KanbanIssue[] = backlog.issues || [];
    const agentLabel = `agent:${agentType}`;

    for (const issue of issues) {
      const labels = issue.labels || [];
      const hasAgentLabel = labels.some((l: string) => l === agentLabel);

      // Check status labels
      const isInProgress = labels.some((l: string) => l === 'status:in-progress' || l === 'status:in_progress');
      const isReady = labels.some((l: string) => l === 'status:ready');
      const isReview = labels.some((l: string) => l === 'status:review');
      const isBlocked = labels.some((l: string) => l === 'status:blocked');

      // In-progress issues for this agent
      if (isInProgress && hasAgentLabel) {
        result.inProgress.push(issue);
      }
      // Ready issues for this agent
      else if (isReady && hasAgentLabel) {
        result.ready.push(issue);
      }
      // Review issues (all agents can see these)
      else if (isReview) {
        result.review.push(issue);
      }
      // Blocked issues for this agent
      else if (isBlocked && hasAgentLabel) {
        result.blocked.push(issue);
      }
    }

    logger.debug({
      agentType,
      inProgress: result.inProgress.length,
      ready: result.ready.length,
      review: result.review.length,
      blocked: result.blocked.length,
    }, 'Fetched Kanban issues for agent');

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.warn({ error: errMsg, agentType }, 'Failed to fetch Kanban issues');
  }

  return result;
}

// Retry configuration
export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 5000,      // 5 seconds initial delay
  maxDelayMs: 60000,      // 60 seconds max delay
  retryableErrors: [
    'overloaded_error',
    'overloaded',
    'rate_limit',
    'timeout',
    '529',
    '503',
    '502',
  ],
};

export interface ClaudeSession {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  timeout?: number; // ms
  maxRetries?: number; // Override default retries
  enableTools?: boolean; // Enable CLI tools (Read, Write, Edit, Bash) - defaults to true
}

export interface ClaudeResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  retryable?: boolean;
  retriesUsed?: number;
}

/**
 * Sleep helper for retry delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable (API overload, rate limit, etc.)
 */
export function isRetryableError(error: string | undefined, output: string): boolean {
  if (!error && !output) return false;

  const combined = ((error || '') + ' ' + output).toLowerCase();
  return RETRY_CONFIG.retryableErrors.some(e => combined.includes(e.toLowerCase()));
}

/**
 * Calculate delay with exponential backoff + jitter
 */
export function calculateBackoffDelay(attempt: number): number {
  const exponentialDelay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 1000; // 0-1 second jitter
  return Math.min(exponentialDelay + jitter, RETRY_CONFIG.maxDelayMs);
}

/**
 * Check if Claude Code CLI is available (single attempt)
 */
function checkClaudeOnce(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['--version'], {
      shell: false,
      stdio: 'pipe',
    });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}

/**
 * Check if Claude Code CLI is available with retries
 * This handles startup timing issues with shared volumes
 */
export async function isClaudeAvailable(retries = 3, delayMs = 2000): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const available = await checkClaudeOnce();
    if (available) {
      return true;
    }
    if (attempt < retries) {
      logger.debug({ attempt, retries }, 'Claude not available, retrying...');
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return false;
}

/**
 * Execute Claude Code CLI with a prompt
 */
export async function executeClaudeCode(session: ClaudeSession): Promise<ClaudeResult> {
  const startTime = Date.now();
  const timeout = session.timeout || 300000; // 5 minutes default

  logger.info({ promptLength: session.prompt.length, timeout }, 'Executing Claude Code');

  return new Promise((resolve) => {
    // Use --print for non-interactive mode
    // --tools default enables all tools (Bash, Edit, Read, Write, etc.)
    // --dangerously-skip-permissions bypasses permission dialogs (safe in sandbox)
    const args = ['--print'];

    // Add tools only if enabled (defaults to true)
    if (session.enableTools !== false) {
      args.push('--tools', 'default', '--dangerously-skip-permissions');
    }

    args.push(session.prompt);

    if (session.systemPrompt) {
      args.unshift('--system-prompt', session.systemPrompt);
    }

    // Use /app/workspace if it exists (agents), otherwise use current directory (orchestrator)
    const workingDir = existsSync('/app/workspace') ? '/app/workspace' : process.cwd();

    // Use shell: false to avoid escaping issues with multi-line prompts
    // stdin must be 'ignore' - otherwise Claude waits for input and hangs
    const proc = spawn('claude', args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: workingDir,
      env: {
        ...process.env,
        // Ensure non-interactive mode
        CI: 'true',
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      const durationMs = Date.now() - startTime;

      if (code === 0) {
        logger.info({ durationMs, outputLength: stdout.length }, 'Claude execution completed');
        resolve({
          success: true,
          output: stdout.trim(),
          durationMs,
        });
      } else {
        const errorMsg = stderr.trim() || 'Exit code: ' + code;
        const retryable = isRetryableError(errorMsg, stdout);
        logger.error({ code, stderr, durationMs, retryable }, 'Claude execution failed');
        resolve({
          success: false,
          output: stdout.trim(),
          error: errorMsg,
          durationMs,
          retryable,
        });
      }
    });

    proc.on('error', (error) => {
      const durationMs = Date.now() - startTime;
      const retryable = isRetryableError(error.message, '');
      logger.error({ error, durationMs, retryable }, 'Claude spawn error');
      resolve({
        success: false,
        output: '',
        error: error.message,
        durationMs,
        retryable,
      });
    });

    // Timeout handling
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      const durationMs = Date.now() - startTime;
      logger.warn({ timeout, durationMs }, 'Claude execution timed out');
      resolve({
        success: false,
        output: stdout.trim(),
        error: 'Execution timed out after ' + timeout + 'ms',
        durationMs,
        retryable: true, // Timeouts are retryable
      });
    }, timeout);

    proc.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Execute Claude Code CLI with automatic retry on transient errors
 * Uses exponential backoff for overload/rate limit errors
 */
export async function executeClaudeCodeWithRetry(session: ClaudeSession): Promise<ClaudeResult> {
  const maxRetries = session.maxRetries ?? RETRY_CONFIG.maxRetries;
  let lastResult: ClaudeResult | null = null;
  let totalDurationMs = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = calculateBackoffDelay(attempt - 1);
      logger.info({ attempt, delay, maxRetries }, 'Retrying Claude execution after delay');
      await sleep(delay);
    }

    const result = await executeClaudeCode(session);
    totalDurationMs += result.durationMs;
    lastResult = result;

    // Success - return immediately
    if (result.success) {
      if (attempt > 0) {
        logger.info({ attempt, totalDurationMs }, 'Claude execution succeeded after retry');
      }
      return { ...result, retriesUsed: attempt };
    }

    // Check if error is retryable
    if (!result.retryable) {
      logger.warn({ attempt, error: result.error }, 'Non-retryable error, giving up');
      return { ...result, retriesUsed: attempt };
    }

    // Log retry attempt
    logger.warn(
      { attempt, maxRetries, error: result.error },
      'Retryable error encountered, will retry'
    );
  }

  // All retries exhausted
  logger.error({ maxRetries, totalDurationMs }, 'All retry attempts exhausted');
  return {
    ...lastResult!,
    durationMs: totalDurationMs,
    retriesUsed: maxRetries,
  };
}

/**
 * Pending Decision for HEAD agents to vote on
 */
export interface PendingDecision {
  id: string;
  title: string;
  description?: string;
  tier: string;
  proposedBy?: string;
  createdAt: Date;
}

/**
 * Build context prompt for agent loop
 */
export interface PendingTask {
  title: string;
  description: string;
  priority: string;
  from: string;
}

export function buildLoopPrompt(
  profile: AgentProfile,
  state: Record<string, unknown>,
  trigger: { type: string; data?: unknown },
  pendingDecisions?: PendingDecision[],
  ragContext?: string,
  pendingTasks?: PendingTask[],
  kanbanIssues?: AgentKanbanState
): string {
  // Current date/time for agent awareness - CRITICAL for time-sensitive content
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const dayName = days[now.getUTCDay()];
  const monthName = months[now.getUTCMonth()];
  const dayOfMonth = now.getUTCDate();
  const year = now.getUTCFullYear();
  const currentTime = now.toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
  const quarter = 'Q' + (Math.floor(now.getUTCMonth() / 3) + 1);
  const humanDate = `${dayName}, ${monthName} ${dayOfMonth}, ${year}`;

  const parts = [
    '# Agent Loop Execution',
    '',
    '## Agent: ' + profile.name + ' (' + profile.codename + ')',
    '## Trigger: ' + trigger.type,
    '',
    '## 📅 CURRENT DATE & TIME (USE THIS!)',
    '⚠️ **TODAY IS: ' + humanDate + '**',
    '- **Day:** ' + dayName,
    '- **Date:** ' + year + '-' + String(now.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dayOfMonth).padStart(2, '0'),
    '- **Time (UTC):** ' + currentTime,
    '- **Quarter:** ' + quarter + ' ' + year,
    '',
    'When creating content, ALWAYS use the current date above. Do NOT guess the day.',
    '',
    '## Current State',
    '```json',
    JSON.stringify(state, null, 2),
    '```',
    '',
  ];

  if (trigger.data) {
    parts.push(
      '## Trigger Data',
      '```json',
      JSON.stringify(trigger.data, null, 2),
      '```',
      ''
    );
  }

  // Add RAG context if available
  if (ragContext) {
    parts.push(ragContext, '');
  }

  // Add pending tasks from queue - CRITICAL: Show tasks agents need to work on!
  if (pendingTasks && pendingTasks.length > 0) {
    parts.push(
      '## 📋 PENDING TASKS FOR YOU',
      '',
      '🚨 **YOU HAVE TASKS WAITING! Address these in your response!**',
      ''
    );
    for (const task of pendingTasks) {
      const priorityIcon = task.priority === 'critical' ? '🔴' : task.priority === 'high' ? '🟠' : '🟢';
      parts.push(
        '### ' + priorityIcon + ' ' + task.title,
        '- **Priority:** ' + task.priority.toUpperCase(),
        '- **From:** ' + task.from,
        task.description ? '- **Details:** ' + task.description.slice(0, 500) : '',
        ''
      );
    }
    parts.push(
      '**Respond to these tasks in your summary!** Acknowledge receipt and provide status/action.',
      ''
    );
  }

  // Add pending decisions for HEAD agents (CEO/DAO)
  if (pendingDecisions && pendingDecisions.length > 0 &&
      (profile.codename === 'ceo' || profile.codename === 'dao')) {
    parts.push(
      '## ⚠️ PENDING DECISIONS AWAITING YOUR VOTE',
      '',
      'You MUST vote on these decisions! Use the `vote` action for each.',
      ''
    );
    for (const decision of pendingDecisions) {
      parts.push(
        '### Decision: ' + decision.title,
        '- **ID:** `' + decision.id + '`',
        '- **Tier:** ' + decision.tier,
        '- **Proposed by:** ' + (decision.proposedBy || 'unknown'),
        '- **Created:** ' + decision.createdAt.toISOString(),
        decision.description ? '- **Description:** ' + decision.description : '',
        ''
      );
    }
    parts.push(
      'Use this format to vote:',
      '```json',
      '{ "type": "vote", "data": { "decisionId": "<id>", "vote": "approve|veto|abstain", "reason": "Your reasoning" } }',
      '```',
      ''
    );
  }

  // Add Kanban issues for Scrumban workflow
  if (kanbanIssues) {
    const hasAnyIssues = kanbanIssues.inProgress.length > 0 ||
                         kanbanIssues.ready.length > 0 ||
                         kanbanIssues.blocked.length > 0 ||
                         (kanbanIssues.review.length > 0 && (profile.codename === 'ceo' || profile.codename === 'dao'));

    if (hasAnyIssues) {
      parts.push(
        '## 📋 YOUR KANBAN BOARD',
        '',
        '**Scrumban Workflow - Manage issues via spawn_worker with issue-manager agent!**',
        ''
      );

      // In-Progress issues (agent MUST work on these)
      if (kanbanIssues.inProgress.length > 0) {
        parts.push(
          '### 🔵 IN PROGRESS (YOU ARE WORKING ON THESE)',
          ''
        );
        for (const issue of kanbanIssues.inProgress) {
          const priority = issue.labels.find((l: string) => l.startsWith('priority:'))?.replace('priority:', '') || 'normal';
          const priorityIcon = priority === 'critical' ? '🔴' : priority === 'high' ? '🟠' : '🟢';
          parts.push(
            `- ${priorityIcon} **#${issue.number}**: ${issue.title}`,
            `  - Priority: ${priority.toUpperCase()}`,
            `  - URL: ${issue.html_url}`,
            ''
          );
        }
        parts.push(
          '**⚠️ ACTION REQUIRED:** Continue work or mark complete with spawn_worker!',
          ''
        );
      }

      // Ready issues (agent can pick one)
      if (kanbanIssues.ready.length > 0) {
        parts.push(
          '### 🟢 READY TO PICK (ASSIGNED TO YOU)',
          ''
        );
        for (const issue of kanbanIssues.ready) {
          const priority = issue.labels.find((l: string) => l.startsWith('priority:'))?.replace('priority:', '') || 'normal';
          const priorityIcon = priority === 'critical' ? '🔴' : priority === 'high' ? '🟠' : '🟢';
          parts.push(
            `- ${priorityIcon} **#${issue.number}**: ${issue.title}`,
            `  - Priority: ${priority.toUpperCase()}`,
            ''
          );
        }
        if (kanbanIssues.inProgress.length === 0) {
          parts.push(
            '**⚠️ PICK ONE:** You have no in-progress issues. Pick a ready issue!',
            ''
          );
        }
      }

      // Blocked issues
      if (kanbanIssues.blocked.length > 0) {
        parts.push(
          '### 🚫 BLOCKED',
          ''
        );
        for (const issue of kanbanIssues.blocked) {
          parts.push(
            `- **#${issue.number}**: ${issue.title}`,
            ''
          );
        }
      }

      // Review issues (CEO/DAO can approve)
      if (kanbanIssues.review.length > 0 && (profile.codename === 'ceo' || profile.codename === 'dao')) {
        parts.push(
          '### 👁️ AWAITING YOUR REVIEW',
          ''
        );
        for (const issue of kanbanIssues.review) {
          const completedBy = issue.labels.find((l: string) => l.startsWith('agent:'))?.replace('agent:', '') || 'unknown';
          parts.push(
            `- **#${issue.number}**: ${issue.title}`,
            `  - Completed by: ${completedBy.toUpperCase()}`,
            ''
          );
        }
        parts.push(
          '**⚠️ ACTION REQUIRED:** Review and approve/reject these issues!',
          ''
        );
      }

      // Kanban actions help
      parts.push(
        '### Kanban Actions (via spawn_worker)',
        '',
        '**Pick issue:**',
        '```json',
        '{ "type": "spawn_worker", "task": "Action: pick\\nIssue: #42\\nAgent: ' + profile.codename + '", "servers": ["fetch"], "agent": "issue-manager" }',
        '```',
        '',
        '**Complete issue:**',
        '```json',
        '{ "type": "spawn_worker", "task": "Action: complete\\nIssue: #42\\nSummary: What was accomplished", "servers": ["fetch"], "agent": "issue-manager" }',
        '```',
        '',
        '**Update progress:**',
        '```json',
        '{ "type": "spawn_worker", "task": "Action: update\\nIssue: #42\\nStatus: Progress update here", "servers": ["fetch"], "agent": "issue-manager" }',
        '```',
        ''
      );
    }
  }

  parts.push(
    '## Instructions',
    'Execute your loop according to your profile.',
    'Analyze the current state and trigger.',
    'Take appropriate actions and return results.',
    '',
    '## 🚨 MANDATORY: Data Fetching Protocol',
    '',
    '**YOU MUST SPAWN WORKERS BEFORE REPORTING ANY DATA!**',
    '',
    '⛔ FORBIDDEN without spawn_worker first:',
    '- Stating prices, balances, or market data',
    '- Claiming treasury values or holder counts',
    '- Reporting metrics or KPIs',
    '- Any numbers that come from external sources',
    '',
    '✅ CORRECT WORKFLOW:',
    '1. FIRST action: spawn_worker to fetch real data',
    '2. WAIT for worker_result (next loop will have it)',
    '3. ONLY THEN report the actual numbers',
    '',
    '❌ WRONG: "Treasury at $187" without spawn_worker',
    '✅ RIGHT: spawn_worker → wait → then report real number',
    '',
    'If you need data but have no worker_result, say: "Data pending - spawned worker to fetch"',
    '',
    '## 🔍 PROACTIVE INTELLIGENCE GATHERING',
    '',
    '**You are an autonomous AI manager. DO NOT wait for information - SEARCH FOR IT!**',
    '',
    'You manage **Shiba Classic ($SHIBC)** - a real crypto project. Use spawn_worker with `fetch` to:',
    '',
    '### Project Sources to Monitor:',
    '- **GitHub:** https://github.com/Shiba-Classic - Check repos, PRs, issues, releases',
    '- **CoinGecko:** https://api.coingecko.com/api/v3/coins/shiba-classic-2 - Token data, description, links',
    '- **Website:** https://shibaclassic.io - Official announcements',
    '- **Etherscan:** Token contract, holder data, transactions',
    '',
    '### What to Search For:',
    '- Security audits, contract audits',
    '- Development progress, releases',
    '- Partnership announcements',
    '- Community updates',
    '- Market movements, whale activity',
    '',
    '### Example - Proactive Search:',
    '```json',
    '{"actions": [',
    '  {"type": "spawn_worker", "task": "Fetch https://api.coingecko.com/api/v3/coins/shiba-classic-2 and report project description, links, and any audit information", "servers": ["fetch"]}',
    ']}',
    '```',
    '',
    '**If you don\'t know something about YOUR OWN PROJECT - search for it! Don\'t assume or escalate blindly.**',
    '',
    '## IMPORTANT: You have TOOLS available!',
    '',
    'You are running with full tool access (Write, Edit, Read, Bash).',
    'Working directory: /app/workspace',
    '',
    '**For operational tasks (file writes, logs, status updates):**',
    '- DIRECTLY USE YOUR TOOLS to create/update files',
    '- Write to /app/workspace/' + profile.codename + '/ for your agent-specific files',
    '- Example: Use Write tool to create /app/workspace/' + profile.codename + '/status.md',
    '- After executing, include the action in your JSON response for tracking',
    '',
    '## Decision Tiers (choose the right one!)',
    '',
    '| Tier | Use For | Approval | Timeout |',
    '|------|---------|----------|---------|',
    '| operational | File writes, logs, status checks, internal tasks | None (auto-execute) | N/A |',
    '| minor | Task delegation, config changes, routine campaigns | CEO can veto (auto-approve after 4h) | 4h |',
    '| major | Budget >$500, partnerships, new initiatives | CEO + DAO required | 24h |',
    '| critical | Smart contracts, token burns, legal matters | CEO + DAO + Human | 48h |',
    '',
    '## Action Types',
    '',
    '### operational - Execute immediately with tools, then log',
    'For file operations: USE YOUR TOOLS DIRECTLY, then include in actions:',
    '```json',
    '{ "type": "operational", "data": { "title": "Created status report", "description": "Wrote status to /app/workspace/' + profile.codename + '/status.md", "filesCreated": ["status.md"] } }',
    '```',
    '',
    '### propose_decision - Formal decision with tier',
    '```json',
    '{ "type": "propose_decision", "data": { "tier": "minor|major|critical", "title": "...", "description": "...", "context": {...} } }',
    '```',
    '',
    '### create_task - Assign task to another agent',
    '```json',
    '{ "type": "create_task", "data": { "assignTo": "cmo|cto|cfo|coo|cco", "title": "...", "description": "...", "priority": "normal" } }',
    '```',
    '',
    '### vote - Cast vote on pending decision (CEO/DAO only)',
    '```json',
    '{ "type": "vote", "data": { "decisionId": "...", "vote": "approve|veto|abstain", "reason": "..." } }',
    '```',
    '',
    '### alert - Send alert to orchestrator',
    '```json',
    '{ "type": "alert", "data": { "alertType": "general|security|budget", "severity": "low|medium|high|critical", "message": "..." } }',
    '```',
    '',
    '### spawn_worker - Execute external API tasks via MCP workers',
    '⚠️ **USE THIS for ANY external data fetching!** (prices, balances, blockchain data)',
    '```json',
    '{ "type": "spawn_worker", "task": "Get ETH balance of 0x... from Etherscan", "servers": ["etherscan"], "timeout": 60000 }',
    '```',
    'Available servers: etherscan, fetch, filesystem, telegram (check your profile for which you can use)',
    '',
    '## Expected Output Format',
    'After using your tools for any file operations, output this JSON:',
    '```json',
    '{',
    '  "actions": [{ "type": "...", "data": {...} }],',
    '  "messages": [{ "to": "...", "content": "..." }],',
    '  "stateUpdates": { "key": "value" },',
    '  "summary": "Brief summary of what was done"',
    '}',
    '```'
  );

  return parts.join('\n');
}

/**
 * Parse Claude output as JSON
 */
export function parseClaudeOutput(output: string): {
  actions?: Array<{ type: string; data?: unknown }>;
  messages?: Array<{ to: string; content: string }>;
  stateUpdates?: Record<string, unknown>;
  summary?: string;
} | null {
  // Try to find JSON in the output
  const jsonMatch = output.match(/```json\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : output;

  try {
    return JSON.parse(jsonStr.trim());
  } catch {
    // Try to find any JSON object
    const objectMatch = output.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}



export interface ClaudeSessionWithMCP extends ClaudeSession {
  mcpConfigPath?: string;
}

/**
 * Execute Claude Code CLI with MCP config for native MCP tool access
 */
export async function executeClaudeCodeWithMCP(session: ClaudeSessionWithMCP): Promise<ClaudeResult> {
  const startTime = Date.now();
  const timeout = session.timeout || 300000;

  logger.info({ promptLength: session.prompt.length, timeout, mcpConfig: session.mcpConfigPath }, 'Executing Claude Code with MCP');

  return new Promise((resolve) => {
    const args = ['--print', '--dangerously-skip-permissions'];

    if (session.mcpConfigPath) {
      args.push('--mcp-config', session.mcpConfigPath);
    }

    if (session.systemPrompt) {
      args.push('--system-prompt', session.systemPrompt);
    }

    args.push(session.prompt);

    // Use /app/workspace if it exists (agents), otherwise use current directory (orchestrator)
    const workingDir = existsSync('/app/workspace') ? '/app/workspace' : process.cwd();

    const proc = spawn('claude', args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: workingDir,
      env: { ...process.env, CI: 'true' },
    });

    let stdout = '';
    let stderr = '';
    let lastLogTime = Date.now();
    const LOG_INTERVAL = 5000; // Log progress every 5 seconds

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Stream log: show first 200 chars of new data
      const now = Date.now();
      if (now - lastLogTime > LOG_INTERVAL) {
        logger.debug({ elapsed: now - startTime, totalLen: stdout.length, chunk: chunk.slice(0, 200) }, 'Claude MCP stdout chunk');
        lastLogTime = now;
      }
    });
    proc.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Always log stderr immediately
      logger.warn({ elapsed: Date.now() - startTime, stderr: chunk.slice(0, 500) }, 'Claude MCP stderr');
    });

    proc.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      if (code === 0) {
        logger.info({ durationMs, outputLength: stdout.length }, 'Claude MCP execution completed');
        resolve({ success: true, output: stdout.trim(), durationMs });
      } else {
        logger.error({ code, stderr, durationMs }, 'Claude MCP execution failed');
        resolve({ success: false, output: stdout.trim(), error: stderr.trim() || 'Exit code: ' + code, durationMs });
      }
    });

    proc.on('error', (error) => {
      const durationMs = Date.now() - startTime;
      logger.error({ error, durationMs }, 'Claude MCP spawn error');
      resolve({ success: false, output: '', error: error.message, durationMs });
    });

    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      logger.warn({ elapsed: Date.now() - startTime, stdoutLen: stdout.length }, 'Claude MCP timeout - killing process');
      resolve({ success: false, output: stdout.trim(), error: 'Execution timed out', durationMs: Date.now() - startTime });
    }, timeout);

    proc.on('close', () => clearTimeout(timeoutId));
  });
}

export interface ClaudeAgentSession {
  agent: string;        // Agent name from .claude/agents/ (e.g., 'pr-creator')
  prompt: string;
  timeout?: number;
  cwd?: string;
}

/**
 * Execute Claude Code CLI with a specific agent from .claude/agents/
 */
export async function executeClaudeAgent(session: ClaudeAgentSession): Promise<ClaudeResult> {
  const startTime = Date.now();
  const timeout = session.timeout || 120000;
  // Use /app/workspace if it exists (agents), otherwise use current directory (orchestrator)
  const cwd = session.cwd || (existsSync('/app/workspace') ? '/app/workspace' : process.cwd());

  logger.info({ agent: session.agent, promptLength: session.prompt.length, timeout }, 'Executing Claude Agent');

  return new Promise((resolve) => {
    const args = [
      '--print',
      '--dangerously-skip-permissions',
      '--agent', session.agent,
      session.prompt,
    ];

    const proc = spawn('claude', args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, CI: 'true' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      if (code === 0) {
        logger.info({ agent: session.agent, durationMs, outputLength: stdout.length }, 'Claude Agent execution completed');
        resolve({ success: true, output: stdout.trim(), durationMs });
      } else {
        logger.error({ agent: session.agent, code, stderr, durationMs }, 'Claude Agent execution failed');
        resolve({ success: false, output: stdout.trim(), error: stderr.trim() || 'Exit code: ' + code, durationMs });
      }
    });

    proc.on('error', (error) => {
      const durationMs = Date.now() - startTime;
      logger.error({ agent: session.agent, error, durationMs }, 'Claude Agent spawn error');
      resolve({ success: false, output: '', error: error.message, durationMs });
    });

    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ success: false, output: stdout.trim(), error: 'Execution timed out', durationMs: Date.now() - startTime });
    }, timeout);

    proc.on('close', () => clearTimeout(timeoutId));
  });
}

/**
 * Fallback execution using Ollama (when Claude unavailable)
 */
export async function executeOllamaFallback(
  prompt: string,
  model: string = 'llama3.2:3b'
): Promise<ClaudeResult> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const startTime = Date.now();

  logger.info({ model, ollamaUrl }, 'Using Ollama fallback');

  try {
    const response = await fetch(ollamaUrl + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error('Ollama returned ' + response.status);
    }

    const data = await response.json() as { response: string };
    const durationMs = Date.now() - startTime;

    return {
      success: true,
      output: data.response,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';

    return {
      success: false,
      output: '',
      error: 'Ollama fallback failed: ' + message,
      durationMs,
    };
  }
}
