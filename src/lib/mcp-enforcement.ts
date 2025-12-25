/**
 * MCP Enforcement System
 *
 * Deterministic routing of operations to MCP servers.
 * Blocks creative workarounds by:
 * 1. Defining operation -> MCP mappings
 * 2. Blocking forbidden file patterns
 * 3. Validating all workspace writes
 */

import { createLogger } from './logger.js';

const logger = createLogger('mcp-enforcement');

/**
 * Operation types that MUST use specific MCPs
 * If an agent tries to do these operations without spawn_worker, block them
 */
export const MANDATORY_MCP_OPERATIONS = {
  // Telegram operations -> telegram MCP
  telegram: {
    patterns: [
      /send.*telegram/i,
      /telegram.*message/i,
      /telegram.*post/i,
      /telegram.*channel/i,
      /api\.telegram\.org/i,
      /sendMessage.*chat_id/i,
    ],
    mcp: 'telegram',
    description: 'Telegram messages must use telegram MCP via spawn_worker',
  },

  // Image generation -> imagen MCP
  imagen: {
    patterns: [
      /generate.*image/i,
      /imagen/i,
      /gemini.*image/i,
      /image.*generat/i,
      /create.*banner/i,
      /create.*graphic/i,
    ],
    mcp: 'imagen',
    description: 'Image generation must use imagen MCP via spawn_worker',
  },

  // HTTP requests -> fetch MCP
  fetch: {
    patterns: [
      /https\.request/i,
      /http\.request/i,
      /fetch\(/i,
      /axios/i,
      /got\(/i,
    ],
    mcp: 'fetch',
    description: 'HTTP requests must use fetch MCP via spawn_worker',
  },

  // Blockchain -> etherscan MCP
  etherscan: {
    patterns: [
      /etherscan/i,
      /blockchain.*query/i,
      /token.*balance/i,
      /contract.*call/i,
    ],
    mcp: 'etherscan',
    description: 'Blockchain queries must use etherscan MCP via spawn_worker',
  },
};

/**
 * Forbidden file patterns in workspace
 * These indicate the agent is trying to create workaround scripts
 */
export const FORBIDDEN_FILE_PATTERNS = [
  // Executable scripts
  /\.js$/,
  /\.ts$/,
  /\.sh$/,
  /\.py$/,
  /\.rb$/,
  /\.pl$/,

  // Config that might enable workarounds
  /\.env$/,
  /credentials/i,
  /secret/i,
  /api[_-]?key/i,
];

/**
 * Allowed file patterns in workspace
 * Whitelist approach - only these are allowed
 */
export const ALLOWED_FILE_PATTERNS = [
  // Documentation
  /\.md$/,
  /\.txt$/,
  /\.json$/,

  // Images (only in images/ directory)
  /^images\/.*\.(png|jpg|jpeg|gif|webp)$/,

  // Data files
  /\.csv$/,
  /\.yaml$/,
  /\.yml$/,

  // Agent-specific directories
  /^SHIBC-[A-Z]+-\d+\//,
];

/**
 * Check if a file write should be blocked
 */
export function shouldBlockFileWrite(filepath: string, content: string): {
  blocked: boolean;
  reason?: string;
  suggestedAction?: string;
} {
  const normalizedPath = filepath.replace(/\\/g, '/').toLowerCase();

  // Check forbidden patterns
  for (const pattern of FORBIDDEN_FILE_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      // Detect what the script is trying to do
      const operation = detectOperation(content);

      return {
        blocked: true,
        reason: `Script file creation blocked: ${filepath}`,
        suggestedAction: operation
          ? `Use spawn_worker with "${operation.mcp}" MCP instead: ${operation.description}`
          : 'Use spawn_worker with appropriate MCP server',
      };
    }
  }

  // Check if content contains forbidden operations
  const operation = detectOperation(content);
  if (operation) {
    return {
      blocked: true,
      reason: `Content contains operation that requires MCP: ${operation.description}`,
      suggestedAction: `Use spawn_worker with "${operation.mcp}" MCP`,
    };
  }

  return { blocked: false };
}

/**
 * Detect what MCP operation the content is trying to perform
 */
export function detectOperation(content: string): {
  type: string;
  mcp: string;
  description: string;
} | null {
  for (const [type, config] of Object.entries(MANDATORY_MCP_OPERATIONS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(content)) {
        return {
          type,
          mcp: config.mcp,
          description: config.description,
        };
      }
    }
  }
  return null;
}

/**
 * Validate spawn_worker action has correct MCP for the task
 */
export function validateSpawnWorker(task: string, servers: string[]): {
  valid: boolean;
  error?: string;
  requiredMcp?: string;
} {
  const operation = detectOperation(task);

  if (operation && !servers.includes(operation.mcp)) {
    return {
      valid: false,
      error: `Task requires "${operation.mcp}" MCP but it's not in servers list`,
      requiredMcp: operation.mcp,
    };
  }

  return { valid: true };
}

/**
 * Get required MCP servers for a task description
 */
export function getRequiredMcpServers(taskDescription: string): string[] {
  const required: string[] = [];

  for (const [type, config] of Object.entries(MANDATORY_MCP_OPERATIONS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(taskDescription)) {
        if (!required.includes(config.mcp)) {
          required.push(config.mcp);
        }
        break;
      }
    }
  }

  // Always include filesystem for file operations
  if (!required.includes('filesystem')) {
    required.push('filesystem');
  }

  return required;
}

/**
 * Pre-defined action templates for common operations
 * Agents should use these instead of creating custom solutions
 */
export const ACTION_TEMPLATES = {
  sendTelegramMessage: (channelId: string, message: string) => ({
    type: 'spawn_worker',
    task: `Send message to Telegram channel ${channelId}: ${message}`,
    servers: ['telegram'],
  }),

  sendTelegramImage: (channelId: string, imagePath: string, caption: string) => ({
    type: 'spawn_worker',
    task: `Send image ${imagePath} to Telegram channel ${channelId} with caption: ${caption}`,
    servers: ['telegram', 'filesystem'],
  }),

  generateImage: (prompt: string, outputPath: string, model: string = 'gemini-2.5-flash-image') => ({
    type: 'spawn_worker',
    task: `Generate image: ${prompt}. Save to ${outputPath}. Model: ${model}`,
    servers: ['imagen', 'filesystem'],
  }),

  fetchUrl: (url: string, purpose: string) => ({
    type: 'spawn_worker',
    task: `Fetch ${url} for ${purpose}`,
    servers: ['fetch'],
  }),

  queryBlockchain: (query: string) => ({
    type: 'spawn_worker',
    task: query,
    servers: ['etherscan'],
  }),
};

/**
 * Log enforcement action for audit
 */
export function logEnforcementAction(
  agentType: string,
  action: 'blocked' | 'allowed' | 'corrected',
  details: {
    originalAction?: string;
    reason?: string;
    suggestedAction?: string;
  }
): void {
  logger.warn({
    agentType,
    action,
    ...details,
  }, `MCP Enforcement: ${action}`);
}
