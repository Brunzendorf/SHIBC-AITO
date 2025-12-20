/**
 * Gemini CLI Provider
 * Executes Gemini CLI with agent context
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { createLogger } from '../logger.js';
import { llmConfig } from '../config.js';
import type { LLMProvider, LLMSession, LLMResult } from './types.js';

const logger = createLogger('gemini');

// Retry configuration (same as Claude)
export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 5000,
  maxDelayMs: 60000,
  retryableErrors: [
    'overloaded_error',
    'overloaded',
    'rate_limit',
    'timeout',
    '529',
    '503',
    '502',
    'resource_exhausted', // Gemini-specific
    'quota_exceeded',     // Gemini-specific
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
  return RETRY_CONFIG.retryableErrors.some(e => combined.includes(e.toLowerCase()));
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(attempt: number): number {
  const exponentialDelay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(exponentialDelay + jitter, RETRY_CONFIG.maxDelayMs);
}

/**
 * Check if Gemini CLI is available (single attempt)
 */
function checkGeminiOnce(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('gemini', ['--version'], {
      shell: true,
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
 * Check if Gemini CLI is available with retries
 */
export async function isGeminiAvailable(retries = 3, delayMs = 2000): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const available = await checkGeminiOnce();
    if (available) {
      return true;
    }
    if (attempt < retries) {
      logger.debug({ attempt, retries }, 'Gemini not available, retrying...');
      await sleep(delayMs);
    }
  }
  return false;
}

/**
 * Execute Gemini CLI with a prompt
 */
export async function executeGeminiCode(session: LLMSession): Promise<LLMResult> {
  const startTime = Date.now();
  const timeout = session.timeout || 300000; // 5 minutes default
  const model = session.model || llmConfig.geminiDefaultModel; // Default from config

  logger.info({
    promptLength: session.prompt.length,
    timeout,
    model
  }, 'Executing Gemini CLI');

  return new Promise((resolve) => {
    // Build Gemini CLI args
    // Prompt is passed as POSITIONAL argument (last), not with -p flag
    // -y for YOLO mode (auto-approve all tools)
    // -m for model selection
    const args = ['-m', model];

    // Add YOLO mode only if tools are enabled (defaults to true)
    if (session.enableTools !== false) {
      args.unshift('-y'); // Auto-approve (equivalent to --dangerously-skip-permissions)
    }

    // Add MCP servers if provided (Gemini CLI supports MCP!)
    // Gemini uses --allowed-mcp-server-names instead of --mcp-config
    if (session.mcpServers && session.mcpServers.length > 0) {
      args.push('--allowed-mcp-server-names', ...session.mcpServers);
      logger.info({ mcpServers: session.mcpServers }, 'Executing Gemini with MCP servers');
    }

    // Prepare prompt (combine system prompt if provided)
    let fullPrompt = session.prompt;
    if (session.systemPrompt) {
      // Gemini CLI doesn't have --system-prompt flag
      // We'll prepend it to the prompt instead
      fullPrompt = `System Instructions: ${session.systemPrompt}\n\n${session.prompt}`;
    }

    // Add prompt as POSITIONAL argument (must be last)
    args.push(fullPrompt);

    // Use /app/workspace if it exists (agents), otherwise use current directory (orchestrator)
    const workingDir = existsSync('/app/workspace') ? '/app/workspace' : process.cwd();

    const proc = spawn('gemini', args, {
      shell: true,
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
        logger.info({ durationMs, outputLength: stdout.length }, 'Gemini execution completed');
        resolve({
          success: true,
          output: stdout.trim(),
          durationMs,
          provider: 'gemini',
        });
      } else {
        const errorMsg = stderr.trim() || 'Exit code: ' + code;
        const retryable = isRetryableError(errorMsg, stdout);
        logger.error({ code, stderr, durationMs, retryable }, 'Gemini execution failed');
        resolve({
          success: false,
          output: stdout.trim(),
          error: errorMsg,
          durationMs,
          retryable,
          provider: 'gemini',
        });
      }
    });

    proc.on('error', (error) => {
      const durationMs = Date.now() - startTime;
      const retryable = isRetryableError(error.message, '');
      logger.error({ error, durationMs, retryable }, 'Gemini spawn error');
      resolve({
        success: false,
        output: '',
        error: error.message,
        durationMs,
        retryable,
        provider: 'gemini',
      });
    });

    // Timeout handling
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      const durationMs = Date.now() - startTime;
      logger.warn({ timeout, durationMs }, 'Gemini execution timed out');
      resolve({
        success: false,
        output: stdout.trim(),
        error: 'Execution timed out after ' + timeout + 'ms',
        durationMs,
        retryable: true,
        provider: 'gemini',
      });
    }, timeout);

    proc.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Execute Gemini CLI with automatic retry on transient errors
 */
export async function executeGeminiCodeWithRetry(session: LLMSession): Promise<LLMResult> {
  const maxRetries = session.maxRetries ?? RETRY_CONFIG.maxRetries;
  let lastResult: LLMResult | null = null;
  let totalDurationMs = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = calculateBackoffDelay(attempt - 1);
      logger.info({ attempt, delay, maxRetries }, 'Retrying Gemini execution after delay');
      await sleep(delay);
    }

    const result = await executeGeminiCode(session);
    totalDurationMs += result.durationMs;
    lastResult = result;

    // Success - return immediately
    if (result.success) {
      if (attempt > 0) {
        logger.info({ attempt, totalDurationMs }, 'Gemini execution succeeded after retry');
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
 * Gemini Provider implementation
 */
export class GeminiProvider implements LLMProvider {
  name: 'gemini' = 'gemini';

  async isAvailable(): Promise<boolean> {
    return isGeminiAvailable();
  }

  async execute(session: LLMSession): Promise<LLMResult> {
    return executeGeminiCode(session);
  }

  async executeWithRetry(session: LLMSession): Promise<LLMResult> {
    return executeGeminiCodeWithRetry(session);
  }
}

// Export singleton instance
export const geminiProvider = new GeminiProvider();
