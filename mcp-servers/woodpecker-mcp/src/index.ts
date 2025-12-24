#!/usr/bin/env node
/**
 * Woodpecker CI MCP Server for SHIBC CTO
 *
 * Provides CI/CD pipeline management via Woodpecker API.
 *
 * Environment Variables:
 * - WOODPECKER_URL: Woodpecker server URL (required, e.g., https://ci.example.com)
 * - WOODPECKER_TOKEN: Personal Access Token (required)
 *
 * Security:
 * - Token-based authentication
 * - All operations logged
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// --- Configuration ---
const WOODPECKER_URL = process.env.WOODPECKER_URL || '';
const WOODPECKER_TOKEN = process.env.WOODPECKER_TOKEN || '';

if (!WOODPECKER_URL || !WOODPECKER_TOKEN) {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'error',
    component: 'woodpecker-mcp',
    msg: 'Missing required environment variables: WOODPECKER_URL and WOODPECKER_TOKEN',
  }));
  process.exit(1);
}

// --- Logging Helper ---
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: 'woodpecker-mcp',
    msg: message,
    ...data
  };
  console.error(JSON.stringify(entry));
}

// --- API Client ---
interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const url = `${WOODPECKER_URL}/api${path}`;

  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${WOODPECKER_TOKEN}`,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const status = response.status;

    if (!response.ok) {
      const errorText = await response.text();
      return { error: errorText || `HTTP ${status}`, status };
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return { data: {} as T, status };
    }

    try {
      const data = JSON.parse(text) as T;
      return { data, status };
    } catch {
      return { data: text as unknown as T, status };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log('error', 'API request failed', { url, error: errorMessage });
    return { error: errorMessage, status: 0 };
  }
}

// --- Type Definitions ---
interface User {
  id: number;
  login: string;
  email: string;
  admin: boolean;
}

interface Repo {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  clone_url: string;
  default_branch: string;
  active: boolean;
  visibility: string;
}

interface Pipeline {
  id: number;
  number: number;
  parent: number;
  event: string;
  status: string;
  error: string;
  enqueued_at: number;
  created_at: number;
  started_at: number;
  finished_at: number;
  deploy_to: string;
  commit: string;
  branch: string;
  ref: string;
  message: string;
  author: string;
  author_avatar: string;
}

interface Step {
  id: number;
  pid: number;
  ppid: number;
  name: string;
  state: string;
  exit_code: number;
  started: number;
  stopped: number;
}

interface LogEntry {
  id: number;
  step_id: number;
  time: number;
  line: number;
  data: string;
  type: number;
}

// --- Create MCP Server ---
const server = new Server(
  {
    name: 'woodpecker-mcp',
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
      // User/Auth
      {
        name: 'woodpecker_user',
        description: 'Get current authenticated user info',
        inputSchema: {
          type: 'object',
          properties: {},
        }
      },
      // Repository Operations
      {
        name: 'woodpecker_repos',
        description: 'List all repositories',
        inputSchema: {
          type: 'object',
          properties: {},
        }
      },
      {
        name: 'woodpecker_repo',
        description: 'Get repository details',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
          },
          required: ['owner', 'repo']
        }
      },
      {
        name: 'woodpecker_repo_activate',
        description: 'Activate a repository (enable CI)',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
          },
          required: ['owner', 'repo']
        }
      },
      // Pipeline Operations
      {
        name: 'woodpecker_pipelines',
        description: 'List pipelines for a repository',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            page: { type: 'number', description: 'Page number (default: 1)' },
            perPage: { type: 'number', description: 'Items per page (default: 25)' },
          },
          required: ['owner', 'repo']
        }
      },
      {
        name: 'woodpecker_pipeline',
        description: 'Get pipeline details',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            pipeline: { type: 'number', description: 'Pipeline number' },
          },
          required: ['owner', 'repo', 'pipeline']
        }
      },
      {
        name: 'woodpecker_pipeline_create',
        description: 'Trigger a new pipeline/build',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            branch: { type: 'string', description: 'Branch to build (default: default branch)' },
            variables: { type: 'object', description: 'Optional pipeline variables' },
          },
          required: ['owner', 'repo']
        }
      },
      {
        name: 'woodpecker_pipeline_restart',
        description: 'Restart/retry a pipeline',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            pipeline: { type: 'number', description: 'Pipeline number' },
          },
          required: ['owner', 'repo', 'pipeline']
        }
      },
      {
        name: 'woodpecker_pipeline_cancel',
        description: 'Cancel a running pipeline',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            pipeline: { type: 'number', description: 'Pipeline number' },
          },
          required: ['owner', 'repo', 'pipeline']
        }
      },
      {
        name: 'woodpecker_pipeline_approve',
        description: 'Approve a pending pipeline',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            pipeline: { type: 'number', description: 'Pipeline number' },
          },
          required: ['owner', 'repo', 'pipeline']
        }
      },
      {
        name: 'woodpecker_pipeline_decline',
        description: 'Decline a pending pipeline',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            pipeline: { type: 'number', description: 'Pipeline number' },
          },
          required: ['owner', 'repo', 'pipeline']
        }
      },
      // Logs
      {
        name: 'woodpecker_logs',
        description: 'Get pipeline step logs',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
            pipeline: { type: 'number', description: 'Pipeline number' },
            step: { type: 'number', description: 'Step ID (default: 1)' },
          },
          required: ['owner', 'repo', 'pipeline']
        }
      },
      // Secrets
      {
        name: 'woodpecker_secrets',
        description: 'List repository secrets (names only)',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: 'Repository owner' },
            repo: { type: 'string', description: 'Repository name' },
          },
          required: ['owner', 'repo']
        }
      },
      // Server Info
      {
        name: 'woodpecker_version',
        description: 'Get Woodpecker server version',
        inputSchema: {
          type: 'object',
          properties: {},
        }
      },
    ],
  };
});

// --- Handle tool calls ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  log('info', `Tool called: ${name}`, { tool: name, args });

  try {
    switch (name) {
      // User
      case 'woodpecker_user': {
        const result = await apiRequest<User>('GET', '/user');

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            user: result.data,
          }, null, 2) }],
        };
      }

      // Repositories
      case 'woodpecker_repos': {
        const result = await apiRequest<Repo[]>('GET', '/user/repos');

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        const repos = result.data || [];
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            count: repos.length,
            repos: repos.map(r => ({
              id: r.id,
              fullName: r.full_name,
              defaultBranch: r.default_branch,
              active: r.active,
              visibility: r.visibility,
            })),
          }, null, 2) }],
        };
      }

      case 'woodpecker_repo': {
        const { owner, repo } = args as { owner: string; repo: string };

        const result = await apiRequest<Repo>('GET', `/repos/${owner}/${repo}`);

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            repo: result.data,
          }, null, 2) }],
        };
      }

      case 'woodpecker_repo_activate': {
        const { owner, repo } = args as { owner: string; repo: string };

        const result = await apiRequest<Repo>('POST', `/repos/${owner}/${repo}`);

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        log('info', 'Repository activated', { owner, repo });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'activate',
            repo: `${owner}/${repo}`,
          }, null, 2) }],
        };
      }

      // Pipelines
      case 'woodpecker_pipelines': {
        const { owner, repo, page = 1, perPage = 25 } = args as {
          owner: string;
          repo: string;
          page?: number;
          perPage?: number;
        };

        const result = await apiRequest<Pipeline[]>(
          'GET',
          `/repos/${owner}/${repo}/pipelines?page=${page}&per_page=${perPage}`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        const pipelines = result.data || [];
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            repo: `${owner}/${repo}`,
            count: pipelines.length,
            page,
            pipelines: pipelines.map(p => ({
              number: p.number,
              status: p.status,
              event: p.event,
              branch: p.branch,
              commit: p.commit?.slice(0, 7),
              message: p.message?.slice(0, 80),
              author: p.author,
              createdAt: new Date(p.created_at * 1000).toISOString(),
              finishedAt: p.finished_at ? new Date(p.finished_at * 1000).toISOString() : null,
            })),
          }, null, 2) }],
        };
      }

      case 'woodpecker_pipeline': {
        const { owner, repo, pipeline } = args as {
          owner: string;
          repo: string;
          pipeline: number;
        };

        const result = await apiRequest<Pipeline & { steps: Step[] }>(
          'GET',
          `/repos/${owner}/${repo}/pipelines/${pipeline}`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        const p = result.data!;
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            pipeline: {
              number: p.number,
              status: p.status,
              event: p.event,
              branch: p.branch,
              commit: p.commit,
              message: p.message,
              author: p.author,
              error: p.error,
              createdAt: new Date(p.created_at * 1000).toISOString(),
              startedAt: p.started_at ? new Date(p.started_at * 1000).toISOString() : null,
              finishedAt: p.finished_at ? new Date(p.finished_at * 1000).toISOString() : null,
              steps: (p as any).steps?.map((s: Step) => ({
                id: s.id,
                name: s.name,
                state: s.state,
                exitCode: s.exit_code,
              })),
            },
          }, null, 2) }],
        };
      }

      case 'woodpecker_pipeline_create': {
        const { owner, repo, branch, variables } = args as {
          owner: string;
          repo: string;
          branch?: string;
          variables?: Record<string, string>;
        };

        const body: Record<string, unknown> = {};
        if (branch) body.branch = branch;
        if (variables) body.variables = variables;

        const result = await apiRequest<Pipeline>(
          'POST',
          `/repos/${owner}/${repo}/pipelines`,
          body
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        log('info', 'Pipeline created', { owner, repo, pipeline: result.data?.number });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'create',
            repo: `${owner}/${repo}`,
            pipeline: result.data?.number,
            status: result.data?.status,
          }, null, 2) }],
        };
      }

      case 'woodpecker_pipeline_restart': {
        const { owner, repo, pipeline } = args as {
          owner: string;
          repo: string;
          pipeline: number;
        };

        const result = await apiRequest<Pipeline>(
          'POST',
          `/repos/${owner}/${repo}/pipelines/${pipeline}`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        log('info', 'Pipeline restarted', { owner, repo, pipeline });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'restart',
            repo: `${owner}/${repo}`,
            pipeline,
            newPipeline: result.data?.number,
          }, null, 2) }],
        };
      }

      case 'woodpecker_pipeline_cancel': {
        const { owner, repo, pipeline } = args as {
          owner: string;
          repo: string;
          pipeline: number;
        };

        const result = await apiRequest(
          'DELETE',
          `/repos/${owner}/${repo}/pipelines/${pipeline}`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        log('info', 'Pipeline cancelled', { owner, repo, pipeline });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'cancel',
            repo: `${owner}/${repo}`,
            pipeline,
          }, null, 2) }],
        };
      }

      case 'woodpecker_pipeline_approve': {
        const { owner, repo, pipeline } = args as {
          owner: string;
          repo: string;
          pipeline: number;
        };

        const result = await apiRequest(
          'POST',
          `/repos/${owner}/${repo}/pipelines/${pipeline}/approve`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        log('info', 'Pipeline approved', { owner, repo, pipeline });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'approve',
            repo: `${owner}/${repo}`,
            pipeline,
          }, null, 2) }],
        };
      }

      case 'woodpecker_pipeline_decline': {
        const { owner, repo, pipeline } = args as {
          owner: string;
          repo: string;
          pipeline: number;
        };

        const result = await apiRequest(
          'POST',
          `/repos/${owner}/${repo}/pipelines/${pipeline}/decline`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        log('info', 'Pipeline declined', { owner, repo, pipeline });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'decline',
            repo: `${owner}/${repo}`,
            pipeline,
          }, null, 2) }],
        };
      }

      // Logs
      case 'woodpecker_logs': {
        const { owner, repo, pipeline, step = 1 } = args as {
          owner: string;
          repo: string;
          pipeline: number;
          step?: number;
        };

        const result = await apiRequest<LogEntry[]>(
          'GET',
          `/repos/${owner}/${repo}/pipelines/${pipeline}/logs/${step}`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        const logs = result.data || [];
        const logText = logs.map(l => l.data).join('\n');

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            repo: `${owner}/${repo}`,
            pipeline,
            step,
            lineCount: logs.length,
            logs: logText.slice(0, 50000),
            truncated: logText.length > 50000,
          }, null, 2) }],
        };
      }

      // Secrets
      case 'woodpecker_secrets': {
        const { owner, repo } = args as { owner: string; repo: string };

        const result = await apiRequest<Array<{ id: number; name: string }>>(
          'GET',
          `/repos/${owner}/${repo}/secrets`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        const secrets = result.data || [];
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            repo: `${owner}/${repo}`,
            count: secrets.length,
            secrets: secrets.map(s => ({ id: s.id, name: s.name })),
          }, null, 2) }],
        };
      }

      // Version
      case 'woodpecker_version': {
        const result = await apiRequest<{ version: string; source: string }>(
          'GET',
          '/version'
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            version: result.data,
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
      content: [{ type: 'text', text: `Woodpecker operation failed: ${errorMessage}` }],
      isError: true,
    };
  }
});

// --- Start server ---
async function main(): Promise<void> {
  log('info', 'Woodpecker MCP Server starting', {
    version: '1.0.0',
    woodpeckerUrl: WOODPECKER_URL,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'Server connected via stdio');
}

main().catch((error) => {
  log('error', 'Fatal error', { error: error instanceof Error ? error.message : 'Unknown error' });
  process.exit(1);
});
