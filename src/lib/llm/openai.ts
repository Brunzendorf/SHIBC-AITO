/**
 * OpenAI Codex CLI Provider
 * Executes OpenAI Codex CLI with agent context
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { createLogger } from '../logger.js';
import { llmConfig } from '../config.js';
import type { LLMProvider, LLMSession, LLMResult } from './types.js';

const logger = createLogger('openai');

// Retry configuration (same as Claude/Gemini)
export const OPENAI_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 5000,
  maxDelayMs: 60000,
  retryableErrors: [
    'rate_limit',
    'timeout',
    '429',
    '503',
    '502',
    'overloaded',
  ],
};

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: string | undefined, output: string): boolean {
  if (!error && !output) return false;
  const combined = ((error || '') + ' ' + output).toLowerCase();
  return OPENAI_RETRY_CONFIG.retryableErrors.some(e => combined.includes(e.toLowerCase()));
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(attempt: number): number {
  const exponentialDelay = OPENAI_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(exponentialDelay + jitter, OPENAI_RETRY_CONFIG.maxDelayMs);
}

/**
 * Check if Codex CLI is available
 */
function checkCodexOnce(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('codex', ['--version'], {
      shell: false,
      stdio: 'pipe',
    });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });

    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}

/**
 * Check if Codex CLI is available with retries
 */
export async function isCodexAvailable(retries = 3, delayMs = 2000): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const available = await checkCodexOnce();
    if (available) {
      return true;
    }
    if (attempt < retries) {
      logger.debug({ attempt, retries }, 'Codex not available, retrying...');
      await sleep(delayMs);
    }
  }
  return false;
}

/**
 * Execute Codex CLI with a prompt using `codex exec` for programmatic usage
 */
export async function executeCodex(session: LLMSession): Promise<LLMResult> {
  const startTime = Date.now();
  const timeout = session.timeout || 300000; // 5 minutes default
  const model = session.model || 'gpt-5-codex'; // Default model

  logger.info({
    promptLength: session.prompt.length,
    timeout,
    model
  }, 'Executing Codex CLI');

  return new Promise((resolve) => {
    // Build Codex CLI args
    // Use `codex exec` for non-interactive programmatic execution
    const args = [
      'exec',
      '--model', model,
      '--',
      session.prompt
    ];

    // Note: Codex CLI doesn't have direct system prompt support
    // We'll prepend it to the prompt if provided
    if (session.systemPrompt) {
      args[args.length - 1] = `System Instructions: ${session.systemPrompt}\n\n${session.prompt}`;
    }

    // Use /app/workspace if it exists (agents), otherwise use current directory (orchestrator)
    const workingDir = existsSync('/app/workspace') ? '/app/workspace' : process.cwd();

    const proc = spawn('codex', args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: workingDir,
      env: {
        ...process.env,
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
        logger.info({ durationMs, outputLength: stdout.length }, 'Codex execution completed');
        resolve({
          success: true,
          output: stdout.trim(),
          durationMs,
          provider: 'openai',
        });
      } else {
        const errorMsg = stderr.trim() || 'Exit code: ' + code;
        const retryable = isRetryableError(errorMsg, stdout);
        logger.error({ code, stderr, durationMs, retryable }, 'Codex execution failed');
        resolve({
          success: false,
          output: stdout.trim(),
          error: errorMsg,
          durationMs,
          retryable,
          provider: 'openai',
        });
      }
    });

    proc.on('error', (error) => {
      const durationMs = Date.now() - startTime;
      const retryable = isRetryableError(error.message, '');
      logger.error({ error, durationMs, retryable }, 'Codex spawn error');
      resolve({
        success: false,
        output: '',
        error: error.message,
        durationMs,
        retryable,
        provider: 'openai',
      });
    });

    // Timeout handling
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      const durationMs = Date.now() - startTime;
      logger.warn({ timeout, durationMs }, 'Codex execution timed out');
      resolve({
        success: false,
        output: stdout.trim(),
        error: 'Execution timed out after ' + timeout + 'ms',
        durationMs,
        retryable: true,
        provider: 'openai',
      });
    }, timeout);

    proc.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Execute Codex CLI with automatic retry on transient errors
 */
export async function executeCodexWithRetry(session: LLMSession): Promise<LLMResult> {
  const maxRetries = session.maxRetries ?? OPENAI_RETRY_CONFIG.maxRetries;
  let lastResult: LLMResult | null = null;
  let totalDurationMs = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = calculateBackoffDelay(attempt - 1);
      logger.info({ attempt, delay, maxRetries }, 'Retrying Codex execution after delay');
      await sleep(delay);
    }

    const result = await executeCodex(session);
    totalDurationMs += result.durationMs;
    lastResult = result;

    // Success - return immediately
    if (result.success) {
      if (attempt > 0) {
        logger.info({ attempt, totalDurationMs }, 'Codex execution succeeded after retry');
      }
      return { ...result, retriesUsed: attempt };
    }

    // Check if error is retryable
    if (!result.retryable) {
      logger.warn({ attempt, error: result.error }, 'Non-retryable error, giving up');
      return { ...result, retriesUsed: attempt };
    }

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
 * OpenAI Codex Provider implementation
 */
export class OpenAIProvider implements LLMProvider {
  name: 'openai' = 'openai';

  async isAvailable(): Promise<boolean> {
    return isCodexAvailable();
  }

  async execute(session: LLMSession): Promise<LLMResult> {
    return executeCodex(session);
  }

  async executeWithRetry(session: LLMSession): Promise<LLMResult> {
    return executeCodexWithRetry(session);
  }
}

// Export singleton instance
export const openaiProvider = new OpenAIProvider();
