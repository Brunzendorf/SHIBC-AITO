/**
 * Session Executor
 *
 * Drop-in replacement for executeClaudeCode that uses session pool
 * when SESSION_POOL_ENABLED=true, otherwise falls back to single-shot mode.
 *
 * This enables gradual migration from single-shot to persistent sessions
 * while maintaining backward compatibility.
 */

import { createLogger } from '../lib/logger.js';
import { getSessionPool, shutdownSessionPool } from './session-pool.js';
import {
  executeClaudeCodeWithRetry,
  type ClaudeResult,
} from './claude.js';
import type { AgentProfile } from './profile.js';
import type { AgentType } from '../lib/types.js';

const logger = createLogger('session-executor');

// Feature flag for session pool - checked at runtime to allow test overrides
function isSessionPoolEnabled(): boolean {
  return process.env.SESSION_POOL_ENABLED === 'true';
}

/**
 * Session executor configuration
 */
export interface SessionExecutorConfig {
  agentType: AgentType;
  profile: AgentProfile;
  mcpConfigPath?: string;
}

/**
 * Execute prompt using session pool (persistent session)
 * or fall back to single-shot mode
 */
export async function executeWithSession(
  config: SessionExecutorConfig,
  prompt: string,
  systemPrompt?: string,
  timeout = 300000
): Promise<ClaudeResult> {
  if (!isSessionPoolEnabled()) {
    // Fall back to single-shot mode
    logger.debug({ agentType: config.agentType }, 'Using single-shot mode (SESSION_POOL_ENABLED=false)');
    return executeClaudeCodeWithRetry({
      prompt,
      systemPrompt,
      timeout,
    });
  }

  const startTime = Date.now();
  logger.info({ agentType: config.agentType }, 'Using session pool mode');

  try {
    // Get or create session from pool
    const pool = getSessionPool();
    const session = await pool.getSession({
      agentType: config.agentType,
      profile: config.profile,
      mcpConfigPath: config.mcpConfigPath,
      maxLoops: parseInt(process.env.SESSION_MAX_LOOPS || '50', 10),
      idleTimeoutMs: parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || '1800000', 10), // 30 min default
    });

    // Execute the prompt in the session
    const response = await session.sendMessage(prompt, timeout);

    const durationMs = Date.now() - startTime;

    logger.info({
      agentType: config.agentType,
      sessionId: session.id,
      durationMs,
      responseLength: response.length,
    }, 'Session execution completed');

    return {
      success: true,
      output: response,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);

    logger.error({
      agentType: config.agentType,
      error: errMsg,
      durationMs,
    }, 'Session execution failed');

    // Check if error is retryable
    const retryable = isSessionRetryableError(errMsg);

    return {
      success: false,
      output: '',
      error: errMsg,
      durationMs,
      retryable,
    };
  }
}

/**
 * Check if a session error is retryable
 */
function isSessionRetryableError(error: string): boolean {
  const retryablePatterns = [
    'timeout',
    'session not running',
    'session is busy',
    'overload',
    'rate_limit',
    '529',
    '503',
    '502',
  ];

  const lowerError = error.toLowerCase();
  return retryablePatterns.some(p => lowerError.includes(p));
}

/**
 * Execute with session and automatic retry
 */
export async function executeWithSessionAndRetry(
  config: SessionExecutorConfig,
  prompt: string,
  systemPrompt?: string,
  timeout = 300000,
  maxRetries = 3
): Promise<ClaudeResult> {
  let lastResult: ClaudeResult | null = null;
  let totalDurationMs = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff
      const delay = 5000 * Math.pow(2, attempt - 1);
      logger.info({ attempt, delay }, 'Retrying session execution');
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    const result = await executeWithSession(config, prompt, systemPrompt, timeout);
    totalDurationMs += result.durationMs;
    lastResult = result;

    if (result.success) {
      return { ...result, retriesUsed: attempt };
    }

    if (!result.retryable) {
      logger.warn({ attempt, error: result.error }, 'Non-retryable error');
      return { ...result, retriesUsed: attempt };
    }
  }

  logger.error({ maxRetries, totalDurationMs }, 'All session retries exhausted');
  return {
    ...lastResult!,
    durationMs: totalDurationMs,
    retriesUsed: maxRetries,
  };
}

/**
 * Build an optimized loop prompt for session mode
 *
 * In session mode, we don't need to resend the full profile.
 * Only send the current trigger context and state delta.
 */
export function buildSessionLoopPrompt(
  trigger: { type: string; data?: unknown },
  state: Record<string, unknown>,
  options: {
    pendingDecisions?: Array<{ id: string; title: string; tier: string }>;
    pendingTasks?: Array<{ title: string; priority: string; from: string }>;
    ragContext?: string;
    kanbanIssues?: { inProgress: unknown[]; ready: unknown[] };
  } = {}
): string {
  const now = new Date();
  const humanDate = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const parts = [
    '# Loop Execution',
    '',
    `**Date:** ${humanDate}`,
    `**Time (UTC):** ${now.toISOString().split('T')[1].split('.')[0]}`,
    `**Trigger:** ${trigger.type}`,
    '',
  ];

  // State delta (only non-default values)
  const relevantState: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    // Skip internal state keys, only include business-relevant state
    if (!key.startsWith('_') && value !== null && value !== undefined) {
      relevantState[key] = value;
    }
  }

  if (Object.keys(relevantState).length > 0) {
    parts.push(
      '## Current State',
      '```json',
      JSON.stringify(relevantState, null, 2),
      '```',
      ''
    );
  }

  // Trigger data
  if (trigger.data) {
    parts.push(
      '## Trigger Data',
      '```json',
      JSON.stringify(trigger.data, null, 2),
      '```',
      ''
    );
  }

  // RAG context (shortened in session mode)
  if (options.ragContext) {
    parts.push(
      '## Relevant Context',
      options.ragContext.slice(0, 1000), // Limit to 1000 chars in session mode
      ''
    );
  }

  // Pending tasks (critical items only in session mode)
  if (options.pendingTasks && options.pendingTasks.length > 0) {
    const criticalTasks = options.pendingTasks.filter(t =>
      t.priority === 'critical' || t.priority === 'urgent' || t.priority === 'high'
    );
    if (criticalTasks.length > 0) {
      parts.push(
        '## Priority Tasks',
        criticalTasks.map(t => `- **[${t.priority.toUpperCase()}]** ${t.title} (from: ${t.from})`).join('\n'),
        ''
      );
    }
  }

  // Pending decisions (for HEAD agents)
  if (options.pendingDecisions && options.pendingDecisions.length > 0) {
    parts.push(
      '## Pending Decisions (Vote Required)',
      options.pendingDecisions.map(d => `- [${d.tier}] ${d.title} (ID: ${d.id})`).join('\n'),
      ''
    );
  }

  // Kanban status (summary only)
  if (options.kanbanIssues) {
    const inProgress = options.kanbanIssues.inProgress.length;
    const ready = options.kanbanIssues.ready.length;
    if (inProgress > 0 || ready > 0) {
      parts.push(
        '## Kanban Status',
        `- In Progress: ${inProgress}`,
        `- Ready to Pick: ${ready}`,
        ''
      );
    }
  }

  parts.push(
    '## Instructions',
    'Execute your loop. Return JSON with actions, messages, stateUpdates, and summary.',
    ''
  );

  return parts.join('\n');
}

/**
 * Get session pool statistics for monitoring
 */
export function getSessionPoolStats(): {
  enabled: boolean;
  stats: ReturnType<ReturnType<typeof getSessionPool>['getStats']> | null;
} {
  if (!isSessionPoolEnabled()) {
    return { enabled: false, stats: null };
  }

  try {
    const pool = getSessionPool();
    return {
      enabled: true,
      stats: pool.getStats(),
    };
  } catch (error) {
    return { enabled: false, stats: null };
  }
}

/**
 * Graceful shutdown of session pool
 */
export async function shutdownExecutor(): Promise<void> {
  if (isSessionPoolEnabled()) {
    await shutdownSessionPool();
  }
}

/**
 * Token usage estimation for monitoring
 *
 * Compares estimated token usage between modes
 */
export function estimateTokenUsage(
  profileLength: number,
  promptLength: number,
  mode: 'single-shot' | 'session'
): {
  inputTokens: number;
  description: string;
} {
  // Rough estimation: 1 token ≈ 4 characters
  const charsPerToken = 4;

  if (mode === 'single-shot') {
    // Full profile + prompt every time
    const totalChars = profileLength + promptLength;
    const tokens = Math.ceil(totalChars / charsPerToken);
    return {
      inputTokens: tokens,
      description: `Full profile (${Math.ceil(profileLength / charsPerToken)} tokens) + prompt (${Math.ceil(promptLength / charsPerToken)} tokens)`,
    };
  } else {
    // Session mode: Profile only once, then just prompt
    // Assuming profile is already in context, only count prompt
    const promptTokens = Math.ceil(promptLength / charsPerToken);
    // Add small overhead for session management
    const overhead = 100;
    return {
      inputTokens: promptTokens + overhead,
      description: `Prompt only (${promptTokens} tokens) + session overhead (${overhead} tokens)`,
    };
  }
}
