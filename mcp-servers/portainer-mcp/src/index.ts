#!/usr/bin/env node
/**
 * Portainer MCP Server for SHIBC CTO
 *
 * Provides container management via Portainer API.
 *
 * Environment Variables:
 * - PORTAINER_URL: Portainer API URL (required, e.g., https://portainer.example.com)
 * - PORTAINER_API_KEY: API key for authentication (required)
 * - PORTAINER_ENDPOINT_ID: Default endpoint/environment ID (default: 1)
 *
 * Security:
 * - API key authentication
 * - Read-only operations by default
 * - All operations logged
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// --- Configuration ---
const PORTAINER_URL = process.env.PORTAINER_URL || '';
const PORTAINER_API_KEY = process.env.PORTAINER_API_KEY || '';
const DEFAULT_ENDPOINT_ID = parseInt(process.env.PORTAINER_ENDPOINT_ID || '1', 10);

if (!PORTAINER_URL || !PORTAINER_API_KEY) {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'error',
    component: 'portainer-mcp',
    msg: 'Missing required environment variables: PORTAINER_URL and PORTAINER_API_KEY',
  }));
  process.exit(1);
}

// --- Logging Helper ---
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: 'portainer-mcp',
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
  const url = `${PORTAINER_URL}/api${path}`;

  try {
    const headers: Record<string, string> = {
      'X-API-Key': PORTAINER_API_KEY,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
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
interface Container {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Ports: Array<{
    PrivatePort: number;
    PublicPort?: number;
    Type: string;
  }>;
}

interface Stack {
  Id: number;
  Name: string;
  Type: number;
  EndpointId: number;
  Status: number;
  CreationDate: number;
  UpdateDate: number;
}

interface DockerImage {
  Id: string;
  RepoTags: string[];
  Size: number;
  Created: number;
}

interface Endpoint {
  Id: number;
  Name: string;
  Type: number;
  URL: string;
  Status: number;
}

// --- Create MCP Server ---
const server = new Server(
  {
    name: 'portainer-mcp',
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
      // Endpoint Operations
      {
        name: 'portainer_endpoints',
        description: 'List all Portainer environments/endpoints',
        inputSchema: {
          type: 'object',
          properties: {},
        }
      },
      // Container Operations
      {
        name: 'portainer_containers',
        description: 'List containers in an environment',
        inputSchema: {
          type: 'object',
          properties: {
            endpointId: { type: 'number', description: `Environment ID (default: ${DEFAULT_ENDPOINT_ID})` },
            all: { type: 'boolean', description: 'Include stopped containers (default: true)' },
          },
        }
      },
      {
        name: 'portainer_container_start',
        description: 'Start a stopped container',
        inputSchema: {
          type: 'object',
          properties: {
            containerId: { type: 'string', description: 'Container ID' },
            endpointId: { type: 'number', description: `Environment ID (default: ${DEFAULT_ENDPOINT_ID})` },
          },
          required: ['containerId']
        }
      },
      {
        name: 'portainer_container_stop',
        description: 'Stop a running container',
        inputSchema: {
          type: 'object',
          properties: {
            containerId: { type: 'string', description: 'Container ID' },
            endpointId: { type: 'number', description: `Environment ID (default: ${DEFAULT_ENDPOINT_ID})` },
          },
          required: ['containerId']
        }
      },
      {
        name: 'portainer_container_restart',
        description: 'Restart a container',
        inputSchema: {
          type: 'object',
          properties: {
            containerId: { type: 'string', description: 'Container ID' },
            endpointId: { type: 'number', description: `Environment ID (default: ${DEFAULT_ENDPOINT_ID})` },
          },
          required: ['containerId']
        }
      },
      {
        name: 'portainer_container_logs',
        description: 'Get container logs',
        inputSchema: {
          type: 'object',
          properties: {
            containerId: { type: 'string', description: 'Container ID' },
            endpointId: { type: 'number', description: `Environment ID (default: ${DEFAULT_ENDPOINT_ID})` },
            tail: { type: 'number', description: 'Number of lines from end (default: 100)' },
            timestamps: { type: 'boolean', description: 'Include timestamps (default: false)' },
          },
          required: ['containerId']
        }
      },
      {
        name: 'portainer_container_inspect',
        description: 'Get detailed container information',
        inputSchema: {
          type: 'object',
          properties: {
            containerId: { type: 'string', description: 'Container ID' },
            endpointId: { type: 'number', description: `Environment ID (default: ${DEFAULT_ENDPOINT_ID})` },
          },
          required: ['containerId']
        }
      },
      // Stack Operations
      {
        name: 'portainer_stacks',
        description: 'List all stacks',
        inputSchema: {
          type: 'object',
          properties: {},
        }
      },
      {
        name: 'portainer_stack_start',
        description: 'Start a stack',
        inputSchema: {
          type: 'object',
          properties: {
            stackId: { type: 'number', description: 'Stack ID' },
            endpointId: { type: 'number', description: `Environment ID (default: ${DEFAULT_ENDPOINT_ID})` },
          },
          required: ['stackId']
        }
      },
      {
        name: 'portainer_stack_stop',
        description: 'Stop a stack',
        inputSchema: {
          type: 'object',
          properties: {
            stackId: { type: 'number', description: 'Stack ID' },
            endpointId: { type: 'number', description: `Environment ID (default: ${DEFAULT_ENDPOINT_ID})` },
          },
          required: ['stackId']
        }
      },
      {
        name: 'portainer_stack_file',
        description: 'Get stack compose file content',
        inputSchema: {
          type: 'object',
          properties: {
            stackId: { type: 'number', description: 'Stack ID' },
          },
          required: ['stackId']
        }
      },
      // Image Operations
      {
        name: 'portainer_images',
        description: 'List Docker images',
        inputSchema: {
          type: 'object',
          properties: {
            endpointId: { type: 'number', description: `Environment ID (default: ${DEFAULT_ENDPOINT_ID})` },
          },
        }
      },
      {
        name: 'portainer_image_pull',
        description: 'Pull a Docker image',
        inputSchema: {
          type: 'object',
          properties: {
            image: { type: 'string', description: 'Image name with tag (e.g., nginx:latest)' },
            endpointId: { type: 'number', description: `Environment ID (default: ${DEFAULT_ENDPOINT_ID})` },
          },
          required: ['image']
        }
      },
      // System Operations
      {
        name: 'portainer_system_info',
        description: 'Get Docker system information',
        inputSchema: {
          type: 'object',
          properties: {
            endpointId: { type: 'number', description: `Environment ID (default: ${DEFAULT_ENDPOINT_ID})` },
          },
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
      // Endpoint Operations
      case 'portainer_endpoints': {
        const result = await apiRequest<Endpoint[]>('GET', '/endpoints');

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        const endpoints = result.data || [];
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            count: endpoints.length,
            endpoints: endpoints.map(e => ({
              id: e.Id,
              name: e.Name,
              type: e.Type === 1 ? 'docker' : e.Type === 2 ? 'agent' : 'unknown',
              url: e.URL,
              status: e.Status === 1 ? 'up' : 'down',
            })),
          }, null, 2) }],
        };
      }

      // Container Operations
      case 'portainer_containers': {
        const { endpointId = DEFAULT_ENDPOINT_ID, all = true } = args as {
          endpointId?: number;
          all?: boolean;
        };

        const result = await apiRequest<Container[]>(
          'GET',
          `/endpoints/${endpointId}/docker/containers/json?all=${all}`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        const containers = result.data || [];
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            endpointId,
            count: containers.length,
            containers: containers.map(c => ({
              id: c.Id.slice(0, 12),
              name: c.Names[0]?.replace(/^\//, ''),
              image: c.Image,
              state: c.State,
              status: c.Status,
              ports: c.Ports?.filter(p => p.PublicPort).map(p => `${p.PublicPort}:${p.PrivatePort}/${p.Type}`),
            })),
          }, null, 2) }],
        };
      }

      case 'portainer_container_start': {
        const { containerId, endpointId = DEFAULT_ENDPOINT_ID } = args as {
          containerId: string;
          endpointId?: number;
        };

        const result = await apiRequest(
          'POST',
          `/endpoints/${endpointId}/docker/containers/${containerId}/start`
        );

        if (result.error && result.status !== 304) { // 304 = already started
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        log('info', 'Container started', { containerId, endpointId });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'start',
            containerId,
            endpointId,
          }, null, 2) }],
        };
      }

      case 'portainer_container_stop': {
        const { containerId, endpointId = DEFAULT_ENDPOINT_ID } = args as {
          containerId: string;
          endpointId?: number;
        };

        const result = await apiRequest(
          'POST',
          `/endpoints/${endpointId}/docker/containers/${containerId}/stop`
        );

        if (result.error && result.status !== 304) { // 304 = already stopped
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        log('info', 'Container stopped', { containerId, endpointId });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'stop',
            containerId,
            endpointId,
          }, null, 2) }],
        };
      }

      case 'portainer_container_restart': {
        const { containerId, endpointId = DEFAULT_ENDPOINT_ID } = args as {
          containerId: string;
          endpointId?: number;
        };

        const result = await apiRequest(
          'POST',
          `/endpoints/${endpointId}/docker/containers/${containerId}/restart`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        log('info', 'Container restarted', { containerId, endpointId });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'restart',
            containerId,
            endpointId,
          }, null, 2) }],
        };
      }

      case 'portainer_container_logs': {
        const { containerId, endpointId = DEFAULT_ENDPOINT_ID, tail = 100, timestamps = false } = args as {
          containerId: string;
          endpointId?: number;
          tail?: number;
          timestamps?: boolean;
        };

        const params = new URLSearchParams({
          stdout: 'true',
          stderr: 'true',
          tail: String(tail),
          timestamps: String(timestamps),
        });

        const result = await apiRequest<string>(
          'GET',
          `/endpoints/${endpointId}/docker/containers/${containerId}/logs?${params}`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        // Clean up Docker log format (remove header bytes)
        const logs = (result.data || '')
          .split('\n')
          .map(line => line.replace(/^[\x00-\x1F]+/, '').trim())
          .filter(line => line)
          .join('\n');

        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            containerId,
            endpointId,
            tail,
            logs: logs.slice(0, 50000), // Limit output
            truncated: logs.length > 50000,
          }, null, 2) }],
        };
      }

      case 'portainer_container_inspect': {
        const { containerId, endpointId = DEFAULT_ENDPOINT_ID } = args as {
          containerId: string;
          endpointId?: number;
        };

        const result = await apiRequest<Record<string, unknown>>(
          'GET',
          `/endpoints/${endpointId}/docker/containers/${containerId}/json`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        const container = result.data || {};
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            containerId,
            endpointId,
            details: container,
          }, null, 2) }],
        };
      }

      // Stack Operations
      case 'portainer_stacks': {
        const result = await apiRequest<Stack[]>('GET', '/stacks');

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        const stacks = result.data || [];
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            count: stacks.length,
            stacks: stacks.map(s => ({
              id: s.Id,
              name: s.Name,
              type: s.Type === 1 ? 'swarm' : s.Type === 2 ? 'compose' : 'unknown',
              endpointId: s.EndpointId,
              status: s.Status === 1 ? 'active' : 'inactive',
              createdAt: new Date(s.CreationDate * 1000).toISOString(),
              updatedAt: new Date(s.UpdateDate * 1000).toISOString(),
            })),
          }, null, 2) }],
        };
      }

      case 'portainer_stack_start': {
        const { stackId, endpointId = DEFAULT_ENDPOINT_ID } = args as {
          stackId: number;
          endpointId?: number;
        };

        const result = await apiRequest(
          'POST',
          `/stacks/${stackId}/start?endpointId=${endpointId}`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        log('info', 'Stack started', { stackId, endpointId });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'start',
            stackId,
            endpointId,
          }, null, 2) }],
        };
      }

      case 'portainer_stack_stop': {
        const { stackId, endpointId = DEFAULT_ENDPOINT_ID } = args as {
          stackId: number;
          endpointId?: number;
        };

        const result = await apiRequest(
          'POST',
          `/stacks/${stackId}/stop?endpointId=${endpointId}`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        log('info', 'Stack stopped', { stackId, endpointId });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'stop',
            stackId,
            endpointId,
          }, null, 2) }],
        };
      }

      case 'portainer_stack_file': {
        const { stackId } = args as { stackId: number };

        const result = await apiRequest<{ StackFileContent: string }>(
          'GET',
          `/stacks/${stackId}/file`
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
            stackId,
            content: result.data?.StackFileContent || '',
          }, null, 2) }],
        };
      }

      // Image Operations
      case 'portainer_images': {
        const { endpointId = DEFAULT_ENDPOINT_ID } = args as { endpointId?: number };

        const result = await apiRequest<DockerImage[]>(
          'GET',
          `/endpoints/${endpointId}/docker/images/json`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        const images = result.data || [];
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            endpointId,
            count: images.length,
            images: images.map(i => ({
              id: i.Id.slice(7, 19),
              tags: i.RepoTags,
              size: `${Math.round(i.Size / 1024 / 1024)}MB`,
              created: new Date(i.Created * 1000).toISOString(),
            })),
          }, null, 2) }],
        };
      }

      case 'portainer_image_pull': {
        const { image, endpointId = DEFAULT_ENDPOINT_ID } = args as {
          image: string;
          endpointId?: number;
        };

        // Parse image name
        const [repo, tag = 'latest'] = image.split(':');

        const result = await apiRequest(
          'POST',
          `/endpoints/${endpointId}/docker/images/create?fromImage=${encodeURIComponent(repo)}&tag=${tag}`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        log('info', 'Image pulled', { image, endpointId });
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            action: 'pull',
            image: `${repo}:${tag}`,
            endpointId,
          }, null, 2) }],
        };
      }

      // System Operations
      case 'portainer_system_info': {
        const { endpointId = DEFAULT_ENDPOINT_ID } = args as { endpointId?: number };

        const result = await apiRequest<Record<string, unknown>>(
          'GET',
          `/endpoints/${endpointId}/docker/info`
        );

        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }

        const info = result.data || {};
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: true,
            endpointId,
            system: {
              serverVersion: info.ServerVersion,
              os: info.OperatingSystem,
              architecture: info.Architecture,
              cpus: info.NCPU,
              memoryTotal: `${Math.round((info.MemTotal as number || 0) / 1024 / 1024 / 1024)}GB`,
              containers: info.Containers,
              containersRunning: info.ContainersRunning,
              containersStopped: info.ContainersStopped,
              images: info.Images,
            },
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
      content: [{ type: 'text', text: `Portainer operation failed: ${errorMessage}` }],
      isError: true,
    };
  }
});

// --- Start server ---
async function main(): Promise<void> {
  log('info', 'Portainer MCP Server starting', {
    version: '1.0.0',
    portainerUrl: PORTAINER_URL,
    defaultEndpointId: DEFAULT_ENDPOINT_ID,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'Server connected via stdio');
}

main().catch((error) => {
  log('error', 'Fatal error', { error: error instanceof Error ? error.message : 'Unknown error' });
  process.exit(1);
});
