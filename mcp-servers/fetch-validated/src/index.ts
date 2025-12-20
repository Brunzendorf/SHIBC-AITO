#!/usr/bin/env node
/**
 * Validated Fetch MCP Server
 *
 * Domain-validated HTTP fetch server for AITO.
 * Checks URLs against the PostgreSQL whitelist before making requests.
 *
 * Environment Variables:
 * - POSTGRES_URL: PostgreSQL connection string
 * - WHITELIST_CACHE_TTL: Cache TTL in ms (default: 60000)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import pg from 'pg';

const { Pool } = pg;

// Configuration
const POSTGRES_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const CACHE_TTL = parseInt(process.env.WHITELIST_CACHE_TTL || '60000', 10);

// Whitelist cache
let whitelistCache: Set<string> = new Set();
let cacheTimestamp = 0;

// PostgreSQL connection pool
let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool && POSTGRES_URL) {
    pool = new Pool({ connectionString: POSTGRES_URL });
  }
  if (!pool) {
    throw new Error('POSTGRES_URL not configured');
  }
  return pool;
}

/**
 * Load whitelist from PostgreSQL
 */
async function loadWhitelist(): Promise<Set<string>> {
  const now = Date.now();
  if (whitelistCache.size > 0 && now - cacheTimestamp < CACHE_TTL) {
    return whitelistCache;
  }

  try {
    const db = getPool();
    const result = await db.query(
      'SELECT domain FROM domain_whitelist WHERE is_active = true'
    );
    whitelistCache = new Set(result.rows.map((r: { domain: string }) => r.domain.toLowerCase()));
    cacheTimestamp = now;
    console.error(`[fetch-validated] Loaded ${whitelistCache.size} domains from whitelist`);
    return whitelistCache;
  } catch (error) {
    console.error('[fetch-validated] Failed to load whitelist:', error);
    // Return cached version even if stale
    return whitelistCache;
  }
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Check if domain is whitelisted (with subdomain support)
 */
async function isDomainWhitelisted(url: string): Promise<{ allowed: boolean; domain: string | null; reason?: string }> {
  const domain = extractDomain(url);
  if (!domain) {
    return { allowed: false, domain: null, reason: 'Invalid URL' };
  }

  const whitelist = await loadWhitelist();

  // Check exact match
  if (whitelist.has(domain)) {
    return { allowed: true, domain };
  }

  // Check parent domains (e.g., api.coingecko.com → coingecko.com)
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parentDomain = parts.slice(i).join('.');
    if (whitelist.has(parentDomain)) {
      return { allowed: true, domain };
    }
  }

  return {
    allowed: false,
    domain,
    reason: `Domain '${domain}' is not on the whitelist. Request a domain approval via the dashboard.`
  };
}

/**
 * Perform validated fetch
 */
async function validatedFetch(url: string, options?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ success: boolean; content?: string; error?: string; statusCode?: number }> {
  // Validate domain first
  const validation = await isDomainWhitelisted(url);
  if (!validation.allowed) {
    console.error(`[fetch-validated] BLOCKED: ${url} - ${validation.reason}`);
    return {
      success: false,
      error: `SECURITY: Domain blocked - ${validation.reason}`,
    };
  }

  console.error(`[fetch-validated] ALLOWED: ${url} (domain: ${validation.domain})`);

  try {
    const response = await fetch(url, {
      method: options?.method || 'GET',
      headers: options?.headers,
      body: options?.body,
    });

    const contentType = response.headers.get('content-type') || '';
    let content: string;

    if (contentType.includes('application/json')) {
      const json = await response.json();
      content = JSON.stringify(json, null, 2);
    } else {
      content = await response.text();
      // Truncate very long responses
      if (content.length > 50000) {
        content = content.slice(0, 50000) + '\n\n... (truncated)';
      }
    }

    return {
      success: response.ok,
      content,
      statusCode: response.status,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Fetch failed',
    };
  }
}

// Create MCP server
const server = new Server(
  {
    name: 'fetch-validated',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'fetch',
        description: 'Fetch content from a URL. IMPORTANT: Only whitelisted domains are allowed. Non-whitelisted domains will be blocked.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to fetch (must be on the domain whitelist)',
            },
            method: {
              type: 'string',
              description: 'HTTP method (GET, POST, PUT, DELETE)',
              enum: ['GET', 'POST', 'PUT', 'DELETE'],
              default: 'GET',
            },
            headers: {
              type: 'object',
              description: 'Optional HTTP headers',
              additionalProperties: { type: 'string' },
            },
            body: {
              type: 'string',
              description: 'Optional request body (for POST/PUT)',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'check_domain',
        description: 'Check if a domain is on the whitelist before attempting to fetch',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to check',
            },
          },
          required: ['url'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'fetch') {
    const url = args?.url as string;
    if (!url) {
      return {
        content: [{ type: 'text', text: 'Error: URL is required' }],
        isError: true,
      };
    }

    const result = await validatedFetch(url, {
      method: args?.method as string,
      headers: args?.headers as Record<string, string>,
      body: args?.body as string,
    });

    if (!result.success) {
      return {
        content: [{ type: 'text', text: result.error || 'Fetch failed' }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: result.content || '' }],
    };
  }

  if (name === 'check_domain') {
    const url = args?.url as string;
    if (!url) {
      return {
        content: [{ type: 'text', text: 'Error: URL is required' }],
        isError: true,
      };
    }

    const validation = await isDomainWhitelisted(url);
    return {
      content: [{
        type: 'text',
        text: validation.allowed
          ? `Domain '${validation.domain}' is ALLOWED (whitelisted)`
          : `Domain '${validation.domain}' is BLOCKED - ${validation.reason}`,
      }],
    };
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// Start server
async function main() {
  console.error('[fetch-validated] Starting validated fetch MCP server...');

  // Pre-load whitelist
  try {
    await loadWhitelist();
  } catch (e) {
    console.error('[fetch-validated] Warning: Could not pre-load whitelist:', e);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[fetch-validated] Server connected via stdio');
}

main().catch((error) => {
  console.error('[fetch-validated] Fatal error:', error);
  process.exit(1);
});
