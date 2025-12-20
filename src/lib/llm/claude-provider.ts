/**
 * Claude Provider Wrapper
 * Wraps existing Claude Code functions to implement LLMProvider interface
 */

import {
  executeClaudeCodeWithRetry,
  isClaudeAvailable,
  executeClaudeCode,
  type ClaudeSession,
  type ClaudeResult,
} from '../../agents/claude.js';
import type { LLMProvider, LLMSession, LLMResult } from './types.js';

/**
 * Convert LLMSession to ClaudeSession
 */
function toLLMSession(session: ClaudeSession): LLMSession {
  return {
    prompt: session.prompt,
    systemPrompt: session.systemPrompt,
    maxTokens: session.maxTokens,
    timeout: session.timeout,
    maxRetries: session.maxRetries,
  };
}

/**
 * Convert ClaudeSession to ClaudeSession (identity, but with type safety)
 */
function toClaudeSession(session: LLMSession): ClaudeSession {
  return {
    prompt: session.prompt,
    systemPrompt: session.systemPrompt,
    maxTokens: session.maxTokens,
    timeout: session.timeout,
    maxRetries: session.maxRetries,
  };
}

/**
 * Convert ClaudeResult to LLMResult
 */
function toLLMResult(result: ClaudeResult): LLMResult {
  return {
    ...result,
    provider: 'claude',
  };
}

/**
 * Claude Provider implementation
 */
export class ClaudeProvider implements LLMProvider {
  name: 'claude' = 'claude';

  async isAvailable(): Promise<boolean> {
    return isClaudeAvailable();
  }

  async execute(session: LLMSession): Promise<LLMResult> {
    const claudeSession = toClaudeSession(session);
    const result = await executeClaudeCode(claudeSession);
    return toLLMResult(result);
  }

  async executeWithRetry(session: LLMSession): Promise<LLMResult> {
    const claudeSession = toClaudeSession(session);
    const result = await executeClaudeCodeWithRetry(claudeSession);
    return toLLMResult(result);
  }
}

// Export singleton instance
export const claudeProvider = new ClaudeProvider();
