#!/usr/bin/env node
/**
 * Status MCP Server
 *
 * Allows agents to post their status and view team status.
 * Connects to the Status Service REST API.
 *
 * TASK-108: Agent Status Service
 *
 * Environment Variables:
 * - STATUS_SERVICE_URL: URL of the status service (default: http://aito-status:3002)
 * - AGENT_TYPE: The type of agent using this MCP (ceo, cmo, cto, etc.)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

const STATUS_SERVICE_URL = process.env.STATUS_SERVICE_URL || 'http://aito-status:3002';
const AGENT_TYPE = process.env.AGENT_TYPE || 'unknown';

// --- Logging Helper ---
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: 'status-mcp',
    agent: AGENT_TYPE,
    msg: message,
    ...data
  };
  console.error(JSON.stringify(entry));
}

// --- Status Service API Helper ---
async function statusRequest(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const url = `${STATUS_SERVICE_URL}${endpoint}`;

  try {
    const options: {
      method: string;
      headers: Record<string, string>;
      body?: string;
    } = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        error: (data as { error?: string }).error || `HTTP ${response.status}`,
      };
    }

    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// --- Create MCP Server ---
const server = new Server(
  {
    name: 'status-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- List available tools ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log('debug', 'Returning tools list');
  return {
    tools: [
      {
        name: 'post_status',
        description: 'Post your current status to the team dashboard. Use this to communicate what you are working on. This is visible to all other agents and the dashboard.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['working', 'idle', 'blocked', 'completed'],
              description: 'Your current status: working (actively processing), idle (waiting for tasks), blocked (cannot proceed), completed (finished a task)'
            },
            activity: {
              type: 'string',
              description: 'Brief description of what you are doing (1-2 sentences). Example: "Processing Q1 2026 webinar planning task"'
            },
            loop: {
              type: 'number',
              description: 'Your current loop number'
            },
            issue_number: {
              type: 'number',
              description: 'GitHub issue number you are working on (optional)'
            },
            details: {
              type: 'object',
              description: 'Additional structured data (optional)'
            }
          },
          required: ['status', 'activity']
        }
      },
      {
        name: 'get_team_status',
        description: 'Get the current status of all agents. Use this to see what other team members are working on and their online/offline status.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'get_my_history',
        description: 'Get your recent status history. Useful for reviewing what you have done in previous loops.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Number of history entries to retrieve (default: 10, max: 100)'
            }
          },
          required: []
        }
      },
      {
        name: 'get_agent_status',
        description: 'Get detailed status of a specific agent including their recent history.',
        inputSchema: {
          type: 'object',
          properties: {
            agent: {
              type: 'string',
              enum: ['ceo', 'cmo', 'cto', 'cfo', 'coo', 'cco', 'dao'],
              description: 'The agent type to query'
            },
            limit: {
              type: 'number',
              description: 'Number of history entries to include (default: 5)'
            }
          },
          required: ['agent']
        }
      }
    ],
  };
});

// --- Handle tool calls ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  log('info', `Tool called: ${name}`, { tool: name });

  try {
    switch (name) {
      case 'post_status': {
        const { status, activity, loop, issue_number, details } = args as {
          status: 'working' | 'idle' | 'blocked' | 'completed';
          activity: string;
          loop?: number;
          issue_number?: number;
          details?: Record<string, unknown>;
        };

        const result = await statusRequest('POST', '/api/status', {
          agent: AGENT_TYPE,
          status,
          activity,
          loop: loop || 0,
          issue: issue_number,
          details,
        });

        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `Failed to post status: ${result.error}` }],
            isError: true,
          };
        }

        log('info', 'Status posted', { status, activity });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            agent: AGENT_TYPE,
            status,
            activity,
            timestamp: new Date().toISOString(),
          }, null, 2) }],
        };
      }

      case 'get_team_status': {
        const result = await statusRequest('GET', '/api/status');

        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `Failed to get team status: ${result.error}` }],
            isError: true,
          };
        }

        const agents = result.data as Array<{
          agent_type: string;
          loop_number: number;
          current_status: string;
          current_activity: string;
          presence: string;
          actions_24h: number;
        }>;

        // Format nicely for LLM consumption
        const summary = agents.map(a => ({
          agent: a.agent_type.toUpperCase(),
          status: a.current_status,
          presence: a.presence,
          loop: a.loop_number,
          activity: a.current_activity,
          actions_today: a.actions_24h,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify({
            team_status: summary,
            your_agent: AGENT_TYPE,
            timestamp: new Date().toISOString(),
          }, null, 2) }],
        };
      }

      case 'get_my_history': {
        const { limit = 10 } = args as { limit?: number };
        const actualLimit = Math.min(limit, 100);

        const result = await statusRequest('GET', `/api/history/${AGENT_TYPE}?limit=${actualLimit}`);

        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `Failed to get history: ${result.error}` }],
            isError: true,
          };
        }

        const history = result.data as {
          data: Array<{
            loop_number: number;
            status_type: string;
            activity: string;
            created_at: string;
          }>;
          pagination: { total: number };
        };

        return {
          content: [{ type: 'text', text: JSON.stringify({
            agent: AGENT_TYPE,
            total_entries: history.pagination.total,
            recent_history: history.data.map(h => ({
              loop: h.loop_number,
              status: h.status_type,
              activity: h.activity,
              time: h.created_at,
            })),
          }, null, 2) }],
        };
      }

      case 'get_agent_status': {
        const { agent, limit = 5 } = args as { agent: string; limit?: number };

        const result = await statusRequest('GET', `/api/status/${agent}?limit=${limit}`);

        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `Failed to get agent status: ${result.error}` }],
            isError: true,
          };
        }

        const data = result.data as {
          current: {
            loop_number: number;
            current_status: string;
            current_activity: string;
            presence: string;
            last_seen: string;
          };
          history: Array<{
            loop_number: number;
            status_type: string;
            activity: string;
            created_at: string;
          }>;
        };

        return {
          content: [{ type: 'text', text: JSON.stringify({
            agent: agent.toUpperCase(),
            current: {
              loop: data.current.loop_number,
              status: data.current.current_status,
              activity: data.current.current_activity,
              presence: data.current.presence,
              last_seen: data.current.last_seen,
            },
            recent_activity: data.history.map(h => ({
              loop: h.loop_number,
              status: h.status_type,
              activity: h.activity,
              time: h.created_at,
            })),
          }, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log('error', `Tool failed: ${name}`, { error: errorMessage, durationMs: Date.now() - startTime });
    return {
      content: [{ type: 'text', text: `Tool call failed: ${errorMessage}` }],
      isError: true,
    };
  }
});

// --- Start server ---
async function main() {
  log('info', 'Status MCP Server starting', {
    version: '1.0.0',
    agent: AGENT_TYPE,
    statusService: STATUS_SERVICE_URL
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'Server connected via stdio');
}

main().catch((error) => {
  log('error', 'Fatal error', { error: error instanceof Error ? error.message : 'Unknown error' });
  process.exit(1);
});
