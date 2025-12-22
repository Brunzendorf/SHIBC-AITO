/**
 * Test Harness for E2E Testing
 *
 * This module provides a structured way to run test tasks
 * within the test-agent daemon. It handles test discovery,
 * execution, and result reporting.
 */

import { createLogger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { query } from '../lib/db.js';
import { getSessionPool, shutdownSessionPool } from './session-pool.js';
import { loadProfile } from './profile.js';

const logger = createLogger('test-harness');

/**
 * Test task definition
 */
export interface TestTask {
  id: string;
  name: string;
  type: 'integration' | 'session' | 'agent' | 'mcp' | 'custom';
  action: string;
  config?: Record<string, unknown>;
  expectedResult?: unknown;
  timeout?: number; // ms
}

/**
 * Test result
 */
export interface TestResult {
  testId: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  durationMs: number;
  details?: unknown;
  error?: string;
  timestamp: string;
}

/**
 * Test suite configuration
 */
export interface TestSuiteConfig {
  testTasks: TestTask[];
  currentTaskIndex: number;
  results: TestResult[];
  startedAt?: string;
  completedAt?: string;
}

/**
 * Test Harness - runs test tasks and reports results
 */
export class TestHarness {
  private config: TestSuiteConfig;

  constructor(tasksJson?: string) {
    // Parse test tasks from environment or parameter
    const json = tasksJson || process.env.TEST_TASKS_JSON;

    if (json) {
      try {
        this.config = JSON.parse(json);
        this.config.results = this.config.results || [];
        this.config.currentTaskIndex = this.config.currentTaskIndex || 0;
      } catch (error) {
        logger.error({ error, json: json?.slice(0, 100) }, 'Failed to parse test tasks JSON');
        this.config = this.getDefaultConfig();
      }
    } else {
      this.config = this.getDefaultConfig();
    }

    logger.info({
      totalTasks: this.config.testTasks.length,
      currentIndex: this.config.currentTaskIndex,
    }, 'Test harness initialized');
  }

  private getDefaultConfig(): TestSuiteConfig {
    return {
      testTasks: [
        { id: 'default-1', name: 'Redis Ping', type: 'integration', action: 'ping_redis' },
        { id: 'default-2', name: 'PostgreSQL Ping', type: 'integration', action: 'ping_postgres' },
      ],
      currentTaskIndex: 0,
      results: [],
    };
  }

  /**
   * Get the next test task to execute
   */
  getNextTask(): TestTask | null {
    if (this.config.currentTaskIndex >= this.config.testTasks.length) {
      return null;
    }
    return this.config.testTasks[this.config.currentTaskIndex];
  }

  /**
   * Check if all tests are complete
   */
  isComplete(): boolean {
    return this.config.currentTaskIndex >= this.config.testTasks.length;
  }

  /**
   * Execute the next test task
   */
  async executeNext(): Promise<TestResult | null> {
    const task = this.getNextTask();
    if (!task) {
      logger.info('All tests complete');
      return null;
    }

    logger.info({ testId: task.id, name: task.name, type: task.type }, 'Executing test');

    const startTime = Date.now();
    let result: TestResult;

    try {
      const testResult = await this.executeTask(task);
      const durationMs = Date.now() - startTime;

      result = {
        testId: task.id,
        name: task.name,
        status: testResult.passed ? 'passed' : 'failed',
        durationMs,
        details: testResult.details,
        error: testResult.error,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);

      result = {
        testId: task.id,
        name: task.name,
        status: 'error',
        durationMs,
        error: errMsg,
        timestamp: new Date().toISOString(),
      };
    }

    // Record result
    this.config.results.push(result);
    this.config.currentTaskIndex++;

    // Log result
    if (result.status === 'passed') {
      logger.info({ testId: task.id, durationMs: result.durationMs }, 'Test PASSED');
    } else {
      logger.error({ testId: task.id, error: result.error }, 'Test FAILED');
    }

    // Publish result to Redis for monitoring
    await this.publishResult(result);

    return result;
  }

  /**
   * Execute a single test task
   */
  private async executeTask(task: TestTask): Promise<{ passed: boolean; details?: unknown; error?: string }> {
    // timeout is available via task.timeout if needed by specific tests
    switch (task.type) {
      case 'integration':
        return this.executeIntegrationTest(task);

      case 'session':
        return this.executeSessionTest(task);

      case 'agent':
        return this.executeAgentTest(task);

      case 'mcp':
        return this.executeMcpTest(task);

      case 'custom':
        return { passed: false, error: 'Custom tests not implemented' };

      default:
        return { passed: false, error: `Unknown test type: ${task.type}` };
    }
  }

  /**
   * Execute integration tests (Redis, PostgreSQL, etc.)
   */
  private async executeIntegrationTest(task: TestTask): Promise<{ passed: boolean; details?: unknown; error?: string }> {
    switch (task.action) {
      case 'ping_redis': {
        const startTime = Date.now();
        const result = await redis.ping();
        const latency = Date.now() - startTime;

        return {
          passed: result === 'PONG',
          details: { response: result, latencyMs: latency },
        };
      }

      case 'ping_postgres': {
        const startTime = Date.now();
        const result = await query<{ now: Date }>('SELECT NOW() as now');
        const latency = Date.now() - startTime;

        return {
          passed: result.length === 1 && result[0].now instanceof Date,
          details: { timestamp: result[0]?.now, latencyMs: latency },
        };
      }

      case 'ping_qdrant': {
        // Qdrant health check via HTTP
        try {
          const url = process.env.QDRANT_URL || 'http://qdrant:6333';
          const response = await fetch(`${url}/collections`);
          return {
            passed: response.ok,
            details: { status: response.status },
          };
        } catch (error) {
          return { passed: false, error: String(error) };
        }
      }

      default:
        return { passed: false, error: `Unknown integration action: ${task.action}` };
    }
  }

  /**
   * Execute session pool tests
   */
  private async executeSessionTest(task: TestTask): Promise<{ passed: boolean; details?: unknown; error?: string }> {
    const profilePath = process.env.AGENT_PROFILE || '/app/profiles/test-agent.md';
    const profile = await loadProfile(profilePath, 'test');

    switch (task.action) {
      case 'session_start': {
        try {
          const pool = getSessionPool();
          const session = await pool.getSession({
            agentType: 'test',
            profile,
          });

          return {
            passed: session.isAvailable(),
            details: { sessionId: session.id, state: session.getStatus().state },
          };
        } catch (error) {
          return { passed: false, error: String(error) };
        }
      }

      case 'session_loop': {
        const loops = (task.config?.loops as number) || 3;
        const pool = getSessionPool();

        try {
          const session = await pool.getSession({
            agentType: 'test',
            profile,
          });

          const loopResults: { loop: number; durationMs: number }[] = [];

          for (let i = 0; i < loops; i++) {
            const startTime = Date.now();
            const response = await session.sendMessage(
              `Test loop ${i + 1}. Respond with: {"actions": [], "summary": "Loop ${i + 1} complete"}`,
              60000
            );
            const durationMs = Date.now() - startTime;
            loopResults.push({ loop: i + 1, durationMs });

            // Verify response has expected format
            if (!response.includes('actions')) {
              return { passed: false, error: `Loop ${i + 1} returned invalid response` };
            }
          }

          return {
            passed: true,
            details: { loops: loopResults, totalLoops: session.getStatus().loopCount },
          };
        } catch (error) {
          return { passed: false, error: String(error) };
        }
      }

      case 'session_recycle': {
        const pool = getSessionPool();

        try {
          // Get initial session
          const session1 = await pool.getSession({
            agentType: 'test',
            profile,
            maxLoops: 2, // Force early recycling
          });
          const session1Id = session1.id;

          // Execute enough loops to trigger recycle
          for (let i = 0; i < 2; i++) {
            await session1.sendMessage('Test message', 60000);
          }

          // Get new session (should be different after recycle)
          const session2 = await pool.getSession({
            agentType: 'test',
            profile,
          });

          return {
            passed: session1Id !== session2.id,
            details: {
              originalSessionId: session1Id,
              newSessionId: session2.id,
              recycled: session1Id !== session2.id,
            },
          };
        } catch (error) {
          return { passed: false, error: String(error) };
        } finally {
          await shutdownSessionPool();
        }
      }

      default:
        return { passed: false, error: `Unknown session action: ${task.action}` };
    }
  }

  /**
   * Execute agent communication tests
   */
  private async executeAgentTest(task: TestTask): Promise<{ passed: boolean; details?: unknown; error?: string }> {
    switch (task.action) {
      case 'send_message': {
        // Test Redis pub/sub message sending
        const channel = 'channel:test:dummy';
        const message = { type: 'test', payload: { timestamp: Date.now() } };

        try {
          await redis.publish(channel, JSON.stringify(message));
          return { passed: true, details: { channel, message } };
        } catch (error) {
          return { passed: false, error: String(error) };
        }
      }

      default:
        return { passed: false, error: `Unknown agent action: ${task.action}` };
    }
  }

  /**
   * Execute MCP worker tests
   */
  private async executeMcpTest(_task: TestTask): Promise<{ passed: boolean; details?: unknown; error?: string }> {
    // MCP tests would require actual MCP servers
    // _task contains the test configuration but is unused until MCP is implemented
    return { passed: false, error: 'MCP tests require live MCP servers' };
  }

  /**
   * Publish test result to Redis for monitoring
   */
  private async publishResult(result: TestResult): Promise<void> {
    try {
      await redis.publish('channel:test:results', JSON.stringify(result));
      await redis.lpush('test:results', JSON.stringify(result));
      await redis.ltrim('test:results', 0, 999); // Keep last 1000 results
    } catch (error) {
      logger.warn({ error }, 'Failed to publish test result');
    }
  }

  /**
   * Get test summary
   */
  getSummary(): {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
    results: TestResult[];
    duration: number;
  } {
    const passed = this.config.results.filter(r => r.status === 'passed').length;
    const failed = this.config.results.filter(r => r.status === 'failed').length;
    const skipped = this.config.results.filter(r => r.status === 'skipped').length;
    const errors = this.config.results.filter(r => r.status === 'error').length;
    const duration = this.config.results.reduce((sum, r) => sum + r.durationMs, 0);

    return {
      total: this.config.testTasks.length,
      passed,
      failed,
      skipped,
      errors,
      results: this.config.results,
      duration,
    };
  }

  /**
   * Get updated config for state storage
   */
  getConfig(): TestSuiteConfig {
    return this.config;
  }

  /**
   * Run all tests and return summary
   */
  async runAll(): Promise<ReturnType<typeof this.getSummary>> {
    logger.info({ totalTasks: this.config.testTasks.length }, 'Starting test run');
    this.config.startedAt = new Date().toISOString();

    while (!this.isComplete()) {
      await this.executeNext();
    }

    this.config.completedAt = new Date().toISOString();

    const summary = this.getSummary();

    logger.info({
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      duration: summary.duration,
    }, 'Test run complete');

    // Publish final summary
    await redis.publish('channel:test:complete', JSON.stringify(summary));

    return summary;
  }
}

/**
 * Check if we're running in test mode
 */
export function isTestMode(): boolean {
  return process.env.TEST_MODE === 'true' || process.env.AGENT_TYPE === 'test';
}

/**
 * Get test harness instance
 */
export function getTestHarness(): TestHarness {
  return new TestHarness();
}
