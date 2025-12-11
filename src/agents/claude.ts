/**
 * Claude Code Wrapper
 * Executes Claude Code CLI with agent context
 */

import { spawn } from 'child_process';
import { createLogger } from '../lib/logger.js';
import type { AgentProfile } from './profile.js';
import type { StateManager } from './state.js';

const logger = createLogger('claude');

export interface ClaudeSession {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  timeout?: number; // ms
}

export interface ClaudeResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

/**
 * Check if Claude Code CLI is available
 */
export async function isClaudeAvailable(): Promise<boolean> {
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
 * Execute Claude Code CLI with a prompt
 */
export async function executeClaudeCode(session: ClaudeSession): Promise<ClaudeResult> {
  const startTime = Date.now();
  const timeout = session.timeout || 300000; // 5 minutes default

  logger.info({ promptLength: session.prompt.length, timeout }, 'Executing Claude Code');

  return new Promise((resolve) => {
    // Use --print for non-interactive mode with tools enabled
    // --tools default enables all tools (Bash, Edit, Read, Write, etc.)
    // --dangerously-skip-permissions bypasses permission dialogs (safe in sandbox)
    const args = [
      '--print',
      '--tools', 'default',
      '--dangerously-skip-permissions',
      session.prompt
    ];

    if (session.systemPrompt) {
      args.unshift('--system-prompt', session.systemPrompt);
    }

    // Use shell: false to avoid escaping issues with multi-line prompts
    // stdin must be 'ignore' - otherwise Claude waits for input and hangs
    const proc = spawn('claude', args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: '/app/workspace', // Working directory for file operations
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
        logger.error({ code, stderr, durationMs }, 'Claude execution failed');
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || 'Exit code: ' + code,
          durationMs,
        });
      }
    });

    proc.on('error', (error) => {
      const durationMs = Date.now() - startTime;
      logger.error({ error, durationMs }, 'Claude spawn error');
      resolve({
        success: false,
        output: '',
        error: error.message,
        durationMs,
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
      });
    }, timeout);

    proc.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
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
export function buildLoopPrompt(
  profile: AgentProfile,
  state: Record<string, unknown>,
  trigger: { type: string; data?: unknown },
  pendingDecisions?: PendingDecision[],
  ragContext?: string
): string {
  const parts = [
    '# Agent Loop Execution',
    '',
    '## Agent: ' + profile.name + ' (' + profile.codename + ')',
    '## Trigger: ' + trigger.type,
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

  parts.push(
    '## Instructions',
    'Execute your loop according to your profile.',
    'Analyze the current state and trigger.',
    'Take appropriate actions and return results.',
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
