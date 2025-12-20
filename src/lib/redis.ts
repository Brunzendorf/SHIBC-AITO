import Redis from 'ioredis';
import { config } from './config.js';
import { createLogger } from './logger.js';
import type { AgentMessage, HealthStatus } from './types.js';

const logger = createLogger('redis');

// Main Redis client (for commands)
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 10) {
      logger.error('Redis connection failed after 10 retries');
      return null;
    }
    return Math.min(times * 100, 3000);
  },
});

// Subscriber client (dedicated for Pub/Sub)
export const subscriber = new Redis(config.REDIS_URL);

// Publisher client (dedicated for Pub/Sub)
export const publisher = new Redis(config.REDIS_URL);

redis.on('error', (err) => logger.error({ err }, 'Redis error'));
redis.on('connect', () => logger.info('Redis connected'));

subscriber.on('error', (err) => logger.error({ err }, 'Redis subscriber error'));
publisher.on('error', (err) => logger.error({ err }, 'Redis publisher error'));

// Channel names
export const channels = {
  broadcast: 'channel:broadcast',
  head: 'channel:head',
  clevel: 'channel:clevel',
  orchestrator: 'channel:orchestrator', // For workspace updates, RAG indexing
  workerLogs: 'channel:worker:logs', // For MCP worker tool call logging (dashboard)
  agent: (id: string) => `channel:agent:${id}`,
  tasks: (id: string) => `queue:tasks:${id}`,
  urgent: 'queue:urgent',
};

// Key prefixes
export const keys = {
  agentStatus: (id: string) => `agent:status:${id}`,
  rateLimit: (id: string) => `ratelimit:claude:${id}`,
  lock: {
    decision: (id: string) => `lock:decision:${id}`,
    container: (id: string) => `lock:container:${id}`,
  },
};

// Agent Status (Fast Lookup)
export async function setAgentStatus(
  agentId: string,
  status: HealthStatus
): Promise<void> {
  await redis.set(
    keys.agentStatus(agentId),
    JSON.stringify(status),
    'EX',
    300 // 5 min TTL
  );
}

export async function getAgentStatus(agentId: string): Promise<HealthStatus | null> {
  const data = await redis.get(keys.agentStatus(agentId));
  return data ? JSON.parse(data) : null;
}

export async function getAllAgentStatuses(): Promise<Record<string, HealthStatus>> {
  const pattern = 'agent:status:*';
  const keys = await redis.keys(pattern);
  const statuses: Record<string, HealthStatus> = {};

  if (keys.length === 0) return statuses;

  const values = await redis.mget(...keys);
  keys.forEach((key, i) => {
    const agentId = key.replace('agent:status:', '');
    if (values[i]) {
      statuses[agentId] = JSON.parse(values[i]);
    }
  });

  return statuses;
}

// Pub/Sub
type MessageHandler = (message: AgentMessage) => void | Promise<void>;
const handlers: Map<string, MessageHandler[]> = new Map();

export async function subscribe(channel: string, handler: MessageHandler): Promise<void> {
  if (!handlers.has(channel)) {
    handlers.set(channel, []);
    await subscriber.subscribe(channel);
    logger.debug({ channel }, 'Subscribed to channel');
  }
  handlers.get(channel)!.push(handler);
}

export async function unsubscribe(channel: string): Promise<void> {
  handlers.delete(channel);
  await subscriber.unsubscribe(channel);
  logger.debug({ channel }, 'Unsubscribed from channel');
}

export async function publish(channel: string, message: AgentMessage): Promise<void> {
  await publisher.publish(channel, JSON.stringify(message));
  logger.debug({ channel, messageType: message.type }, 'Published message');
}

// Initialize subscriber message handler
subscriber.on('message', async (channel, data) => {
  const channelHandlers = handlers.get(channel);
  if (!channelHandlers || channelHandlers.length === 0) return;

  try {
    const message = JSON.parse(data) as AgentMessage;
    for (const handler of channelHandlers) {
      await handler(message);
    }
  } catch (err) {
    logger.error({ err, channel }, 'Error processing message');
  }
});

// Task Queue
export async function pushTask(agentId: string, task: unknown): Promise<void> {
  await redis.lpush(channels.tasks(agentId), JSON.stringify(task));

  // Wake up agent immediately - send notification via pub/sub
  await publisher.publish(channels.agent(agentId), JSON.stringify({
    id: crypto.randomUUID(),
    type: 'task_queued',
    from: 'orchestrator',
    to: agentId,
    payload: { message: 'New task in queue' },
    priority: 'normal',
    timestamp: new Date(),
    requiresResponse: false,
  }));
}

export async function popTask(agentId: string): Promise<unknown | null> {
  const data = await redis.rpop(channels.tasks(agentId));
  return data ? JSON.parse(data) : null;
}

export async function getTaskCount(agentId: string): Promise<number> {
  return redis.llen(channels.tasks(agentId));
}

// Atomic Task Claiming (RPOPLPUSH pattern to prevent race conditions)
// Processing list key - holds tasks that are currently being processed
const processingKey = (agentId: string) => `queue:processing:${agentId}`;

/**
 * Atomically claim up to `count` tasks from the queue.
 * Tasks are moved to a processing list, preventing race conditions.
 * Returns the claimed tasks as parsed objects.
 */
export async function claimTasks(
  agentId: string,
  count: number = 10
): Promise<Array<{ raw: string; parsed: Record<string, unknown> }>> {
  const queueKey = channels.tasks(agentId);
  const procKey = processingKey(agentId);
  const claimed: Array<{ raw: string; parsed: Record<string, unknown> }> = [];

  // Use LMOVE (Redis 6.2+) or RPOPLPUSH to atomically move items
  // RPOPLPUSH: pops from right of source, pushes to left of destination
  for (let i = 0; i < count; i++) {
    // lmove is preferred (Redis 6.2+), fallback to rpoplpush
    const raw = await redis.rpoplpush(queueKey, procKey);
    if (!raw) break; // Queue empty

    try {
      const parsed = JSON.parse(raw);
      claimed.push({ raw, parsed });
    } catch {
      // Invalid JSON - still add to processing list but skip
      logger.warn({ raw: raw.slice(0, 100) }, 'Invalid JSON in task queue');
      // Remove invalid item from processing
      await redis.lrem(procKey, 1, raw);
    }
  }

  if (claimed.length > 0) {
    logger.debug({ agentId, claimed: claimed.length }, 'Claimed tasks atomically');
  }

  return claimed;
}

/**
 * Acknowledge processed tasks by removing them from the processing list.
 * Call this after successfully processing tasks.
 */
export async function acknowledgeTasks(
  agentId: string,
  tasks: Array<{ raw: string }>
): Promise<void> {
  const procKey = processingKey(agentId);

  // Use pipeline for efficiency
  const pipeline = redis.pipeline();
  for (const task of tasks) {
    pipeline.lrem(procKey, 1, task.raw);
  }
  await pipeline.exec();

  logger.debug({ agentId, acknowledged: tasks.length }, 'Acknowledged processed tasks');
}

/**
 * Recover orphaned tasks from the processing list back to main queue.
 * Call this on agent startup to handle crashes during processing.
 * Tasks are pushed back to the right (end) of the queue so they maintain order.
 */
export async function recoverOrphanedTasks(agentId: string): Promise<number> {
  const queueKey = channels.tasks(agentId);
  const procKey = processingKey(agentId);

  let recovered = 0;
  // Move all items from processing back to main queue
  // Use RPOPLPUSH in reverse: from processing to main queue
  while (true) {
    // Pop from processing, push to END of main queue (rpush via lmove)
    const task = await redis.rpoplpush(procKey, queueKey);
    if (!task) break;
    recovered++;
  }

  if (recovered > 0) {
    logger.info({ agentId, recovered }, 'Recovered orphaned tasks from previous run');
  }

  return recovered;
}

/**
 * Get count of tasks in processing (for monitoring)
 */
export async function getProcessingCount(agentId: string): Promise<number> {
  return redis.llen(processingKey(agentId));
}

// Urgent Queue
export async function pushUrgent(task: unknown): Promise<void> {
  await redis.lpush(channels.urgent, JSON.stringify(task));
}

export async function popUrgent(): Promise<unknown | null> {
  const data = await redis.rpop(channels.urgent);
  return data ? JSON.parse(data) : null;
}

// Distributed Locks
export async function acquireLock(
  key: string,
  ttlSeconds = 60
): Promise<boolean> {
  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

export async function releaseLock(key: string): Promise<void> {
  await redis.del(key);
}

// Rate Limiting
export async function checkRateLimit(
  agentId: string,
  maxRequests: number,
  windowSeconds: number
): Promise<boolean> {
  const key = keys.rateLimit(agentId);
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }

  return current <= maxRequests;
}

// Health check
export async function checkConnection(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

// Graceful shutdown
export async function closeConnections(): Promise<void> {
  await Promise.all([redis.quit(), subscriber.quit(), publisher.quit()]);
}
