/**
 * MCP (Model Context Protocol) Manager
 * Handles spawning and managing MCP server connections for agents
 * All MCP servers use stdio transport (npx spawned processes)
 */

import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { config } from './config';
import { logger } from './logger';

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  description?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

// MCP servers available per agent type (MAIN LOOP ONLY)
// IMPORTANT: High-context servers like 'directus' and 'imagen' should NOT be in main loop!
// They should only be accessed via spawn_worker to preserve session context.
// Workers dynamically load servers from mcp_servers.json, so they can use any server.
export const MCP_SERVERS_BY_AGENT: Record<string, string[]> = {
  ceo: ['filesystem', 'fetch'],
  dao: ['filesystem', 'etherscan'],
  cmo: ['telegram', 'fetch', 'filesystem'],  // imagen via worker only (high context)
  cto: ['filesystem', 'fetch', 'directus', 'github', 'playwright', 'mui', 'git', 'shell', 'portainer', 'woodpecker'],  // via worker
  cfo: ['etherscan', 'filesystem'],
  coo: ['telegram', 'filesystem'],
  cco: ['filesystem', 'fetch'],
  test: ['filesystem', 'fetch'],
};

// Servers that should ONLY be used via spawn_worker (high context usage)
// These are NOT included in main loop MCP config to preserve session context
export const WORKER_ONLY_SERVERS = ['directus', 'imagen', 'github', 'playwright', 'mui', 'git', 'shell', 'portainer', 'woodpecker'];

/**
 * Load MCP server configurations from .claude/mcp_servers.json
 */
export function loadMCPConfig(): Record<string, MCPServerConfig> {
  try {
    const configPath = process.env.MCP_CONFIG_PATH || '/app/.claude/mcp_servers.json';
    const fs = require('fs');
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed.mcpServers || {};
  } catch (error) {
    logger.warn({ error }, 'Failed to load MCP config, using defaults');
    return getDefaultMCPConfig();
  }
}

/**
 * Default MCP configuration if file not found
 */
function getDefaultMCPConfig(): Record<string, MCPServerConfig> {
  return {
    telegram: {
      command: 'npx',
      args: ['-y', '@chaindead/telegram-mcp'],
      env: {
        TELEGRAM_BOT_TOKEN: config.TELEGRAM_BOT_TOKEN || '',
      },
      description: 'Telegram API for messages and channels',
    },
    etherscan: {
      command: 'npx',
      args: ['-y', 'etherscan-mcp'],
      env: {
        ETHERSCAN_API_KEY: process.env.ETHERSCAN_API_KEY || '',
      },
      description: 'Ethereum blockchain data',
    },
    directus: {
      command: 'npx',
      args: ['@directus/content-mcp@latest'],
      env: {
        DIRECTUS_URL: 'https://directus.shibaclassic.io',
        DIRECTUS_TOKEN: process.env.DIRECTUS_TOKEN || '',
      },
      description: 'Directus CMS via official @directus/content-mcp',
    },
    filesystem: {
      command: 'npx',
      args: ['-y', '@anthropic-ai/mcp-server-filesystem', '/app/workspace'],
      description: 'Local filesystem access',
    },
    fetch: {
      command: 'npx',
      args: ['-y', '@anthropic-ai/mcp-server-fetch'],
      description: 'Web content fetching',
    },
  };
}

/**
 * MCP Client - manages connection to a single MCP server process
 */
export class MCPClient {
  private process: ChildProcess | null = null;
  private responseHandlers: Map<number, (response: unknown) => void> = new Map();
  private requestId = 0;
  private tools: MCPTool[] = [];
  private initialized = false;

  constructor(
    public readonly name: string,
    private config: MCPServerConfig
  ) {}

  /**
   * Start the MCP server process
   */
  async start(): Promise<void> {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...(this.config.env || {}),
    };

    // Replace env variable placeholders like ${VAR}
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
        const envVar = value.slice(2, -1);
        env[key] = process.env[envVar] || '';
      }
    }

    this.process = spawn(this.config.command, this.config.args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.on('error', (error) => {
      logger.error({ error, server: this.name }, 'MCP server error');
    });

    this.process.on('exit', (code) => {
      logger.info({ code, server: this.name }, 'MCP server exited');
      this.initialized = false;
    });

    // Handle stdout (JSON-RPC responses)
    if (this.process.stdout) {
      const rl = createInterface({ input: this.process.stdout });
      rl.on('line', (line) => {
        try {
          const response = JSON.parse(line);
          if (response.id !== undefined) {
            const handler = this.responseHandlers.get(response.id);
            if (handler) {
              handler(response);
              this.responseHandlers.delete(response.id);
            }
          }
        } catch {
          // Ignore non-JSON output
        }
      });
    }

    // Log stderr
    if (this.process.stderr) {
      const rl = createInterface({ input: this.process.stderr });
      rl.on('line', (line) => {
        logger.debug({ server: this.name, stderr: line }, 'MCP server stderr');
      });
    }

    // Initialize connection
    await this.initialize();
    await this.loadTools();
    this.initialized = true;

    logger.info({ server: this.name, tools: this.tools.length }, 'MCP server started');
  }

  /**
   * Send JSON-RPC request to server
   */
  private async sendRequest(method: string, params: unknown = {}): Promise<unknown> {
    if (!this.process?.stdin) {
      throw new Error('MCP server not started');
    }

    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseHandlers.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 30000);

      this.responseHandlers.set(id, (response: any) => {
        clearTimeout(timeout);
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.result);
        }
      });

      this.process!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Initialize MCP connection
   */
  private async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      protocolVersion: '0.1.0',
      capabilities: {},
      clientInfo: { name: 'aito-agent', version: '1.0.0' },
    });
  }

  /**
   * Load available tools from server
   */
  private async loadTools(): Promise<void> {
    const result: any = await this.sendRequest('tools/list');
    this.tools = result.tools || [];
  }

  /**
   * Get available tools
   */
  getTools(): MCPTool[] {
    return this.tools;
  }

  /**
   * Call a tool
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (!this.initialized) {
      throw new Error('MCP server not initialized');
    }

    const result: any = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });

    return result as MCPToolResult;
  }

  /**
   * Stop the MCP server
   */
  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.initialized = false;
    }
  }

  isRunning(): boolean {
    return this.initialized && this.process !== null;
  }
}

/**
 * MCP Manager - manages multiple MCP clients for an agent
 */
export class MCPManager {
  private clients: Map<string, MCPClient> = new Map();
  private mcpConfig: Record<string, MCPServerConfig>;

  constructor() {
    this.mcpConfig = loadMCPConfig();
  }

  /**
   * Initialize MCP servers for an agent type
   */
  async initializeForAgent(agentType: string): Promise<void> {
    const serverNames = MCP_SERVERS_BY_AGENT[agentType] || [];

    for (const serverName of serverNames) {
      const serverConfig = this.mcpConfig[serverName];
      if (!serverConfig) {
        logger.warn({ serverName, agentType }, 'MCP server config not found');
        continue;
      }

      try {
        const client = new MCPClient(serverName, serverConfig);
        await client.start();
        this.clients.set(serverName, client);
      } catch (error) {
        logger.error({ error, serverName, agentType }, 'Failed to start MCP server');
      }
    }

    logger.info(
      { agentType, servers: Array.from(this.clients.keys()) },
      'MCP servers initialized for agent'
    );
  }

  /**
   * Get all available tools from all connected servers
   */
  getAllTools(): Array<MCPTool & { server: string }> {
    const tools: Array<MCPTool & { server: string }> = [];

    Array.from(this.clients.entries()).forEach(([serverName, client]) => {
      client.getTools().forEach((tool) => {
        tools.push({ ...tool, server: serverName });
      });
    });

    return tools;
  }

  /**
   * Call a tool by name (auto-routes to correct server)
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const entries = Array.from(this.clients.entries());
    for (const [, client] of entries) {
      const tools = client.getTools();
      if (tools.some((t) => t.name === toolName)) {
        return await client.callTool(toolName, args);
      }
    }

    throw new Error(`Tool not found: ${toolName}`);
  }

  /**
   * Get a specific server client
   */
  getClient(serverName: string): MCPClient | undefined {
    return this.clients.get(serverName);
  }

  /**
   * Stop all MCP servers
   */
  stopAll(): void {
    Array.from(this.clients.values()).forEach((client) => {
      client.stop();
    });
    this.clients.clear();
  }
}

// Singleton instance
let mcpManager: MCPManager | null = null;

export function getMCPManager(): MCPManager {
  if (!mcpManager) {
    mcpManager = new MCPManager();
  }
  return mcpManager;
}
