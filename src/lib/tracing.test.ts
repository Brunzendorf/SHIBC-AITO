/**
 * Tests for Distributed Tracing Module (TASK-033)
 */

import { describe, it, expect } from 'vitest';
import {
  generateTraceId,
  generateSpanId,
  withTrace,
  withTraceAsync,
  getTraceId,
  getSpanId,
  getTraceContext,
  getTraceInfo,
  createChildSpan,
  createChildSpanAsync,
  getSpanDuration,
  TRACE_HEADER,
  SPAN_HEADER,
} from './tracing.js';

describe('Tracing', () => {
  describe('ID Generation', () => {
    it('should generate 16-character trace IDs', () => {
      const traceId = generateTraceId();
      expect(traceId).toHaveLength(16);
      expect(traceId).toMatch(/^[a-f0-9]+$/);
    });

    it('should generate 8-character span IDs', () => {
      const spanId = generateSpanId();
      expect(spanId).toHaveLength(8);
      expect(spanId).toMatch(/^[a-f0-9]+$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateTraceId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('withTrace', () => {
    it('should create trace context for sync functions', () => {
      let capturedTraceId: string | undefined;
      let capturedSpanId: string | undefined;

      withTrace(() => {
        capturedTraceId = getTraceId();
        capturedSpanId = getSpanId();
      });

      expect(capturedTraceId).toBeDefined();
      expect(capturedTraceId).toHaveLength(16);
      expect(capturedSpanId).toBeDefined();
      expect(capturedSpanId).toHaveLength(8);
    });

    it('should use provided trace ID', () => {
      const providedTraceId = 'abc123def4567890';
      let capturedTraceId: string | undefined;

      withTrace(
        () => {
          capturedTraceId = getTraceId();
        },
        { traceId: providedTraceId }
      );

      expect(capturedTraceId).toBe(providedTraceId);
    });

    it('should return the function result', () => {
      const result = withTrace(() => 42);
      expect(result).toBe(42);
    });
  });

  describe('withTraceAsync', () => {
    it('should create trace context for async functions', async () => {
      let capturedTraceId: string | undefined;

      await withTraceAsync(async () => {
        capturedTraceId = getTraceId();
      });

      expect(capturedTraceId).toBeDefined();
      expect(capturedTraceId).toHaveLength(16);
    });

    it('should return the async function result', async () => {
      const result = await withTraceAsync(async () => {
        return 'async result';
      });
      expect(result).toBe('async result');
    });
  });

  describe('getTraceContext', () => {
    it('should return undefined outside of trace context', () => {
      const ctx = getTraceContext();
      expect(ctx).toBeUndefined();
    });

    it('should return context inside trace', () => {
      let ctx;
      withTrace(() => {
        ctx = getTraceContext();
      });

      expect(ctx).toBeDefined();
      expect(ctx).toHaveProperty('traceId');
      expect(ctx).toHaveProperty('spanId');
      expect(ctx).toHaveProperty('startTime');
    });
  });

  describe('getTraceInfo', () => {
    it('should return empty object outside of trace', () => {
      const info = getTraceInfo();
      expect(info).toEqual({});
    });

    it('should return trace info inside trace', () => {
      let info;
      withTrace(() => {
        info = getTraceInfo();
      });

      expect(info).toHaveProperty('traceId');
      expect(info).toHaveProperty('spanId');
    });
  });

  describe('createChildSpan', () => {
    it('should inherit parent trace ID', () => {
      let parentTraceId: string | undefined;
      let childTraceId: string | undefined;
      let childParentSpanId: string | undefined;
      let parentSpanId: string | undefined;

      withTrace(() => {
        parentTraceId = getTraceId();
        parentSpanId = getSpanId();

        createChildSpan(() => {
          childTraceId = getTraceId();
          childParentSpanId = getTraceContext()?.parentSpanId;
        });
      });

      expect(childTraceId).toBe(parentTraceId);
      expect(childParentSpanId).toBe(parentSpanId);
    });

    it('should create new span ID for child', () => {
      let parentSpanId: string | undefined;
      let childSpanId: string | undefined;

      withTrace(() => {
        parentSpanId = getSpanId();
        createChildSpan(() => {
          childSpanId = getSpanId();
        });
      });

      expect(childSpanId).not.toBe(parentSpanId);
    });
  });

  describe('createChildSpanAsync', () => {
    it('should work with async operations', async () => {
      let parentTraceId: string | undefined;
      let childTraceId: string | undefined;

      await withTraceAsync(async () => {
        parentTraceId = getTraceId();

        await createChildSpanAsync(async () => {
          childTraceId = getTraceId();
        });
      });

      expect(childTraceId).toBe(parentTraceId);
    });
  });

  describe('getSpanDuration', () => {
    it('should return undefined outside of trace', () => {
      expect(getSpanDuration()).toBeUndefined();
    });

    it('should return duration inside trace', async () => {
      let duration: number | undefined;

      await withTraceAsync(async () => {
        // Wait a bit to get measurable duration
        await new Promise((r) => setTimeout(r, 10));
        duration = getSpanDuration();
      });

      expect(duration).toBeDefined();
      expect(duration).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Header Constants', () => {
    it('should export correct header names', () => {
      expect(TRACE_HEADER).toBe('X-Trace-Id');
      expect(SPAN_HEADER).toBe('X-Span-Id');
    });
  });
});
