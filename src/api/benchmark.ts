/**
 * Benchmark API Endpoints
 * REST API for running and viewing LLM benchmarks
 */

import { Router, Request, Response } from 'express';
import { benchmarkRunner, BENCHMARK_TASKS } from '../lib/llm/benchmark.js';
import { quotaManager } from '../lib/llm/quota.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('benchmark-api');
const router = Router();

/**
 * GET /api/benchmark/tasks
 * List all available benchmark tasks
 */
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      tasks: BENCHMARK_TASKS,
      totalTasks: BENCHMARK_TASKS.length,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get benchmark tasks');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/benchmark/run
 * Start a new benchmark run
 */
router.post('/run', async (req: Request, res: Response) => {
  try {
    const {
      models = [
        { provider: 'gemini', model: 'gemini-2.0-flash-thinking-exp-1219', displayName: 'Gemini Flash Thinking' },
        { provider: 'gemini', model: 'gemini-2.0-flash-exp', displayName: 'Gemini Flash' },
        { provider: 'gemini', model: 'gemini-exp-1206', displayName: 'Gemini Exp' },
        { provider: 'claude', model: 'default', displayName: 'Claude Sonnet 4.5' },
      ],
      taskIds,
    } = req.body;

    // Filter tasks if specific IDs provided
    const tasks = taskIds
      ? BENCHMARK_TASKS.filter(t => taskIds.includes(t.id))
      : BENCHMARK_TASKS;

    logger.info({ models, taskCount: tasks.length }, 'Starting benchmark run');

    // Run benchmark (this will take time!)
    const result = await benchmarkRunner.runBenchmark(models, tasks);

    res.json({
      success: true,
      runId: result.runId,
      leaderboard: result.leaderboard,
      completedAt: new Date(),
    });
  } catch (error) {
    logger.error({ error }, 'Benchmark run failed');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/benchmark/runs
 * List all benchmark runs
 */
router.get('/runs', async (req: Request, res: Response) => {
  try {
    const runs = await benchmarkRunner.listBenchmarkRuns();

    res.json({
      success: true,
      runs,
      totalRuns: runs.length,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to list benchmark runs');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/benchmark/result/:runId
 * Get full benchmark result
 */
router.get('/result/:runId', async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;
    const result = await benchmarkRunner.getBenchmarkResult(runId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Benchmark run not found',
      });
    }

    return res.json({
      success: true,
      result,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get benchmark result');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/benchmark/quota
 * Get quota information for all providers
 */
router.get('/quota', async (req: Request, res: Response) => {
  try {
    const quotas = await quotaManager.getAllQuotas();
    const comparison = await quotaManager.getUsageComparison();

    res.json({
      success: true,
      quotas,
      comparison,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get quota information');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
