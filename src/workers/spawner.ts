/**
 * Worker Spawner - Spawns and manages MCP workers for C-Level agents
 */

import { createLogger } from '../lib/logger.js';
import { publisher, channels } from '../lib/redis.js';
import { executeWorker, validateWorkerTask, validateServerAccess } from './worker.js';
import type { AgentType, WorkerTask, WorkerResult, AgentMessage } from '../lib/types.js';

const logger = createLogger('spawner');

// Track active workers per agent (for concurrency limits)
const activeWorkers: Map<string, number> = new Map();
const MAX_CONCURRENT_WORKERS = parseInt(process.env.WORKER_MAX_CONCURRENT || '3', 10);

/**
 * Spawn a worker for an agent
 */
export async function spawnWorker(
  parentAgentId: string,
  parentAgentType: AgentType,
  task: string,
  servers: string[],
  context?: Record<string, unknown>,
  timeout?: number
): Promise<WorkerResult> {
  const taskId = crypto.randomUUID();
  
  logger.info({ taskId, parentAgentId, parentAgentType, servers }, 'Spawning worker');
  
  // Check concurrency limit
  const currentCount = activeWorkers.get(parentAgentId) || 0;
  if (currentCount >= MAX_CONCURRENT_WORKERS) {
    logger.warn({ parentAgentId, currentCount, max: MAX_CONCURRENT_WORKERS }, 'Worker limit reached');
    return {
      taskId,
      success: false,
      error: 'Max concurrent workers reached. Try again later.',
      duration: 0,
    };
  }
  
  // Validate server access
  const accessCheck = validateServerAccess(parentAgentType, servers);
  if (!accessCheck.valid) {
    return {
      taskId,
      success: false,
      error: 'Server access denied: ' + accessCheck.denied.join(', '),
      duration: 0,
    };
  }
  
  // Build worker task
  const workerTask: WorkerTask = {
    id: taskId,
    parentAgent: parentAgentType,
    parentAgentId,
    task,
    servers,
    context,
    timeout: timeout || 60000,
  };
  
  // Validate task
  const validation = validateWorkerTask(workerTask);
  if (!validation.valid) {
    return {
      taskId,
      success: false,
      error: 'Invalid task: ' + validation.errors.join(', '),
      duration: 0,
    };
  }
  
  // Track active worker
  activeWorkers.set(parentAgentId, currentCount + 1);
  
  try {
    // Execute worker
    const result = await executeWorker(workerTask);
    
    logger.info({ taskId, success: result.success, duration: result.duration }, 'Worker completed');
    
    return result;
    
  } finally {
    // Decrement active worker count
    const newCount = (activeWorkers.get(parentAgentId) || 1) - 1;
    if (newCount <= 0) {
      activeWorkers.delete(parentAgentId);
    } else {
      activeWorkers.set(parentAgentId, newCount);
    }
  }
}

/**
 * Spawn worker and send result back via Redis pub/sub
 * Used when C-Level agent triggers worker via action
 */
export async function spawnWorkerAsync(
  parentAgentId: string,
  parentAgentType: AgentType,
  task: string,
  servers: string[],
  context?: Record<string, unknown>,
  timeout?: number
): Promise<void> {
  // Run in background, don't await
  spawnWorker(parentAgentId, parentAgentType, task, servers, context, timeout)
    .then(async (result) => {
      // Send result back to parent agent
      const message: AgentMessage = {
        id: crypto.randomUUID(),
        type: 'direct',
        from: 'worker:' + result.taskId,
        to: parentAgentId,
        payload: {
          type: 'worker_result',
          taskId: result.taskId,
          success: result.success,
          result: result.result,
          data: result.data,
          toolsUsed: result.toolsUsed,
          error: result.error,
          duration: result.duration,
        },
        priority: 'normal',
        timestamp: new Date(),
        requiresResponse: false,
      };
      
      await publisher.publish(channels.agent(parentAgentId), JSON.stringify(message));
      logger.debug({ taskId: result.taskId, parentAgentId }, 'Worker result sent to parent');
    })
    .catch((error) => {
      logger.error({ error, parentAgentId }, 'Worker spawn failed');
    });
}

/**
 * Get active worker count for an agent
 */
export function getActiveWorkerCount(agentId: string): number {
  return activeWorkers.get(agentId) || 0;
}

/**
 * Get all active worker counts
 */
export function getAllActiveWorkers(): Map<string, number> {
  return new Map(activeWorkers);
}
