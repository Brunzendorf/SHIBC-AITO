import Redis from 'ioredis';
import { config } from './config.js';
import { createLogger } from './logger.js';
import type { AgentMessage, HealthStatus } from './types.js';

const logger = createLogger('redis');

// =============================================================================
// TASK-031: Redis High Availability with Sentinel Support
// =============================================================================

/**
 * Parse Redis URL or Sentinel configuration
 * Supports:
 * - Standard: redis://host:port
 * - Sentinel: redis-sentinel://sentinel1:26379,sentinel2:26379/mymaster
 */
interface RedisConfig {
  mode: 'standalone' | 'sentinel';
  url?: string;
  sentinels?: Array<{ host: string; port: number }>;
  masterName?: string;
}

function parseRedisConfig(): RedisConfig {
  const url = config.REDIS_URL;

  // Check for Sentinel URL format
  if (url.startsWith('redis-sentinel://')) {
    const parsed = new URL(url.replace('redis-sentinel://', 'http://'));
    const masterName = parsed.pathname.slice(1) || 'mymaster';
    const sentinelHosts = parsed.host.split(',');

    const sentinels = sentinelHosts.map(hostPort => {
      const [host, port] = hostPort.split(':');
      return { host, port: parseInt(port || '26379', 10) };
    });

    logger.info({ sentinels, masterName }, 'Using Redis Sentinel mode');
    return { mode: 'sentinel', sentinels, masterName };
  }

  // Check for REDIS_SENTINELS environment variable
  const sentinelsEnv = process.env.REDIS_SENTINELS;
  if (sentinelsEnv) {
    const masterName = process.env.REDIS_MASTER_NAME || 'mymaster';
    const sentinels = sentinelsEnv.split(',').map(hostPort => {
      const [host, port] = hostPort.trim().split(':');
      return { host, port: parseInt(port || '26379', 10) };
    });

    logger.info({ sentinels, masterName }, 'Using Redis Sentinel mode (from env)');
    return { mode: 'sentinel', sentinels, masterName };
  }

  // Standard standalone mode
  return { mode: 'standalone', url };
}

/**
 * Create Redis client with retry strategy and event handlers
 */
function createRedisClient(name: string): Redis {
  const redisConfig = parseRedisConfig();

  const retryStrategy = (times: number) => {
    if (times > 10) {
      logger.error({ client: name }, 'Redis connection failed after 10 retries');
      return null;
    }
    const delay = Math.min(times * 100, 3000);
    logger.warn({ client: name, attempt: times, delayMs: delay }, 'Redis reconnecting...');
    return delay;
  };

  let client: Redis;

  if (redisConfig.mode === 'sentinel') {
    client = new Redis({
      sentinels: redisConfig.sentinels,
      name: redisConfig.masterName,
      maxRetriesPerRequest: 3,
      retryStrategy,
      // Sentinel-specific options
      sentinelRetryStrategy: retryStrategy,
      enableReadyCheck: true,
      // On failover, reconnect to new master
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          logger.warn({ client: name }, 'Redis READONLY detected, reconnecting to new master...');
          return true;
        }
        return false;
      },
    });
  } else {
    client = new Redis(redisConfig.url!, {
      maxRetriesPerRequest: 3,
      retryStrategy,
    });
  }

  // Event handlers
  client.on('error', (err) => logger.error({ err, client: name }, 'Redis error'));
  client.on('connect', () => logger.info({ client: name }, 'Redis connected'));
  client.on('ready', () => logger.info({ client: name }, 'Redis ready'));
  client.on('close', () => logger.warn({ client: name }, 'Redis connection closed'));
  client.on('reconnecting', () => logger.info({ client: name }, 'Redis reconnecting...'));

  // Sentinel-specific events
  if (redisConfig.mode === 'sentinel') {
    client.on('+switch-master', (masterName: string) => {
      logger.warn({ client: name, masterName }, 'Redis Sentinel: Master switched!');
    });
  }

  return client;
}

// Main Redis client (for commands)
export const redis = createRedisClient('main');

// Subscriber client (dedicated for Pub/Sub)
export const subscriber = createRedisClient('subscriber');

// Publisher client (dedicated for Pub/Sub)
export const publisher = createRedisClient('publisher');

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

/**
 * Publish to both Pub/Sub (for real-time) and Stream (for guaranteed delivery)
 * Use this for critical messages that must not be lost
 *
 * TASK-016: Hybrid approach during migration from Pub/Sub to Streams
 */
export async function publishWithGuarantee(
  channel: string,
  streamKey: string,
  message: AgentMessage
): Promise<{ pubsubDelivered: boolean; streamId: string | null }> {
  let pubsubDelivered = false;
  let streamId: string | null = null;

  // Pub/Sub for real-time (best effort)
  try {
    await publisher.publish(channel, JSON.stringify(message));
    pubsubDelivered = true;
  } catch (err) {
    logger.warn({ err, channel }, 'Pub/Sub publish failed');
  }

  // Stream for guaranteed delivery
  try {
    streamId = await publishToStream(streamKey, message);
  } catch (err) {
    logger.error({ err, streamKey }, 'Stream publish failed');
  }

  logger.debug(
    { channel, streamKey, pubsubDelivered, streamId, messageType: message.type },
    'Published with guarantee'
  );

  return { pubsubDelivered, streamId };
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
/**
 * Push task to queue and notify agent atomically
 * TASK-017: Uses Redis transaction (MULTI/EXEC) to ensure both operations succeed together
 * If crash occurs between operations, either both complete or neither does
 */
export async function pushTask(agentId: string, task: unknown): Promise<void> {
  const taskJson = JSON.stringify(task);
  const notificationJson = JSON.stringify({
    id: crypto.randomUUID(),
    type: 'task_queued',
    from: 'orchestrator',
    to: agentId,
    payload: { message: 'New task in queue' },
    priority: 'normal',
    timestamp: new Date(),
    requiresResponse: false,
  });

  // Use transaction for atomicity - both LPUSH and PUBLISH in same transaction
  const multi = redis.multi();
  multi.lpush(channels.tasks(agentId), taskJson);
  multi.publish(channels.agent(agentId), notificationJson);

  const results = await multi.exec();

  // Check for errors in transaction
  if (results) {
    for (const [err] of results) {
      if (err) {
        throw err;
      }
    }
  }
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

/**
 * TASK-031: Extended health check with HA status
 */
export interface RedisHealthStatus {
  connected: boolean;
  mode: 'standalone' | 'sentinel';
  latencyMs: number;
  role?: string; // 'master' or 'slave'
  connectedSlaves?: number;
  sentinelMaster?: string;
}

export async function getRedisHealth(): Promise<RedisHealthStatus> {
  const startTime = Date.now();
  const redisConfig = parseRedisConfig();

  try {
    const pong = await redis.ping();
    const latencyMs = Date.now() - startTime;

    if (pong !== 'PONG') {
      return { connected: false, mode: redisConfig.mode, latencyMs };
    }

    // Get server info for role detection
    const info = await redis.info('replication');
    const roleMatch = info.match(/role:(\w+)/);
    const role = roleMatch?.[1];
    const slavesMatch = info.match(/connected_slaves:(\d+)/);
    const connectedSlaves = slavesMatch ? parseInt(slavesMatch[1], 10) : undefined;

    return {
      connected: true,
      mode: redisConfig.mode,
      latencyMs,
      role,
      connectedSlaves,
      sentinelMaster: redisConfig.masterName,
    };
  } catch {
    return {
      connected: false,
      mode: redisConfig.mode,
      latencyMs: Date.now() - startTime,
    };
  }
}

// Graceful shutdown
export async function closeConnections(): Promise<void> {
  await Promise.all([redis.quit(), subscriber.quit(), publisher.quit()]);
}

// =============================================================================
// Redis Streams - Guaranteed Message Delivery
// TASK-016: Migration from Pub/Sub to Streams for critical channels
// =============================================================================

/**
 * Stream key patterns - parallel to pub/sub channels
 * Streams provide guaranteed delivery via consumer groups
 */
export const streams = {
  broadcast: 'stream:broadcast',
  head: 'stream:head',
  clevel: 'stream:clevel',
  orchestrator: 'stream:orchestrator',
  agent: (id: string) => `stream:agent:${id}`,
};

/**
 * Publish a message to a Redis Stream
 * Uses XADD with automatic ID generation
 *
 * @param streamKey - The stream key to publish to
 * @param message - The message to publish (will be JSON stringified)
 * @param maxLen - Optional max stream length (uses MAXLEN ~ for performance)
 * @returns The message ID assigned by Redis
 */
export async function publishToStream(
  streamKey: string,
  message: AgentMessage,
  maxLen: number = 10000
): Promise<string> {
  // XADD with MAXLEN ~ (approximate trimming for performance)
  const messageId = await redis.xadd(
    streamKey,
    'MAXLEN',
    '~',
    maxLen.toString(),
    '*', // Auto-generate ID
    'data',
    JSON.stringify(message)
  );

  logger.debug({ streamKey, messageId, messageType: message.type }, 'Published to stream');
  return messageId as string;
}

/**
 * Create a consumer group for a stream
 * Consumer groups enable guaranteed delivery and load balancing
 *
 * @param streamKey - The stream key
 * @param groupName - The consumer group name (e.g., agent ID)
 * @param startId - Where to start reading ('0' for all history, '$' for new only)
 */
export async function createConsumerGroup(
  streamKey: string,
  groupName: string,
  startId: '0' | '$' = '$'
): Promise<boolean> {
  try {
    // MKSTREAM creates the stream if it doesn't exist
    await redis.xgroup('CREATE', streamKey, groupName, startId, 'MKSTREAM');
    logger.info({ streamKey, groupName, startId }, 'Created consumer group');
    return true;
  } catch (err) {
    // BUSYGROUP = group already exists (not an error)
    if (err instanceof Error && err.message.includes('BUSYGROUP')) {
      logger.debug({ streamKey, groupName }, 'Consumer group already exists');
      return true;
    }
    logger.error({ err, streamKey, groupName }, 'Failed to create consumer group');
    throw err;
  }
}

/**
 * Read messages from a stream using a consumer group
 * Provides guaranteed delivery - messages must be acknowledged
 *
 * @param streamKey - The stream key
 * @param groupName - The consumer group name
 * @param consumerName - This consumer's name (e.g., process ID)
 * @param count - Max messages to read
 * @param blockMs - How long to block waiting for messages (0 = forever)
 * @returns Array of messages with their IDs
 */
export async function readFromStream(
  streamKey: string,
  groupName: string,
  consumerName: string,
  count: number = 10,
  blockMs: number = 5000
): Promise<Array<{ id: string; message: AgentMessage }>> {
  try {
    // XREADGROUP GROUP groupName consumerName COUNT count BLOCK blockMs STREAMS streamKey >
    // The '>' means read only new (not yet delivered) messages
    const result = await redis.xreadgroup(
      'GROUP',
      groupName,
      consumerName,
      'COUNT',
      count.toString(),
      'BLOCK',
      blockMs.toString(),
      'STREAMS',
      streamKey,
      '>' // Only undelivered messages
    );

    if (!result) {
      return []; // Timeout, no messages
    }

    const messages: Array<{ id: string; message: AgentMessage }> = [];

    // Result format: [[streamKey, [[id, [field, value, ...]], ...]]]
    // Type assertion for ioredis XREADGROUP result
    type StreamEntry = [string, string[]];
    type StreamResult = [string, StreamEntry[]];
    const typedResult = result as StreamResult[];

    for (const [, entries] of typedResult) {
      for (const [id, fields] of entries) {
        // Fields is ['data', 'jsonstring']
        const dataIndex = fields.indexOf('data');
        if (dataIndex !== -1 && fields[dataIndex + 1]) {
          try {
            const message = JSON.parse(fields[dataIndex + 1]) as AgentMessage;
            messages.push({ id, message });
          } catch {
            logger.warn({ id, streamKey }, 'Failed to parse stream message');
          }
        }
      }
    }

    if (messages.length > 0) {
      logger.debug({ streamKey, count: messages.length }, 'Read messages from stream');
    }

    return messages;
  } catch (err) {
    // NOGROUP = consumer group doesn't exist
    if (err instanceof Error && err.message.includes('NOGROUP')) {
      logger.warn({ streamKey, groupName }, 'Consumer group not found, creating...');
      await createConsumerGroup(streamKey, groupName, '0');
      return []; // Retry will happen on next call
    }
    throw err;
  }
}

/**
 * Acknowledge messages as processed
 * Required for guaranteed delivery - unacked messages will be redelivered
 *
 * @param streamKey - The stream key
 * @param groupName - The consumer group name
 * @param messageIds - Array of message IDs to acknowledge
 */
export async function acknowledgeMessages(
  streamKey: string,
  groupName: string,
  messageIds: string[]
): Promise<number> {
  if (messageIds.length === 0) return 0;

  const acked = await redis.xack(streamKey, groupName, ...messageIds);
  logger.debug({ streamKey, groupName, acked }, 'Acknowledged stream messages');
  return acked;
}

/**
 * Get pending messages (delivered but not acknowledged)
 * Useful for crash recovery - these messages need to be reprocessed
 *
 * @param streamKey - The stream key
 * @param groupName - The consumer group name
 * @param consumerName - Optional: filter by consumer
 */
export async function getPendingMessages(
  streamKey: string,
  groupName: string,
  consumerName?: string
): Promise<Array<{ id: string; consumer: string; idleMs: number; deliveries: number }>> {
  try {
    // XPENDING streamKey groupName - + count [consumer]
    // Use call() to handle dynamic arguments
    let result: unknown[];
    if (consumerName) {
      result = await redis.call(
        'XPENDING', streamKey, groupName, '-', '+', '100', consumerName
      ) as unknown[];
    } else {
      result = await redis.call(
        'XPENDING', streamKey, groupName, '-', '+', '100'
      ) as unknown[];
    }

    if (!result || !Array.isArray(result)) return [];

    // Type the entries properly
    type PendingEntry = [string, string, number, number];
    return (result as PendingEntry[]).map((entry) => ({
      id: entry[0],
      consumer: entry[1],
      idleMs: entry[2],
      deliveries: entry[3],
    }));
  } catch {
    return [];
  }
}

/**
 * Claim pending messages from a dead consumer
 * Use this for crash recovery when a consumer died mid-processing
 *
 * @param streamKey - The stream key
 * @param groupName - The consumer group name
 * @param consumerName - The new consumer taking ownership
 * @param minIdleMs - Only claim messages idle longer than this
 * @param messageIds - Specific message IDs to claim
 */
export async function claimPendingMessages(
  streamKey: string,
  groupName: string,
  consumerName: string,
  minIdleMs: number,
  messageIds: string[]
): Promise<Array<{ id: string; message: AgentMessage }>> {
  if (messageIds.length === 0) return [];

  try {
    // XCLAIM streamKey groupName consumerName minIdleMs id [id ...]
    const result = await redis.xclaim(
      streamKey,
      groupName,
      consumerName,
      minIdleMs.toString(),
      ...messageIds
    );

    const messages: Array<{ id: string; message: AgentMessage }> = [];

    for (const entry of result) {
      const [id, fields] = entry as [string, string[]];
      const dataIndex = fields.indexOf('data');
      if (dataIndex !== -1 && fields[dataIndex + 1]) {
        try {
          const message = JSON.parse(fields[dataIndex + 1]) as AgentMessage;
          messages.push({ id, message });
        } catch {
          logger.warn({ id, streamKey }, 'Failed to parse claimed message');
        }
      }
    }

    if (messages.length > 0) {
      logger.info({ streamKey, claimed: messages.length }, 'Claimed pending messages');
    }

    return messages;
  } catch {
    return [];
  }
}

/**
 * Get stream info (length, consumer groups, etc.)
 */
export async function getStreamInfo(streamKey: string): Promise<{
  length: number;
  groups: number;
  firstId: string | null;
  lastId: string | null;
} | null> {
  try {
    const info = await redis.xinfo('STREAM', streamKey) as unknown[];

    // Parse the flat array response
    const result: Record<string, unknown> = {};
    for (let i = 0; i < info.length; i += 2) {
      result[info[i] as string] = info[i + 1];
    }

    return {
      length: result['length'] as number || 0,
      groups: result['groups'] as number || 0,
      firstId: (result['first-entry'] as unknown[])?.[0] as string || null,
      lastId: (result['last-entry'] as unknown[])?.[0] as string || null,
    };
  } catch {
    return null;
  }
}
