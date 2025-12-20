/**
 * Distributed Tracing Module (TASK-033)
 *
 * Provides trace ID generation and context propagation for request tracking
 * across the AITO system. Uses AsyncLocalStorage for automatic context propagation.
 */

import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';

// Trace context stored in AsyncLocalStorage
export interface TraceContext {
  traceId: string;        // Unique ID for the entire request flow
  spanId: string;         // Unique ID for this specific operation
  parentSpanId?: string;  // Parent operation's span ID
  startTime: number;      // When this span started (ms)
  metadata?: Record<string, unknown>; // Additional context
}

// Global async local storage for trace context
const traceStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Generate a new trace ID (16 hex chars)
 */
export function generateTraceId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Generate a new span ID (8 hex chars)
 */
export function generateSpanId(): string {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Get the current trace context, if any
 */
export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

/**
 * Get the current trace ID, if any
 */
export function getTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId;
}

/**
 * Get the current span ID, if any
 */
export function getSpanId(): string | undefined {
  return traceStorage.getStore()?.spanId;
}

/**
 * Run a function within a new trace context
 */
export function withTrace<T>(
  fn: () => T,
  options?: {
    traceId?: string;
    parentSpanId?: string;
    metadata?: Record<string, unknown>;
  }
): T {
  const context: TraceContext = {
    traceId: options?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: options?.parentSpanId,
    startTime: Date.now(),
    metadata: options?.metadata,
  };

  return traceStorage.run(context, fn);
}

/**
 * Run an async function within a new trace context
 */
export async function withTraceAsync<T>(
  fn: () => Promise<T>,
  options?: {
    traceId?: string;
    parentSpanId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<T> {
  const context: TraceContext = {
    traceId: options?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: options?.parentSpanId,
    startTime: Date.now(),
    metadata: options?.metadata,
  };

  return traceStorage.run(context, fn);
}

/**
 * Create a child span within the current trace
 */
export function createChildSpan<T>(
  fn: () => T,
  metadata?: Record<string, unknown>
): T {
  const parentContext = getTraceContext();

  const context: TraceContext = {
    traceId: parentContext?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: parentContext?.spanId,
    startTime: Date.now(),
    metadata: { ...parentContext?.metadata, ...metadata },
  };

  return traceStorage.run(context, fn);
}

/**
 * Create a child span for async operations
 */
export async function createChildSpanAsync<T>(
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const parentContext = getTraceContext();

  const context: TraceContext = {
    traceId: parentContext?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: parentContext?.spanId,
    startTime: Date.now(),
    metadata: { ...parentContext?.metadata, ...metadata },
  };

  return traceStorage.run(context, fn);
}

/**
 * Get trace info for logging (always returns object, with or without trace)
 */
export function getTraceInfo(): { traceId?: string; spanId?: string; parentSpanId?: string } {
  const ctx = getTraceContext();
  if (!ctx) return {};
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    parentSpanId: ctx.parentSpanId,
  };
}

/**
 * Calculate duration of current span
 */
export function getSpanDuration(): number | undefined {
  const ctx = getTraceContext();
  return ctx ? Date.now() - ctx.startTime : undefined;
}

// HTTP Header names for trace propagation
export const TRACE_HEADER = 'X-Trace-Id';
export const SPAN_HEADER = 'X-Span-Id';
export const PARENT_SPAN_HEADER = 'X-Parent-Span-Id';
