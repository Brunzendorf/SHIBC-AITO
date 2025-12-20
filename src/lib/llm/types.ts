/**
 * LLM Abstraction Layer
 * Unified interface for Claude Code CLI and Gemini CLI
 */

export type LLMProviderType = 'claude' | 'gemini' | 'openai';

export interface LLMSession {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  timeout?: number; // ms
  maxRetries?: number;
  mcpConfigPath?: string; // For Claude Code CLI
  mcpServers?: string[]; // For Gemini CLI
  model?: string; // For Gemini model selection
  enableTools?: boolean; // Enable CLI tools (Read, Write, Edit, Bash) - defaults to true
}

export interface LLMResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  retryable?: boolean;
  retriesUsed?: number;
  provider?: LLMProviderType; // Which provider was used
}

export interface LLMProvider {
  name: LLMProviderType;

  /**
   * Check if this LLM provider is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Execute a prompt with this provider
   */
  execute(session: LLMSession): Promise<LLMResult>;

  /**
   * Execute with automatic retry on transient errors
   */
  executeWithRetry(session: LLMSession): Promise<LLMResult>;
}

/**
 * Task context for routing decisions
 */
export interface TaskContext {
  taskType?: 'spawn_worker' | 'operational' | 'propose_decision' | 'vote' | 'create_task' | 'alert' | 'loop';
  agentType?: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  requiresReasoning?: boolean; // Force Claude for complex reasoning
  estimatedComplexity?: 'simple' | 'medium' | 'complex';
}

/**
 * LLM Routing Strategy
 */
export type RoutingStrategy = 'task-type' | 'agent-role' | 'load-balance' | 'gemini-prefer' | 'claude-only';

/**
 * Routing decision result
 */
export interface RoutingDecision {
  primary: LLMProviderType;
  fallback: LLMProviderType;
  reason: string;
}
