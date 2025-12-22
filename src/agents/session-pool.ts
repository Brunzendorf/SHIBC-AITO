/**
 * Session Pool System for Claude CLI
 *
 * Manages persistent Claude CLI sessions using stream-json mode.
 * This dramatically reduces token usage by keeping context between loops
 * instead of re-sending the full profile every time.
 *
 * Architecture:
 * - SessionPool: Manages pool of sessions, assigns to agents
 * - ClaudeSession: Wraps a single Claude CLI process with bidirectional streaming
 * - LayeredContext: Core Identity → Capabilities → Current Context
 *
 * Token Savings:
 * - Old: ~10K tokens per loop (full profile + prompt)
 * - New: ~2K tokens per loop (only trigger data)
 * - Savings: ~80% reduction in input tokens
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';
import { createLogger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import type { AgentProfile } from './profile.js';
import type { AgentType } from '../lib/types.js';

const logger = createLogger('session-pool');

/**
 * Input message format for stream-json communication
 * Claude CLI expects Anthropic API message format wrapped in type
 */
interface StreamInputMessage {
  type: 'user';
  message: {
    role: 'user';
    content: Array<{ type: 'text'; text: string }>;
  };
}

/**
 * Output message format from Claude CLI stream-json
 * Claude CLI uses 'type' field for output
 * 'user' type is echoed input, ignored
 */
interface StreamOutputMessage {
  type: 'assistant' | 'system' | 'result' | 'user';
  // For 'result' type messages:
  result?: string;
  subtype?: string;
  is_error?: boolean;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  // For 'assistant' type messages:
  message?: {
    content: Array<{ type: string; text?: string }>;
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  // Session info (from system messages):
  session_id?: string;
  content?: string;
  // Deprecated fields kept for compatibility:
  cost_usd?: number;
  tool_use_id?: string;
  tool_use?: {
    name: string;
    input: Record<string, unknown>;
  };
}

/**
 * Session state tracking
 */
type SessionState = 'idle' | 'busy' | 'compacting' | 'error' | 'dead';

/**
 * Session configuration
 */
interface SessionConfig {
  agentType: AgentType;
  profile: AgentProfile;
  mcpConfigPath?: string;
  maxLoops?: number;        // Recycle after N loops (default: 50)
  idleTimeoutMs?: number;   // Kill idle session after N ms (default: 30 minutes)
}

/**
 * Represents a persistent Claude CLI session
 * Uses stream-json mode for bidirectional communication
 */
export class ClaudeStreamSession extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: SessionState = 'idle';
  private sessionId: string | null = null;
  private loopCount = 0;
  private lastActivityAt: Date = new Date();
  private pendingResponse: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    buffer: string;
  } | null = null;

  readonly id: string;
  readonly config: SessionConfig;
  private profileInjected = false;

  constructor(id: string, config: SessionConfig) {
    super();
    this.id = id;
    this.config = config;
    // Add default error handler to prevent uncaught exception
    // if no external listener is attached
    this.on('error', () => {
      // Error state is already tracked internally
    });
    logger.debug({ sessionId: id, agentType: config.agentType }, 'Session created');
  }

  /**
   * Start the Claude CLI process in stream-json mode
   */
  async start(): Promise<boolean> {
    if (this.process) {
      logger.warn({ sessionId: this.id }, 'Session already started');
      return true;
    }

    logger.info({ sessionId: this.id, agentType: this.config.agentType }, 'Starting Claude session');

    const args = [
      '--input-format=stream-json',
      '--output-format=stream-json',
      '--verbose',  // Required for stream-json output
      '--dangerously-skip-permissions',
    ];

    // Add MCP config if available
    if (this.config.mcpConfigPath && existsSync(this.config.mcpConfigPath)) {
      args.push('--mcp-config', this.config.mcpConfigPath);
    }

    // Working directory
    const workingDir = existsSync('/app/workspace') ? '/app/workspace' : process.cwd();

    try {
      this.process = spawn('claude', args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workingDir,
        env: {
          ...process.env,
          CI: 'true',
        },
      });

      // Handle stdout (responses from Claude)
      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleOutput(data.toString());
      });

      // Handle stderr (errors and logs)
      this.process.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          logger.debug({ sessionId: this.id, stderr: msg }, 'Claude stderr');
          // Check for compact notification
          if (msg.includes('compact') || msg.includes('/compact')) {
            this.handleCompact();
          }
        }
      });

      // Handle process exit
      this.process.on('exit', (code) => {
        logger.info({ sessionId: this.id, code }, 'Claude process exited');
        this.state = 'dead';
        this.process = null;
        this.emit('exit', code);
      });

      // Handle process errors
      this.process.on('error', (error) => {
        logger.error({ sessionId: this.id, error: error.message }, 'Claude process error');
        this.state = 'error';
        this.emit('error', error);
      });

      // Wait a bit for the process to initialize
      await new Promise(resolve => setTimeout(resolve, 500));

      if (this.process && !this.process.killed) {
        this.state = 'idle';
        logger.info({ sessionId: this.id }, 'Claude session started successfully');
        return true;
      }

      return false;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ sessionId: this.id, error: errMsg }, 'Failed to start Claude session');
      this.state = 'error';
      return false;
    }
  }

  /**
   * Inject the agent profile into the session
   * Called once after session start
   */
  async injectProfile(): Promise<boolean> {
    if (this.profileInjected) {
      logger.debug({ sessionId: this.id }, 'Profile already injected');
      return true;
    }

    if (!this.process || this.state === 'dead') {
      logger.error({ sessionId: this.id }, 'Cannot inject profile: session not running');
      return false;
    }

    logger.info({ sessionId: this.id, agentType: this.config.agentType }, 'Injecting agent profile');

    // Build layered profile for initial injection
    const profilePrompt = this.buildProfilePrompt();

    try {
      // Send profile as first message
      await this.sendMessage(profilePrompt);

      this.profileInjected = true;
      logger.info({
        sessionId: this.id,
        profileLength: profilePrompt.length,
      }, 'Profile injected successfully');

      return true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ sessionId: this.id, error: errMsg }, 'Failed to inject profile');
      return false;
    }
  }

  /**
   * Build the profile prompt for injection
   * Uses layered context system
   */
  private buildProfilePrompt(): string {
    const profile = this.config.profile;

    const parts = [
      '# Agent Identity & Context',
      '',
      `You are ${profile.name} (${profile.codename.toUpperCase()}) - ${profile.mission || 'AI Agent'}`,
      '',
      '## Core Profile',
      profile.rawContent,
      '',
      '## Session Mode',
      'This is a persistent session. You will receive multiple prompts.',
      'Maintain context between messages. Only ask for clarification if truly needed.',
      '',
      '## Response Format',
      'For each loop, respond with a JSON object containing:',
      '- actions: Array of actions to execute',
      '- messages: Array of messages to send to other agents',
      '- stateUpdates: Object with state key/value updates',
      '- summary: Brief summary of what was done',
      '',
      'Acknowledge that you understand your role and are ready to receive tasks.',
    ];

    return parts.join('\n');
  }

  /**
   * Build minimal context for re-injection after /compact
   */
  private buildMinimalContext(): string {
    const profile = this.config.profile;

    return [
      `# Context Reminder - ${profile.name} (${profile.codename.toUpperCase()})`,
      '',
      '## Your Role',
      profile.mission || 'AI Agent for Shiba Classic ($SHIBC)',
      '',
      '## Key Responsibilities',
      profile.responsibilities?.slice(0, 5).map((r: string) => `- ${r}`).join('\n') || '- General agent capabilities',
      '',
      '## Department',
      profile.department || 'Not specified',
      '',
      '## Response Format (JSON)',
      '{ "actions": [...], "messages": [...], "stateUpdates": {...}, "summary": "..." }',
      '',
      'Continue processing tasks as before.',
    ].join('\n');
  }

  /**
   * Send a message and wait for response
   */
  async sendMessage(content: string, timeoutMs = 300000): Promise<string> {
    if (!this.process || this.state === 'dead') {
      throw new Error('Session not running');
    }

    if (this.state === 'busy') {
      throw new Error('Session is busy');
    }

    this.state = 'busy';
    this.lastActivityAt = new Date();

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        if (this.pendingResponse) {
          this.pendingResponse = null;
          this.state = 'idle';
          reject(new Error(`Response timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      // Store pending response handler
      this.pendingResponse = {
        resolve: (response: string) => {
          clearTimeout(timeout);
          this.state = 'idle';
          this.loopCount++;
          resolve(response);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          this.state = 'error';
          reject(error);
        },
        timeout,
        buffer: '',
      };

      // Send message as JSON (Claude CLI expects Anthropic API message format)
      const message: StreamInputMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: content }],
        },
      };

      try {
        this.process!.stdin!.write(JSON.stringify(message) + '\n');
        logger.debug({
          sessionId: this.id,
          contentLength: content.length,
        }, 'Message sent to Claude');
      } catch (error) {
        this.pendingResponse = null;
        this.state = 'error';
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Handle output from Claude CLI
   */
  private handleOutput(data: string): void {
    if (!this.pendingResponse) {
      // Unexpected output
      logger.debug({ sessionId: this.id, data: data.slice(0, 100) }, 'Unexpected output received');
      return;
    }

    this.pendingResponse.buffer += data;

    // Try to parse complete JSON messages (newline-delimited)
    const lines = this.pendingResponse.buffer.split('\n');

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const message = JSON.parse(line) as StreamOutputMessage;
        this.handleStreamMessage(message);
      } catch (error) {
        logger.debug({ sessionId: this.id, line: line.slice(0, 100) }, 'Non-JSON output line');
      }
    }

    // Keep incomplete line in buffer (if we're expecting a response)
    if (this.pendingResponse) {
      this.pendingResponse.buffer = lines[lines.length - 1];
    }
  }

  /**
   * Handle a parsed stream message
   */
  private handleStreamMessage(message: StreamOutputMessage): void {
    // Capture session ID
    if (message.session_id && !this.sessionId) {
      this.sessionId = message.session_id;
      logger.debug({ sessionId: this.id, claudeSessionId: this.sessionId }, 'Claude session ID captured');
    }

    switch (message.type) {
      case 'assistant':
        // Assistant messages contain streaming content chunks - 'result' message has final
        if (message.message?.usage) {
          logger.debug({
            sessionId: this.id,
            inputTokens: message.message.usage.input_tokens,
            cacheReadTokens: message.message.usage.cache_read_input_tokens,
          }, 'Token usage update');
        }
        break;

      case 'result':
        // Final response received
        if (this.pendingResponse) {
          // Claude CLI uses 'result' field for the actual content
          const response = message.result || '';
          logger.debug({
            sessionId: this.id,
            responseLength: response.length,
            durationMs: message.duration_ms,
            durationApiMs: message.duration_api_ms,
            isError: message.is_error,
          }, 'Response received');

          this.pendingResponse.resolve(response);
          this.pendingResponse = null;
        }
        break;

      case 'system':
        logger.debug({ sessionId: this.id, content: message.content }, 'System message');
        // Check for compact command
        if (message.content?.includes('/compact')) {
          this.handleCompact();
        }
        break;

      case 'user':
        // Echoed input message in stream-json mode, ignore
        break;

      default:
        logger.debug({ sessionId: this.id, type: message.type }, 'Unknown message type');
    }
  }

  /**
   * Handle /compact command - re-inject minimal context
   */
  private async handleCompact(): Promise<void> {
    if (this.state === 'compacting') return;

    logger.info({ sessionId: this.id }, 'Handling /compact - re-injecting minimal context');
    this.state = 'compacting';
    this.profileInjected = false;

    try {
      // Wait for any pending response to complete
      if (this.pendingResponse) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Re-inject minimal context
      const minimalContext = this.buildMinimalContext();
      await this.sendMessage(minimalContext, 60000);

      this.profileInjected = true;
      this.state = 'idle';
      logger.info({ sessionId: this.id }, 'Minimal context re-injected after compact');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ sessionId: this.id, error: errMsg }, 'Failed to re-inject context after compact');
      this.state = 'error';
    }
  }

  /**
   * Track API cost for monitoring
   */
  private async trackCost(costUsd: number): Promise<void> {
    try {
      const key = `cost:${this.config.agentType}:${new Date().toISOString().split('T')[0]}`;
      await redis.incrbyfloat(key, costUsd);
      // Expire after 30 days
      await redis.expire(key, 30 * 24 * 60 * 60);
    } catch (error) {
      // Non-critical, just log
      logger.debug({ error }, 'Failed to track cost');
    }
  }

  /**
   * Stop the session
   */
  async stop(): Promise<void> {
    if (!this.process) return;

    logger.info({ sessionId: this.id, loopCount: this.loopCount }, 'Stopping Claude session');

    try {
      // Close stdin to signal end of input (stream-json mode)
      this.process.stdin?.end();

      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 500));

      // Force kill if still running
      if (this.process && !this.process.killed) {
        this.process.kill('SIGTERM');
      }
    } catch (error) {
      // Ignore errors during shutdown
    }

    this.process = null;
    this.state = 'dead';
  }

  /**
   * Get session status
   */
  getStatus(): {
    id: string;
    state: SessionState;
    sessionId: string | null;
    loopCount: number;
    lastActivityAt: Date;
    profileInjected: boolean;
    agentType: AgentType;
  } {
    return {
      id: this.id,
      state: this.state,
      sessionId: this.sessionId,
      loopCount: this.loopCount,
      lastActivityAt: this.lastActivityAt,
      profileInjected: this.profileInjected,
      agentType: this.config.agentType,
    };
  }

  /**
   * Check if session should be recycled
   */
  shouldRecycle(): boolean {
    const maxLoops = this.config.maxLoops ?? 50;  // Use ?? to handle 0 correctly
    const idleTimeoutMs = this.config.idleTimeoutMs ?? 30 * 60 * 1000; // 30 minutes

    // Recycle if max loops reached
    if (this.loopCount >= maxLoops) {
      logger.info({ sessionId: this.id, loopCount: this.loopCount, maxLoops }, 'Session reached max loops');
      return true;
    }

    // Recycle if idle too long
    const idleMs = Date.now() - this.lastActivityAt.getTime();
    if (idleMs > idleTimeoutMs) {
      logger.info({ sessionId: this.id, idleMs, idleTimeoutMs }, 'Session idle timeout');
      return true;
    }

    // Recycle if in error state
    if (this.state === 'error' || this.state === 'dead') {
      return true;
    }

    return false;
  }

  /**
   * Check if session is available for new work
   */
  isAvailable(): boolean {
    return this.state === 'idle' && this.process !== null && !this.shouldRecycle();
  }
}

/**
 * Session Pool Manager
 * Manages a pool of Claude CLI sessions for all agents
 */
export class SessionPool {
  private sessions: Map<string, ClaudeStreamSession> = new Map();
  private agentAssignments: Map<AgentType, string> = new Map();
  private recycleIntervalId: NodeJS.Timeout | null = null;

  constructor(private recycleIntervalMs = 60000) {
    logger.info({ recycleIntervalMs }, 'Session pool created');
  }

  /**
   * Start the session pool
   */
  start(): void {
    // Start recycling interval
    this.recycleIntervalId = setInterval(() => {
      this.recycleStale().catch(err => {
        logger.warn({ error: err }, 'Error during session recycling');
      });
    }, this.recycleIntervalMs);

    logger.info('Session pool started');
  }

  /**
   * Stop the session pool
   */
  async stop(): Promise<void> {
    // Stop recycling interval
    if (this.recycleIntervalId) {
      clearInterval(this.recycleIntervalId);
      this.recycleIntervalId = null;
    }

    // Stop all sessions
    const stopPromises = Array.from(this.sessions.values()).map(s => s.stop());
    await Promise.all(stopPromises);

    this.sessions.clear();
    this.agentAssignments.clear();

    logger.info('Session pool stopped');
  }

  /**
   * Get or create a session for an agent
   */
  async getSession(config: SessionConfig): Promise<ClaudeStreamSession> {
    const agentType = config.agentType;

    // Check if agent already has an assigned session
    const existingSessionId = this.agentAssignments.get(agentType);
    if (existingSessionId) {
      const existingSession = this.sessions.get(existingSessionId);
      if (existingSession && existingSession.isAvailable()) {
        logger.debug({ agentType, sessionId: existingSessionId }, 'Returning existing session');
        return existingSession;
      }
      // Remove stale assignment
      this.agentAssignments.delete(agentType);
      if (existingSession) {
        await existingSession.stop();
        this.sessions.delete(existingSessionId);
      }
    }

    // Create new session
    const sessionId = `${agentType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session = new ClaudeStreamSession(sessionId, config);

    // Start the session
    const started = await session.start();
    if (!started) {
      throw new Error(`Failed to start session for ${agentType}`);
    }

    // Inject profile
    const injected = await session.injectProfile();
    if (!injected) {
      await session.stop();
      throw new Error(`Failed to inject profile for ${agentType}`);
    }

    // Register session
    this.sessions.set(sessionId, session);
    this.agentAssignments.set(agentType, sessionId);

    // Handle session exit
    session.on('exit', () => {
      this.sessions.delete(sessionId);
      if (this.agentAssignments.get(agentType) === sessionId) {
        this.agentAssignments.delete(agentType);
      }
    });

    logger.info({ agentType, sessionId }, 'New session created and assigned');
    return session;
  }

  /**
   * Recycle stale sessions
   */
  private async recycleStale(): Promise<void> {
    const toRecycle: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.shouldRecycle()) {
        toRecycle.push(sessionId);
      }
    }

    if (toRecycle.length === 0) return;

    logger.info({ count: toRecycle.length }, 'Recycling stale sessions');

    for (const sessionId of toRecycle) {
      const session = this.sessions.get(sessionId);
      if (session) {
        const agentType = session.config.agentType;
        await session.stop();
        this.sessions.delete(sessionId);
        if (this.agentAssignments.get(agentType) === sessionId) {
          this.agentAssignments.delete(agentType);
        }
        logger.debug({ sessionId, agentType }, 'Session recycled');
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalSessions: number;
    assignedAgents: AgentType[];
    sessionDetails: Array<ReturnType<ClaudeStreamSession['getStatus']>>;
  } {
    return {
      totalSessions: this.sessions.size,
      assignedAgents: Array.from(this.agentAssignments.keys()),
      sessionDetails: Array.from(this.sessions.values()).map(s => s.getStatus()),
    };
  }
}

// Singleton instance
let sessionPoolInstance: SessionPool | null = null;

/**
 * Get or create the session pool singleton
 */
export function getSessionPool(): SessionPool {
  if (!sessionPoolInstance) {
    sessionPoolInstance = new SessionPool();
    sessionPoolInstance.start();
  }
  return sessionPoolInstance;
}

/**
 * Shutdown the session pool
 */
export async function shutdownSessionPool(): Promise<void> {
  if (sessionPoolInstance) {
    await sessionPoolInstance.stop();
    sessionPoolInstance = null;
  }
}
