/**
 * TASK-024: Request Validation Schemas using Zod
 * Validates API request bodies and query parameters
 */

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('validation');

// === Common Schemas ===

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const agentTypeSchema = z.enum(['ceo', 'cmo', 'cto', 'cfo', 'coo', 'cco', 'dao']);

export const prioritySchema = z.enum(['low', 'normal', 'high', 'critical', 'urgent']);

// === Task Schemas ===

export const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  assignedTo: z.string().uuid(),
  createdBy: z.string().max(100).optional(),
  priority: z.coerce.number().int().min(1).max(5).optional().default(3),
  dueDate: z.string().datetime().optional(),
});

export const updateTaskStatusSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']),
  result: z.unknown().optional(),
});

// === Decision Schemas ===

export const humanDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(2000).optional(),
});

// === Message Schemas ===

export const sendMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  priority: prioritySchema.optional().default('normal'),
});

export const broadcastSchema = z.object({
  message: z.string().min(1).max(10000),
  priority: prioritySchema.optional().default('normal'),
});

// === Escalation Schemas ===

export const triggerEscalationSchema = z.object({
  reason: z.string().min(1).max(2000),
  decisionId: z.string().uuid().optional(),
  channels: z.array(z.enum(['telegram', 'email', 'slack'])).optional().default(['telegram']),
});

export const escalationResponseSchema = z.object({
  response: z.string().min(1).max(5000),
});

// === Focus Settings Schema ===

export const focusSettingsSchema = z.object({
  revenueFocus: z.coerce.number().min(0).max(100).optional(),
  communityGrowth: z.coerce.number().min(0).max(100).optional(),
  marketingVsDev: z.coerce.number().min(0).max(100).optional(),
  riskTolerance: z.coerce.number().min(0).max(100).optional(),
  timeHorizon: z.coerce.number().min(0).max(100).optional(),
  updatedBy: z.string().max(100).optional(),
});

// === Domain Approval Schemas ===

export const domainApprovalDecisionSchema = z.object({
  reviewedBy: z.string().max(100).optional().default('human'),
  notes: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
});

export const addDomainWhitelistSchema = z.object({
  domain: z.string().min(1).max(255).regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)+$/),
  category: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  addedBy: z.string().max(100).optional().default('human'),
});

// === Settings Schemas ===

export const updateSettingSchema = z.object({
  value: z.unknown(),
  description: z.string().max(500).optional(),
});

// === Benchmark Schemas ===

export const runBenchmarkSchema = z.object({
  models: z.array(z.object({
    provider: z.enum(['claude', 'gemini', 'openai', 'ollama']),
    model: z.string().min(1).max(100),
    displayName: z.string().max(100).optional(),
  })).optional(),
  tasks: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    prompt: z.string(),
    expectedPatterns: z.array(z.string()).optional(),
  })).optional(),
  description: z.string().max(500).optional(),
  enableTools: z.boolean().optional().default(true),
});

// === Validation Middleware Factory ===

type ValidationLocation = 'body' | 'query' | 'params';

/**
 * Create validation middleware for a specific schema
 */
export function validate<T extends z.ZodType>(
  schema: T,
  location: ValidationLocation = 'body'
) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = location === 'body' ? req.body :
                   location === 'query' ? req.query :
                   req.params;

      const result = schema.safeParse(data);

      if (!result.success) {
        const errors = result.error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        }));

        logger.warn({ errors, location }, 'Validation failed');

        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors,
          timestamp: new Date(),
        });
      }

      // Replace with parsed/coerced data
      if (location === 'body') {
        req.body = result.data;
      } else if (location === 'query') {
        (req as Request & { validatedQuery: z.infer<T> }).validatedQuery = result.data;
      } else {
        (req as Request & { validatedParams: z.infer<T> }).validatedParams = result.data;
      }

      next();
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ error: errMsg }, 'Validation middleware error');
      return res.status(500).json({
        success: false,
        error: 'Internal validation error',
        timestamp: new Date(),
      });
    }
  };
}

/**
 * Validate query parameters with default pagination
 */
export function validateQuery<T extends z.ZodType>(schema: T) {
  return validate(schema, 'query');
}

/**
 * Validate route parameters
 */
export function validateParams<T extends z.ZodType>(schema: T) {
  return validate(schema, 'params');
}
