/**
 * Qdrant MCP Server
 *
 * Provides vector search capabilities for AITO agents.
 * Use cases: Code Search, Error Analysis, Duplicate Detection
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

const QDRANT_URL = process.env.QDRANT_URL || 'http://qdrant:6333';

// ============================================
// LOGGING
// ============================================

function log(level: 'info' | 'error' | 'debug', message: string, data?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component: 'qdrant-mcp',
    msg: message,
    ...data,
  };
  console.error(JSON.stringify(entry));
}

// ============================================
// QDRANT CLIENT
// ============================================

interface QdrantResponse<T> {
  result?: T;
  status?: { error?: string };
  time?: number;
}

interface Collection {
  name: string;
}

interface CollectionInfo {
  status: string;
  optimizer_status: string;
  vectors_count: number;
  indexed_vectors_count: number;
  points_count: number;
  segments_count: number;
  config: {
    params: {
      vectors: {
        size: number;
        distance: string;
      };
    };
  };
}

interface Point {
  id: string | number;
  vector?: number[];
  payload?: Record<string, unknown>;
  score?: number;
}

interface SearchResult {
  id: string | number;
  score: number;
  payload?: Record<string, unknown>;
  vector?: number[];
}

async function qdrantRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${QDRANT_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Qdrant API error: ${response.status} - ${text}`);
  }

  if (!text) {
    return {} as T;
  }

  const data = JSON.parse(text) as QdrantResponse<T>;
  if (data.status?.error) {
    throw new Error(`Qdrant error: ${data.status.error}`);
  }

  return data.result as T;
}

// ============================================
// TOOL DEFINITIONS
// ============================================

const tools = [
  {
    name: 'qdrant_list_collections',
    description: 'List all collections in Qdrant',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'qdrant_get_collection',
    description: 'Get detailed info about a collection',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Collection name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'qdrant_create_collection',
    description: 'Create a new collection',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Collection name' },
        vector_size: { type: 'number', description: 'Vector dimension size' },
        distance: {
          type: 'string',
          description: 'Distance metric',
          enum: ['Cosine', 'Euclid', 'Dot'],
        },
      },
      required: ['name', 'vector_size'],
    },
  },
  {
    name: 'qdrant_delete_collection',
    description: 'Delete a collection',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Collection name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'qdrant_search',
    description: 'Search for similar vectors in a collection',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        vector: {
          type: 'array',
          items: { type: 'number' },
          description: 'Query vector',
        },
        limit: { type: 'number', description: 'Max results (default: 10)' },
        with_payload: { type: 'boolean', description: 'Include payload (default: true)' },
        with_vectors: { type: 'boolean', description: 'Include vectors (default: false)' },
        filter: {
          type: 'object',
          description: 'Optional filter conditions',
        },
        score_threshold: { type: 'number', description: 'Min score threshold' },
      },
      required: ['collection', 'vector'],
    },
  },
  {
    name: 'qdrant_upsert_points',
    description: 'Insert or update points in a collection',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        points: {
          type: 'array',
          description: 'Array of points with id, vector, and optional payload',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Point ID' },
              vector: { type: 'array', items: { type: 'number' } },
              payload: { type: 'object' },
            },
          },
        },
        wait: { type: 'boolean', description: 'Wait for indexing (default: true)' },
      },
      required: ['collection', 'points'],
    },
  },
  {
    name: 'qdrant_get_points',
    description: 'Get points by their IDs',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Point IDs to retrieve',
        },
        with_payload: { type: 'boolean', description: 'Include payload (default: true)' },
        with_vectors: { type: 'boolean', description: 'Include vectors (default: false)' },
      },
      required: ['collection', 'ids'],
    },
  },
  {
    name: 'qdrant_delete_points',
    description: 'Delete points by IDs or filter',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Point IDs to delete',
        },
        filter: {
          type: 'object',
          description: 'Filter conditions for deletion (alternative to ids)',
        },
        wait: { type: 'boolean', description: 'Wait for completion (default: true)' },
      },
      required: ['collection'],
    },
  },
  {
    name: 'qdrant_scroll',
    description: 'Scroll through points in a collection',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        limit: { type: 'number', description: 'Points per page (default: 10)' },
        offset: { type: 'string', description: 'Offset point ID for pagination' },
        filter: { type: 'object', description: 'Optional filter conditions' },
        with_payload: { type: 'boolean', description: 'Include payload (default: true)' },
        with_vectors: { type: 'boolean', description: 'Include vectors (default: false)' },
      },
      required: ['collection'],
    },
  },
  {
    name: 'qdrant_count',
    description: 'Count points in a collection',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        filter: { type: 'object', description: 'Optional filter conditions' },
        exact: { type: 'boolean', description: 'Exact count (slower, default: false)' },
      },
      required: ['collection'],
    },
  },
];

// ============================================
// TOOL HANDLERS
// ============================================

async function handleToolCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'qdrant_list_collections': {
      const collections = await qdrantRequest<{ collections: Collection[] }>(
        'GET',
        '/collections'
      );
      return {
        success: true,
        collections: collections.collections.map((c) => c.name),
      };
    }

    case 'qdrant_get_collection': {
      const schema = z.object({ name: z.string() });
      const { name: collName } = schema.parse(args);
      const info = await qdrantRequest<CollectionInfo>(
        'GET',
        `/collections/${collName}`
      );
      return { success: true, collection: collName, info };
    }

    case 'qdrant_create_collection': {
      const schema = z.object({
        name: z.string(),
        vector_size: z.number(),
        distance: z.enum(['Cosine', 'Euclid', 'Dot']).default('Cosine'),
      });
      const { name: collName, vector_size, distance } = schema.parse(args);

      await qdrantRequest('PUT', `/collections/${collName}`, {
        vectors: { size: vector_size, distance },
      });

      return { success: true, collection: collName, vector_size, distance };
    }

    case 'qdrant_delete_collection': {
      const schema = z.object({ name: z.string() });
      const { name: collName } = schema.parse(args);
      await qdrantRequest('DELETE', `/collections/${collName}`);
      return { success: true, deleted: collName };
    }

    case 'qdrant_search': {
      const schema = z.object({
        collection: z.string(),
        vector: z.array(z.number()),
        limit: z.number().default(10),
        with_payload: z.boolean().default(true),
        with_vectors: z.boolean().default(false),
        filter: z.record(z.unknown()).optional(),
        score_threshold: z.number().optional(),
      });
      const params = schema.parse(args);

      const body: Record<string, unknown> = {
        vector: params.vector,
        limit: params.limit,
        with_payload: params.with_payload,
        with_vector: params.with_vectors,
      };

      if (params.filter) body.filter = params.filter;
      if (params.score_threshold) body.score_threshold = params.score_threshold;

      const results = await qdrantRequest<SearchResult[]>(
        'POST',
        `/collections/${params.collection}/points/search`,
        body
      );

      return { success: true, results, count: results.length };
    }

    case 'qdrant_upsert_points': {
      const schema = z.object({
        collection: z.string(),
        points: z.array(
          z.object({
            id: z.union([z.string(), z.number()]),
            vector: z.array(z.number()),
            payload: z.record(z.unknown()).optional(),
          })
        ),
        wait: z.boolean().default(true),
      });
      const params = schema.parse(args);

      await qdrantRequest(
        'PUT',
        `/collections/${params.collection}/points?wait=${params.wait}`,
        { points: params.points }
      );

      return { success: true, upserted: params.points.length };
    }

    case 'qdrant_get_points': {
      const schema = z.object({
        collection: z.string(),
        ids: z.array(z.union([z.string(), z.number()])),
        with_payload: z.boolean().default(true),
        with_vectors: z.boolean().default(false),
      });
      const params = schema.parse(args);

      const result = await qdrantRequest<Point[]>(
        'POST',
        `/collections/${params.collection}/points`,
        {
          ids: params.ids,
          with_payload: params.with_payload,
          with_vector: params.with_vectors,
        }
      );

      return { success: true, points: result };
    }

    case 'qdrant_delete_points': {
      const schema = z.object({
        collection: z.string(),
        ids: z.array(z.union([z.string(), z.number()])).optional(),
        filter: z.record(z.unknown()).optional(),
        wait: z.boolean().default(true),
      });
      const params = schema.parse(args);

      const body: Record<string, unknown> = {};
      if (params.ids) body.points = params.ids;
      if (params.filter) body.filter = params.filter;

      await qdrantRequest(
        'POST',
        `/collections/${params.collection}/points/delete?wait=${params.wait}`,
        body
      );

      return { success: true, deleted: params.ids?.length || 'filtered' };
    }

    case 'qdrant_scroll': {
      const schema = z.object({
        collection: z.string(),
        limit: z.number().default(10),
        offset: z.union([z.string(), z.number()]).optional(),
        filter: z.record(z.unknown()).optional(),
        with_payload: z.boolean().default(true),
        with_vectors: z.boolean().default(false),
      });
      const params = schema.parse(args);

      const body: Record<string, unknown> = {
        limit: params.limit,
        with_payload: params.with_payload,
        with_vector: params.with_vectors,
      };

      if (params.offset) body.offset = params.offset;
      if (params.filter) body.filter = params.filter;

      const result = await qdrantRequest<{ points: Point[]; next_page_offset?: string }>(
        'POST',
        `/collections/${params.collection}/points/scroll`,
        body
      );

      return {
        success: true,
        points: result.points,
        count: result.points.length,
        next_offset: result.next_page_offset,
      };
    }

    case 'qdrant_count': {
      const schema = z.object({
        collection: z.string(),
        filter: z.record(z.unknown()).optional(),
        exact: z.boolean().default(false),
      });
      const params = schema.parse(args);

      const body: Record<string, unknown> = { exact: params.exact };
      if (params.filter) body.filter = params.filter;

      const result = await qdrantRequest<{ count: number }>(
        'POST',
        `/collections/${params.collection}/points/count`,
        body
      );

      return { success: true, collection: params.collection, count: result.count };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ============================================
// SERVER SETUP
// ============================================

const server = new Server(
  { name: 'qdrant-mcp', version: '1.0.0' },
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
  log('info', 'Qdrant MCP Server starting', { qdrantUrl: QDRANT_URL });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('info', 'Qdrant MCP Server running');
}

main().catch((error) => {
  log('error', 'Fatal error', { error: error.message });
  process.exit(1);
});
