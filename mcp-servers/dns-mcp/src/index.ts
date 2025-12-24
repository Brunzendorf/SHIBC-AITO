/**
 * DNS MCP Server
 *
 * Manages DNS records via Cloudflare API.
 * Supports A, AAAA, CNAME, TXT, MX records.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// ============================================
// CONFIGURATION
// ============================================

const CLOUDFLARE_API_URL = 'https://api.cloudflare.com/client/v4';
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || '';
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || 'shibaclassic.io').split(',');

// ============================================
// LOGGING
// ============================================

function log(level: 'info' | 'error' | 'debug', message: string, data?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: 'dns-mcp',
    msg: message,
    ...data,
  };
  console.error(JSON.stringify(entry));
}

// ============================================
// SECURITY
// ============================================

function validateDomain(name: string): void {
  const isAllowed = ALLOWED_DOMAINS.some(allowed =>
    name === allowed || name.endsWith(`.${allowed}`)
  );
  if (!isAllowed) {
    throw new Error(`Domain not allowed: ${name}. Allowed: ${ALLOWED_DOMAINS.join(', ')}`);
  }
}

// ============================================
// CLOUDFLARE API
// ============================================

interface CloudflareResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: T;
  result_info?: {
    page: number;
    per_page: number;
    total_count: number;
    total_pages: number;
  };
}

interface DNSRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
  created_on: string;
  modified_on: string;
  priority?: number;
}

async function cloudflareRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  if (!CLOUDFLARE_API_TOKEN) {
    throw new Error('CLOUDFLARE_API_TOKEN not configured');
  }

  const url = `${CLOUDFLARE_API_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json() as CloudflareResponse<T>;

  if (!data.success) {
    const errorMsg = data.errors.map(e => e.message).join(', ');
    throw new Error(`Cloudflare API error: ${errorMsg}`);
  }

  return data.result;
}

async function listZones(): Promise<Array<{ id: string; name: string; status: string }>> {
  return cloudflareRequest<Array<{ id: string; name: string; status: string }>>(
    'GET',
    '/zones'
  );
}

async function listRecords(zoneId: string, type?: string, name?: string): Promise<DNSRecord[]> {
  let path = `/zones/${zoneId}/dns_records`;
  const params: string[] = [];

  if (type) params.push(`type=${type}`);
  if (name) params.push(`name=${name}`);

  if (params.length > 0) {
    path += `?${params.join('&')}`;
  }

  return cloudflareRequest<DNSRecord[]>('GET', path);
}

async function createRecord(options: {
  zoneId: string;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  priority?: number;
}): Promise<DNSRecord> {
  const body: Record<string, unknown> = {
    type: options.type,
    name: options.name,
    content: options.content,
    ttl: options.ttl || 1, // 1 = auto
    proxied: options.proxied ?? false,
  };

  if (options.type === 'MX' && options.priority !== undefined) {
    body.priority = options.priority;
  }

  return cloudflareRequest<DNSRecord>(
    'POST',
    `/zones/${options.zoneId}/dns_records`,
    body
  );
}

async function updateRecord(options: {
  zoneId: string;
  recordId: string;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
}): Promise<DNSRecord> {
  const body = {
    type: options.type,
    name: options.name,
    content: options.content,
    ttl: options.ttl || 1,
    proxied: options.proxied ?? false,
  };

  return cloudflareRequest<DNSRecord>(
    'PUT',
    `/zones/${options.zoneId}/dns_records/${options.recordId}`,
    body
  );
}

async function deleteRecord(zoneId: string, recordId: string): Promise<{ id: string }> {
  return cloudflareRequest<{ id: string }>(
    'DELETE',
    `/zones/${zoneId}/dns_records/${recordId}`
  );
}

// ============================================
// TOOL DEFINITIONS
// ============================================

const tools = [
  {
    name: 'dns_list_zones',
    description: 'List all DNS zones (domains) in Cloudflare account',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'dns_list_records',
    description: 'List DNS records for a zone',
    inputSchema: {
      type: 'object' as const,
      properties: {
        zone_id: { type: 'string', description: 'Zone ID (uses default if not specified)' },
        type: { type: 'string', description: 'Filter by record type (A, AAAA, CNAME, TXT, MX)' },
        name: { type: 'string', description: 'Filter by record name' },
      },
      required: [],
    },
  },
  {
    name: 'dns_create_record',
    description: 'Create a new DNS record',
    inputSchema: {
      type: 'object' as const,
      properties: {
        zone_id: { type: 'string', description: 'Zone ID (uses default if not specified)' },
        type: {
          type: 'string',
          description: 'Record type',
          enum: ['A', 'AAAA', 'CNAME', 'TXT', 'MX'],
        },
        name: { type: 'string', description: 'Record name (e.g., api.shibaclassic.io)' },
        content: { type: 'string', description: 'Record content (IP, hostname, text)' },
        ttl: { type: 'number', description: 'TTL in seconds (1 = auto)' },
        proxied: { type: 'boolean', description: 'Enable Cloudflare proxy (default: false)' },
        priority: { type: 'number', description: 'Priority for MX records' },
      },
      required: ['type', 'name', 'content'],
    },
  },
  {
    name: 'dns_update_record',
    description: 'Update an existing DNS record',
    inputSchema: {
      type: 'object' as const,
      properties: {
        zone_id: { type: 'string', description: 'Zone ID' },
        record_id: { type: 'string', description: 'Record ID to update' },
        type: { type: 'string', description: 'Record type' },
        name: { type: 'string', description: 'Record name' },
        content: { type: 'string', description: 'New record content' },
        ttl: { type: 'number', description: 'TTL in seconds' },
        proxied: { type: 'boolean', description: 'Enable Cloudflare proxy' },
      },
      required: ['record_id', 'type', 'name', 'content'],
    },
  },
  {
    name: 'dns_delete_record',
    description: 'Delete a DNS record',
    inputSchema: {
      type: 'object' as const,
      properties: {
        zone_id: { type: 'string', description: 'Zone ID' },
        record_id: { type: 'string', description: 'Record ID to delete' },
      },
      required: ['record_id'],
    },
  },
  {
    name: 'dns_verify',
    description: 'Verify DNS propagation for a record',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Record name to verify' },
        type: { type: 'string', description: 'Record type (default: A)' },
        expected: { type: 'string', description: 'Expected value (optional)' },
      },
      required: ['name'],
    },
  },
];

// ============================================
// TOOL HANDLERS
// ============================================

async function handleToolCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'dns_list_zones': {
      const zones = await listZones();
      return {
        success: true,
        zones: zones.map(z => ({ id: z.id, name: z.name, status: z.status })),
        count: zones.length,
      };
    }

    case 'dns_list_records': {
      const schema = z.object({
        zone_id: z.string().optional(),
        type: z.string().optional(),
        name: z.string().optional(),
      });
      const params = schema.parse(args);
      const zoneId = params.zone_id || CLOUDFLARE_ZONE_ID;

      if (!zoneId) {
        return { success: false, error: 'No zone_id provided and CLOUDFLARE_ZONE_ID not set' };
      }

      const records = await listRecords(zoneId, params.type, params.name);
      return {
        success: true,
        records: records.map(r => ({
          id: r.id,
          type: r.type,
          name: r.name,
          content: r.content,
          proxied: r.proxied,
          ttl: r.ttl,
        })),
        count: records.length,
      };
    }

    case 'dns_create_record': {
      const schema = z.object({
        zone_id: z.string().optional(),
        type: z.enum(['A', 'AAAA', 'CNAME', 'TXT', 'MX']),
        name: z.string(),
        content: z.string(),
        ttl: z.number().optional(),
        proxied: z.boolean().default(false),
        priority: z.number().optional(),
      });
      const params = schema.parse(args);
      const zoneId = params.zone_id || CLOUDFLARE_ZONE_ID;

      if (!zoneId) {
        return { success: false, error: 'No zone_id provided and CLOUDFLARE_ZONE_ID not set' };
      }

      validateDomain(params.name);

      const record = await createRecord({
        zoneId,
        type: params.type,
        name: params.name,
        content: params.content,
        ttl: params.ttl,
        proxied: params.proxied,
        priority: params.priority,
      });

      log('info', 'DNS record created', { type: params.type, name: params.name });

      return {
        success: true,
        record: {
          id: record.id,
          type: record.type,
          name: record.name,
          content: record.content,
        },
      };
    }

    case 'dns_update_record': {
      const schema = z.object({
        zone_id: z.string().optional(),
        record_id: z.string(),
        type: z.string(),
        name: z.string(),
        content: z.string(),
        ttl: z.number().optional(),
        proxied: z.boolean().optional(),
      });
      const params = schema.parse(args);
      const zoneId = params.zone_id || CLOUDFLARE_ZONE_ID;

      if (!zoneId) {
        return { success: false, error: 'No zone_id provided and CLOUDFLARE_ZONE_ID not set' };
      }

      validateDomain(params.name);

      const record = await updateRecord({
        zoneId,
        recordId: params.record_id,
        type: params.type,
        name: params.name,
        content: params.content,
        ttl: params.ttl,
        proxied: params.proxied,
      });

      log('info', 'DNS record updated', { id: params.record_id, name: params.name });

      return {
        success: true,
        record: {
          id: record.id,
          type: record.type,
          name: record.name,
          content: record.content,
        },
      };
    }

    case 'dns_delete_record': {
      const schema = z.object({
        zone_id: z.string().optional(),
        record_id: z.string(),
      });
      const params = schema.parse(args);
      const zoneId = params.zone_id || CLOUDFLARE_ZONE_ID;

      if (!zoneId) {
        return { success: false, error: 'No zone_id provided and CLOUDFLARE_ZONE_ID not set' };
      }

      await deleteRecord(zoneId, params.record_id);
      log('info', 'DNS record deleted', { id: params.record_id });

      return { success: true, deleted: params.record_id };
    }

    case 'dns_verify': {
      const schema = z.object({
        name: z.string(),
        type: z.string().default('A'),
        expected: z.string().optional(),
      });
      const params = schema.parse(args);

      // Use DNS over HTTPS for verification
      const dohUrl = `https://cloudflare-dns.com/dns-query?name=${params.name}&type=${params.type}`;

      try {
        const response = await fetch(dohUrl, {
          headers: { 'Accept': 'application/dns-json' },
        });
        const data = await response.json() as {
          Status: number;
          Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
        };

        const answers = data.Answer || [];
        const values = answers.map(a => a.data);

        const propagated = params.expected
          ? values.includes(params.expected)
          : values.length > 0;

        return {
          success: true,
          name: params.name,
          type: params.type,
          propagated,
          values,
          expected: params.expected,
        };
      } catch (error) {
        return {
          success: false,
          error: `DNS lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ============================================
// SERVER SETUP
// ============================================

const server = new Server(
  { name: 'dns-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log('info', 'Tool called', { tool: name });

  try {
    const result = await handleToolCall(name, args as Record<string, unknown>);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log('error', 'Tool error', { tool: name, error: message });
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }, null, 2) }],
      isError: true,
    };
  }
});

// ============================================
// MAIN
// ============================================

async function main() {
  log('info', 'DNS MCP Server starting', {
    hasToken: !!CLOUDFLARE_API_TOKEN,
    hasZoneId: !!CLOUDFLARE_ZONE_ID,
    allowedDomains: ALLOWED_DOMAINS,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('info', 'DNS MCP Server running');
}

main().catch((error) => {
  log('error', 'Fatal error', { error: error.message });
  process.exit(1);
});
