/**
 * Tests for Claude retry logic
 * Tests the helper functions without mocking the CLI
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RETRY_CONFIG,
  sleep,
  isRetryableError,
  calculateBackoffDelay,
} from '../claude.js';

describe('Claude Retry Logic', () => {
  describe('RETRY_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(RETRY_CONFIG.maxRetries).toBe(3);
      expect(RETRY_CONFIG.baseDelayMs).toBe(5000);
      expect(RETRY_CONFIG.maxDelayMs).toBe(60000);
      expect(RETRY_CONFIG.retryableErrors).toContain('overloaded_error');
      expect(RETRY_CONFIG.retryableErrors).toContain('529');
      expect(RETRY_CONFIG.retryableErrors).toContain('rate_limit');
    });
  });

  describe('sleep', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve after specified delay', async () => {
      const sleepPromise = sleep(1000);
      vi.advanceTimersByTime(1000);
      await expect(sleepPromise).resolves.toBeUndefined();
    });

    it('should not resolve before delay', async () => {
      let resolved = false;
      sleep(1000).then(() => { resolved = true; });

      vi.advanceTimersByTime(500);
      await Promise.resolve(); // Flush microtasks
      expect(resolved).toBe(false);

      vi.advanceTimersByTime(500);
      await Promise.resolve();
      expect(resolved).toBe(true);
    });
  });

  describe('isRetryableError', () => {
    it('should detect overloaded_error', () => {
      expect(isRetryableError('overloaded_error', '')).toBe(true);
      expect(isRetryableError('{"type":"overloaded_error"}', '')).toBe(true);
    });

    it('should detect 529 error code', () => {
      expect(isRetryableError('529', '')).toBe(true);
      expect(isRetryableError('HTTP 529 Overloaded', '')).toBe(true);
      expect(isRetryableError(undefined, '529 {"type":"error"}')).toBe(true);
    });

    it('should detect rate_limit errors', () => {
      expect(isRetryableError('rate_limit exceeded', '')).toBe(true);
      expect(isRetryableError('Rate_Limit', '')).toBe(true);
    });

    it('should detect timeout errors', () => {
      expect(isRetryableError('timeout', '')).toBe(true);
      expect(isRetryableError('request timeout', '')).toBe(true);
    });

    it('should detect 503 and 502 errors', () => {
      expect(isRetryableError('503 Service Unavailable', '')).toBe(true);
      expect(isRetryableError('502 Bad Gateway', '')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(isRetryableError('OVERLOADED_ERROR', '')).toBe(true);
      expect(isRetryableError('Overloaded', '')).toBe(true);
    });

    it('should check both error and output', () => {
      expect(isRetryableError(undefined, 'overloaded_error in output')).toBe(true);
      expect(isRetryableError('some error', '529 in output')).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      expect(isRetryableError('invalid_api_key', '')).toBe(false);
      expect(isRetryableError('authentication_error', '')).toBe(false);
      expect(isRetryableError('Exit code: 1', '')).toBe(false);
      expect(isRetryableError(undefined, '')).toBe(false);
    });

    it('should return false for empty inputs', () => {
      expect(isRetryableError(undefined, '')).toBe(false);
      expect(isRetryableError('', '')).toBe(false);
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential backoff', () => {
      // With jitter, we can only check approximate ranges
      const delay0 = calculateBackoffDelay(0);
      const delay1 = calculateBackoffDelay(1);
      const delay2 = calculateBackoffDelay(2);

      // Attempt 0: 5000ms base + 0-1000ms jitter = 5000-6000ms
      expect(delay0).toBeGreaterThanOrEqual(5000);
      expect(delay0).toBeLessThanOrEqual(6000);

      // Attempt 1: 10000ms base + jitter = 10000-11000ms
      expect(delay1).toBeGreaterThanOrEqual(10000);
      expect(delay1).toBeLessThanOrEqual(11000);

      // Attempt 2: 20000ms base + jitter = 20000-21000ms
      expect(delay2).toBeGreaterThanOrEqual(20000);
      expect(delay2).toBeLessThanOrEqual(21000);
    });

    it('should respect max delay', () => {
      // Attempt 5 would be 5000 * 2^5 = 160000ms, but max is 60000ms
      const delay = calculateBackoffDelay(5);
      expect(delay).toBeLessThanOrEqual(RETRY_CONFIG.maxDelayMs + 1000); // +1000 for jitter
    });

    it('should add jitter for randomness', () => {
      // Run multiple times, delays should vary
      const delays = Array.from({ length: 10 }, () => calculateBackoffDelay(0));
      const uniqueDelays = new Set(delays);
      // With jitter, we should get some variation (not all identical)
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });
  });
});
