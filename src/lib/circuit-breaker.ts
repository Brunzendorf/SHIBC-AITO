/**
 * Circuit Breaker Module
 *
 * Prevents cascading failures when external APIs are down.
 * Uses the opossum library for circuit breaker pattern.
 *
 * TASK-032: Circuit Breaker for External APIs
 */

import CircuitBreaker from 'opossum';
import { createLogger } from './logger.js';

const logger = createLogger('circuit-breaker');

/**
 * Circuit breaker configuration options
 */
export interface CircuitBreakerOptions {
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
  /** Error threshold percentage to open circuit (default: 50) */
  errorThresholdPercentage?: number;
  /** Time in ms before trying again after circuit opens (default: 30000) */
  resetTimeout?: number;
  /** Rolling window size for stats (default: 10) */
  rollingCountBuckets?: number;
  /** Rolling window duration in ms (default: 10000) */
  rollingCountTimeout?: number;
  /** Minimum requests before circuit can open (default: 5) */
  volumeThreshold?: number;
}

/**
 * Default circuit breaker settings optimized for API calls
 */
const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  timeout: 10000,              // 10 second timeout
  errorThresholdPercentage: 50, // Open if 50% of requests fail
  resetTimeout: 30000,         // Try again after 30 seconds
  rollingCountBuckets: 10,     // 10 buckets for rolling stats
  rollingCountTimeout: 10000,  // 10 second rolling window
  volumeThreshold: 5,          // Need at least 5 requests to open
};

/**
 * GitHub API specific settings (more lenient)
 */
export const GITHUB_OPTIONS: CircuitBreakerOptions = {
  timeout: 15000,              // 15 second timeout (GitHub can be slow)
  errorThresholdPercentage: 60, // More tolerant
  resetTimeout: 60000,         // Wait 1 minute before retry
  volumeThreshold: 3,          // Open after 3 failures
};

/**
 * Registry of all circuit breakers for monitoring
 */
const breakers: Map<string, CircuitBreaker<unknown[], unknown>> = new Map();

/**
 * Create a circuit breaker for an async function
 *
 * @param name - Unique name for this breaker (for logging/monitoring)
 * @param fn - The async function to wrap
 * @param options - Circuit breaker options
 * @param fallback - Optional fallback function when circuit is open
 */
export function createCircuitBreaker<TArgs extends unknown[], TResult>(
  name: string,
  fn: (...args: TArgs) => Promise<TResult>,
  options: CircuitBreakerOptions = {},
  fallback?: (...args: TArgs) => TResult | Promise<TResult>
): CircuitBreaker<TArgs, TResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const breaker = new CircuitBreaker(fn, {
    timeout: opts.timeout,
    errorThresholdPercentage: opts.errorThresholdPercentage,
    resetTimeout: opts.resetTimeout,
    rollingCountBuckets: opts.rollingCountBuckets,
    rollingCountTimeout: opts.rollingCountTimeout,
    volumeThreshold: opts.volumeThreshold,
  });

  // Add fallback if provided
  if (fallback) {
    breaker.fallback(fallback);
  }

  // Event logging
  breaker.on('success', () => {
    logger.debug({ breaker: name }, 'Circuit breaker call succeeded');
  });

  breaker.on('timeout', () => {
    logger.warn({ breaker: name, timeout: opts.timeout }, 'Circuit breaker call timed out');
  });

  breaker.on('reject', () => {
    logger.warn({ breaker: name }, 'Circuit breaker rejected call (circuit open)');
  });

  breaker.on('open', () => {
    logger.error({ breaker: name, resetTimeout: opts.resetTimeout },
      'Circuit breaker OPENED - API calls will be rejected');
  });

  breaker.on('halfOpen', () => {
    logger.info({ breaker: name }, 'Circuit breaker half-open - testing API');
  });

  breaker.on('close', () => {
    logger.info({ breaker: name }, 'Circuit breaker CLOSED - API recovered');
  });

  breaker.on('fallback', () => {
    logger.info({ breaker: name }, 'Circuit breaker using fallback');
  });

  // Register for monitoring
  breakers.set(name, breaker as CircuitBreaker<unknown[], unknown>);

  return breaker;
}

/**
 * Get circuit breaker stats for all registered breakers
 */
export function getCircuitBreakerStats(): Record<string, {
  state: string;
  stats: {
    failures: number;
    successes: number;
    rejects: number;
    timeouts: number;
  };
}> {
  const stats: Record<string, {
    state: string;
    stats: {
      failures: number;
      successes: number;
      rejects: number;
      timeouts: number;
    };
  }> = {};

  for (const [name, breaker] of breakers) {
    const breakerStats = breaker.stats;
    stats[name] = {
      state: breaker.opened ? 'OPEN' : (breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED'),
      stats: {
        failures: breakerStats.failures,
        successes: breakerStats.successes,
        rejects: breakerStats.rejects,
        timeouts: breakerStats.timeouts,
      },
    };
  }

  return stats;
}

/**
 * Check if a specific circuit breaker is open
 */
export function isCircuitOpen(name: string): boolean {
  const breaker = breakers.get(name);
  return breaker ? breaker.opened : false;
}

/**
 * Manually trip a circuit breaker (for testing/emergencies)
 */
export function tripCircuit(name: string): void {
  const breaker = breakers.get(name);
  if (breaker) {
    breaker.open();
    logger.warn({ breaker: name }, 'Circuit breaker manually tripped');
  }
}

/**
 * Manually close a circuit breaker
 */
export function closeCircuit(name: string): void {
  const breaker = breakers.get(name);
  if (breaker) {
    breaker.close();
    logger.info({ breaker: name }, 'Circuit breaker manually closed');
  }
}

/**
 * Wrap an existing async function with circuit breaker protection
 * Returns a new function that uses the circuit breaker
 */
export function withCircuitBreaker<TArgs extends unknown[], TResult>(
  name: string,
  fn: (...args: TArgs) => Promise<TResult>,
  options: CircuitBreakerOptions = {},
  fallback?: (...args: TArgs) => TResult | Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  const breaker = createCircuitBreaker(name, fn, options, fallback);
  return (...args: TArgs) => breaker.fire(...args);
}
