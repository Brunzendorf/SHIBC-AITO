/**
 * API Routes v1
 * Main application routes
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

// Request/Response Schemas
const ExampleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  createdAt: z.date(),
});

type Example = z.infer<typeof ExampleSchema>;

const CreateExampleSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/examples
  app.get('/examples', {
    schema: {
      description: 'List all examples',
      tags: ['examples'],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    handler: async () => {
      // TODO: Implement database query
      const examples: Example[] = [];
      return examples;
    },
  });

  // POST /api/v1/examples
  app.post('/examples', {
    schema: {
      description: 'Create a new example',
      tags: ['examples'],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const body = CreateExampleSchema.parse(request.body);

      // TODO: Implement database insert
      const example: Example = {
        id: crypto.randomUUID(),
        name: body.name,
        createdAt: new Date(),
      };

      reply.status(201);
      return example;
    },
  });

  // GET /api/v1/examples/:id
  app.get('/examples/:id', {
    schema: {
      description: 'Get example by ID',
      tags: ['examples'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      // TODO: Implement database query
      reply.status(404);
      return { error: `Example ${id} not found` };
    },
  });
}
