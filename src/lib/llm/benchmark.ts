/**
 * LLM Benchmark System
 * Tests all models with standardized tasks and evaluates with Claude Opus
 */

import { createLogger } from '../logger.js';
import { llmRouter } from './router.js';
import { executeClaudeCode } from '../../agents/claude.js';
import { redis } from '../redis.js';
import type { LLMProviderType, TaskContext } from './types.js';

const logger = createLogger('llm-benchmark');

/**
 * Benchmark task category
 */
export type BenchmarkCategory =
  | 'reasoning'        // Logical reasoning, problem solving
  | 'coding'           // Code generation, debugging
  | 'creative'         // Creative writing, storytelling
  | 'analysis'         // Data analysis, summarization
  | 'factual'          // Factual knowledge, trivia
  | 'conversational'   // Natural conversation, empathy
  | 'technical'        // Technical documentation, explanations
  | 'multilingual';    // Language translation, understanding

/**
 * Benchmark task
 */
export interface BenchmarkTask {
  id: string;
  category: BenchmarkCategory;
  title: string;
  prompt: string;
  expectedOutputType: 'code' | 'text' | 'structured';
  difficultyLevel: 1 | 2 | 3 | 4 | 5; // 1=easy, 5=expert
}

/**
 * Benchmark test configuration
 */
export interface BenchmarkTest {
  models: Array<{
    provider: LLMProviderType;
    model: string;
    displayName: string;
  }>;
  tasks: BenchmarkTask[];
  runId: string;
  timestamp: Date;
}

/**
 * Model response for a task
 */
export interface ModelResponse {
  modelName: string;
  provider: LLMProviderType;
  model: string;
  taskId: string;
  response: string;        // The actual response text (for display)
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * Claude Opus evaluation of a response
 */
export interface OpusEvaluation {
  taskId: string;
  modelName: string;
  scores: {
    accuracy: number;        // 0-100: Correctness of answer
    coherence: number;       // 0-100: Logical flow
    completeness: number;    // 0-100: How complete is the answer
    creativity: number;      // 0-100: Originality (for creative tasks)
    efficiency: number;      // 0-100: Code efficiency (for coding tasks)
  };
  overallScore: number;      // 0-100: Weighted average
  feedback: string;          // Brief explanation of score
  strengths: string[];       // What the model did well
  weaknesses: string[];      // What could be improved
}

/**
 * Complete benchmark result
 */
export interface BenchmarkResult {
  runId: string;
  timestamp: Date;
  tasks: BenchmarkTask[];
  responses: ModelResponse[];
  evaluations: OpusEvaluation[];
  leaderboard: Array<{
    modelName: string;
    provider: LLMProviderType;
    model: string;
    averageScore: number;
    categoryScores: Record<BenchmarkCategory, number>;
    totalDurationMs: number;
    averageDurationMs: number;  // Average time per task
  }>;
}

/**
 * Standard benchmark task suite
 */
export const BENCHMARK_TASKS: BenchmarkTask[] = [
  // REASONING
  {
    id: 'reasoning-1',
    category: 'reasoning',
    title: 'Logical Puzzle',
    prompt: 'Three people are in a room: Alice, Bob, and Charlie. Alice says "I am not the oldest." Bob says "I am not the youngest." Charlie says "I am not in the middle." If exactly one person is lying, who is the youngest?',
    expectedOutputType: 'text',
    difficultyLevel: 3,
  },
  {
    id: 'reasoning-2',
    category: 'reasoning',
    title: 'Math Word Problem',
    prompt: 'A train leaves Station A at 10:00 AM traveling at 60 mph toward Station B, 300 miles away. Another train leaves Station B at 11:00 AM traveling at 90 mph toward Station A. At what time will they meet?',
    expectedOutputType: 'text',
    difficultyLevel: 2,
  },

  // CODING
  {
    id: 'coding-1',
    category: 'coding',
    title: 'Algorithm Implementation',
    prompt: 'Write a TypeScript function that finds the longest palindromic substring in a given string. Include edge cases and optimize for performance.',
    expectedOutputType: 'code',
    difficultyLevel: 4,
  },
  {
    id: 'coding-2',
    category: 'coding',
    title: 'Bug Fix',
    prompt: 'Find and fix the bug in this code:\n```typescript\nfunction calculateAverage(numbers: number[]): number {\n  let sum = 0;\n  for (let i = 0; i <= numbers.length; i++) {\n    sum += numbers[i];\n  }\n  return sum / numbers.length;\n}\n```',
    expectedOutputType: 'code',
    difficultyLevel: 2,
  },

  // CREATIVE
  {
    id: 'creative-1',
    category: 'creative',
    title: 'Short Story',
    prompt: 'Write a 100-word science fiction story about a cryptocurrency project that achieves sentience.',
    expectedOutputType: 'text',
    difficultyLevel: 3,
  },

  // ANALYSIS
  {
    id: 'analysis-1',
    category: 'analysis',
    title: 'Data Interpretation',
    prompt: 'Given this data: [10, 15, 13, 8, 22, 45, 12, 15, 18, 20]. Provide: mean, median, mode, and identify any outliers. Explain why each outlier is significant.',
    expectedOutputType: 'structured',
    difficultyLevel: 2,
  },

  // FACTUAL
  {
    id: 'factual-1',
    category: 'factual',
    title: 'Blockchain Knowledge',
    prompt: 'Explain the difference between Proof of Work and Proof of Stake consensus mechanisms. Which is more energy-efficient and why?',
    expectedOutputType: 'text',
    difficultyLevel: 2,
  },

  // TECHNICAL
  {
    id: 'technical-1',
    category: 'technical',
    title: 'API Documentation',
    prompt: 'Write clear API documentation for a REST endpoint: POST /api/tokens/transfer that transfers tokens between wallets. Include parameters, response format, error codes, and example request.',
    expectedOutputType: 'text',
    difficultyLevel: 3,
  },
];

/**
 * Benchmark Runner
 */
export class BenchmarkRunner {
  private redisKeyPrefix = 'llm:benchmark:';

  /**
   * Run full benchmark test
   */
  async runBenchmark(
    models: BenchmarkTest['models'],
    tasks: BenchmarkTask[] = BENCHMARK_TASKS,
    enableTools: boolean = true
  ): Promise<BenchmarkResult> {
    const runId = `bench-${Date.now()}`;
    const timestamp = new Date();

    logger.info({ runId, modelCount: models.length, taskCount: tasks.length, enableTools }, 'Starting benchmark');

    const responses: ModelResponse[] = [];

    // Run all models on all tasks
    for (const model of models) {
      for (const task of tasks) {
        logger.info({ model: model.displayName, task: task.title }, 'Running task');

        try {
          const startTime = Date.now();
          const result = await llmRouter.execute(
            {
              prompt: task.prompt,
              timeout: 60000, // 1 minute per task
              model: model.model,
              enableTools,
            },
            {
              taskType: 'loop',
              estimatedComplexity: task.difficultyLevel >= 4 ? 'complex' : 'medium',
            } as TaskContext
          );
          const durationMs = Date.now() - startTime;

          responses.push({
            modelName: model.displayName,
            provider: model.provider,
            model: model.model,
            taskId: task.id,
            response: result.output,
            durationMs,
            success: result.success,
            error: result.error,
          });
        } catch (error) {
          logger.error({ error, model: model.displayName, task: task.title }, 'Task failed');
          responses.push({
            modelName: model.displayName,
            provider: model.provider,
            model: model.model,
            taskId: task.id,
            response: '',
            durationMs: 0,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Evaluate all responses with Claude Opus
    logger.info({ responseCount: responses.length }, 'Evaluating responses with Claude Opus');
    const evaluations = await this.evaluateWithOpus(tasks, responses);

    // Calculate leaderboard
    const leaderboard = this.calculateLeaderboard(models, tasks, responses, evaluations);

    const benchmarkResult: BenchmarkResult = {
      runId,
      timestamp,
      tasks,
      responses,
      evaluations,
      leaderboard,
    };

    // Save to Redis
    await this.saveBenchmarkResult(benchmarkResult);

    logger.info({ runId, leaderboard }, 'Benchmark completed');

    return benchmarkResult;
  }

  /**
   * Evaluate responses with Claude Opus (anonymized)
   */
  private async evaluateWithOpus(
    tasks: BenchmarkTask[],
    responses: ModelResponse[]
  ): Promise<OpusEvaluation[]> {
    const evaluations: OpusEvaluation[] = [];

    for (const response of responses) {
      if (!response.success) {
        // Skip failed responses
        evaluations.push({
          taskId: response.taskId,
          modelName: response.modelName,
          scores: {
            accuracy: 0,
            coherence: 0,
            completeness: 0,
            creativity: 0,
            efficiency: 0,
          },
          overallScore: 0,
          feedback: 'Response failed - no evaluation performed',
          strengths: [],
          weaknesses: ['Failed to generate response'],
        });
        continue;
      }

      const task = tasks.find(t => t.id === response.taskId);
      if (!task) continue;

      // Create anonymized evaluation prompt
      const evaluationPrompt = `You are evaluating an AI model's response to a task. You must be objective and fair.

**Task Category:** ${task.category}
**Task Title:** ${task.title}
**Difficulty Level:** ${task.difficultyLevel}/5
**Task Prompt:**
${task.prompt}

**Model Response (ANONYMIZED):**
${response.response}

**Evaluation Criteria:**
Please rate the response on a scale of 0-100 for each criterion:
1. **Accuracy**: How correct is the answer?
2. **Coherence**: Is the response logical and well-structured?
3. **Completeness**: Does it fully address the task?
4. **Creativity**: Is it original or creative (if applicable)?
5. **Efficiency**: Is the solution efficient (for code tasks)?

**Output Format (JSON only):**
\`\`\`json
{
  "scores": {
    "accuracy": <0-100>,
    "coherence": <0-100>,
    "completeness": <0-100>,
    "creativity": <0-100>,
    "efficiency": <0-100>
  },
  "overallScore": <0-100>,
  "feedback": "Brief 1-2 sentence feedback",
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1", "weakness 2"]
}
\`\`\``;

      try {
        // Use Claude Opus for evaluation (not via router - direct call)
        const evalResult = await executeClaudeCode({
          prompt: evaluationPrompt,
          timeout: 30000,
        });

        if (evalResult.success) {
          // Parse JSON from output
          const jsonMatch = evalResult.output.match(/```json\s*([\s\S]*?)```/);
          if (jsonMatch) {
            const evalData = JSON.parse(jsonMatch[1]);
            evaluations.push({
              taskId: response.taskId,
              modelName: response.modelName,
              ...evalData,
            });
          } else {
            throw new Error('No JSON found in evaluation output');
          }
        } else {
          throw new Error(evalResult.error || 'Evaluation failed');
        }
      } catch (error) {
        logger.error({ error, taskId: task.id, model: response.modelName }, 'Opus evaluation failed');
        evaluations.push({
          taskId: response.taskId,
          modelName: response.modelName,
          scores: {
            accuracy: 50,
            coherence: 50,
            completeness: 50,
            creativity: 50,
            efficiency: 50,
          },
          overallScore: 50,
          feedback: 'Evaluation failed - using default score',
          strengths: [],
          weaknesses: [],
        });
      }
    }

    return evaluations;
  }

  /**
   * Calculate leaderboard from evaluations
   */
  private calculateLeaderboard(
    models: BenchmarkTest['models'],
    tasks: BenchmarkTask[],
    responses: ModelResponse[],
    evaluations: OpusEvaluation[]
  ): BenchmarkResult['leaderboard'] {
    const leaderboard = models.map(model => {
      const modelResponses = responses.filter(r => r.modelName === model.displayName);
      const modelEvaluations = evaluations.filter(e => e.modelName === model.displayName);

      const averageScore = modelEvaluations.length > 0
        ? modelEvaluations.reduce((sum, e) => sum + e.overallScore, 0) / modelEvaluations.length
        : 0;

      const categoryScores: Record<BenchmarkCategory, number> = {} as any;
      const categories = Array.from(new Set(tasks.map(t => t.category)));

      for (const category of categories) {
        const categoryTasks = tasks.filter(t => t.category === category);
        const categoryEvals = modelEvaluations.filter(e =>
          categoryTasks.some(t => t.id === e.taskId)
        );
        categoryScores[category] = categoryEvals.length > 0
          ? categoryEvals.reduce((sum, e) => sum + e.overallScore, 0) / categoryEvals.length
          : 0;
      }

      const totalDurationMs = modelResponses.reduce((sum, r) => sum + r.durationMs, 0);
      const averageDurationMs = modelResponses.length > 0
        ? totalDurationMs / modelResponses.length
        : 0;

      return {
        modelName: model.displayName,
        provider: model.provider,
        model: model.model,
        averageScore,
        categoryScores,
        totalDurationMs,
        averageDurationMs,
      };
    });

    // Sort by average score (descending)
    leaderboard.sort((a, b) => b.averageScore - a.averageScore);

    return leaderboard;
  }

  /**
   * Save benchmark result to Redis
   */
  private async saveBenchmarkResult(result: BenchmarkResult): Promise<void> {
    const key = `${this.redisKeyPrefix}${result.runId}`;
    await redis.setex(key, 30 * 24 * 60 * 60, JSON.stringify(result)); // 30 days
    logger.info({ runId: result.runId }, 'Benchmark result saved');
  }

  /**
   * Get benchmark result by ID
   */
  async getBenchmarkResult(runId: string): Promise<BenchmarkResult | null> {
    const key = `${this.redisKeyPrefix}${runId}`;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * List all benchmark runs
   */
  async listBenchmarkRuns(): Promise<Array<{ runId: string; timestamp: Date }>> {
    const pattern = `${this.redisKeyPrefix}*`;
    const keys = await redis.keys(pattern);

    const runs = await Promise.all(
      keys.map(async key => {
        const data = await redis.get(key);
        if (!data) return null;
        const result = JSON.parse(data) as BenchmarkResult;
        return {
          runId: result.runId,
          timestamp: new Date(result.timestamp),
        };
      })
    );

    return runs.filter(r => r !== null) as Array<{ runId: string; timestamp: Date }>;
  }
}

// Export singleton instance
export const benchmarkRunner = new BenchmarkRunner();
