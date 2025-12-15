/**
 * WebSocket Server for Real-time Dashboard Updates
 * Streams agent status, worker logs, and inter-agent communication
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../lib/logger.js';
import { subscriber, channels } from '../lib/redis.js';
import { agentRepo } from '../lib/db.js';
import type { Server } from 'http';

const logger = createLogger('websocket');

interface WSMessage {
  type: 'agent_status' | 'worker_log' | 'agent_message' | 'system_event';
  data: unknown;
  timestamp: string;
}

// Track connected clients
const clients = new Set<WebSocket>();

// Agent status cache for initial state
const agentStatusCache = new Map<string, {
  agentId: string;
  agentType: string;
  status: string;
  lastActivity: string;
  currentAction?: string;
}>();

/**
 * Broadcast message to all connected clients
 */
function broadcast(message: WSMessage): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

/**
 * Send current state to a newly connected client
 */
async function sendInitialState(ws: WebSocket): Promise<void> {
  // Send all agent statuses
  const agents = await agentRepo.findAll();
  for (const agent of agents) {
    const cached = agentStatusCache.get(agent.id);
    ws.send(JSON.stringify({
      type: 'agent_status',
      data: {
        agentId: agent.id,
        agentType: agent.type,
        name: agent.name,
        status: agent.status,
        lastActivity: cached?.lastActivity || agent.updatedAt?.toISOString() || new Date().toISOString(),
        currentAction: cached?.currentAction,
      },
      timestamp: new Date().toISOString(),
    }));
  }
}

/**
 * Initialize WebSocket server and Redis subscriptions
 */
export async function initializeWebSocket(server: Server): Promise<WebSocketServer> {
  const wss = new WebSocketServer({ server, path: '/ws' });

  logger.info('WebSocket server initializing...');

  // Handle client connections
  wss.on('connection', async (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    logger.info({ clientIp }, 'WebSocket client connected');
    clients.add(ws);

    // Send initial state
    try {
      await sendInitialState(ws);
    } catch (err) {
      logger.error({ err }, 'Failed to send initial state');
    }

    // Handle client messages (for future: subscriptions, filters)
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        logger.debug({ msg }, 'Received client message');
        // Could implement subscription filters here
      } catch {
        // Ignore invalid messages
      }
    });

    ws.on('close', () => {
      logger.debug({ clientIp }, 'WebSocket client disconnected');
      clients.delete(ws);
    });

    ws.on('error', (err) => {
      logger.error({ err, clientIp }, 'WebSocket error');
      clients.delete(ws);
    });
  });

  // Subscribe to Redis channels for real-time updates
  await subscribeToRedisChannels();

  logger.info({ clientCount: clients.size }, 'WebSocket server initialized');
  return wss;
}

/**
 * Subscribe to Redis pub/sub channels
 */
async function subscribeToRedisChannels(): Promise<void> {
  // Create a dedicated subscriber for WebSocket
  const wsSubscriber = subscriber.duplicate();

  // Pattern subscribe to all agent channels
  await wsSubscriber.psubscribe('channel:agent:*', 'channel:broadcast', 'channel:orchestrator');

  // Subscribe to worker logs
  await wsSubscriber.subscribe(channels.workerLogs);

  // Handle pattern messages
  wsSubscriber.on('pmessage', (pattern: string, channel: string, message: string) => {
    try {
      const parsed = JSON.parse(message);
      handleRedisMessage(channel, parsed);
    } catch {
      // Ignore non-JSON messages
    }
  });

  // Handle regular messages (worker logs)
  wsSubscriber.on('message', (channel: string, message: string) => {
    if (channel === channels.workerLogs) {
      try {
        const parsed = JSON.parse(message);
        broadcast({
          type: 'worker_log',
          data: parsed,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Ignore
      }
    }
  });

  logger.info('Subscribed to Redis channels for WebSocket broadcast');
}

/**
 * Handle Redis messages and broadcast to WebSocket clients
 */
function handleRedisMessage(channel: string, message: unknown): void {
  const msg = message as Record<string, unknown>;

  // Determine message type based on channel
  if (channel.startsWith('channel:agent:')) {
    // Agent-specific message
    const agentId = channel.replace('channel:agent:', '');

    // Update cache
    if (msg.type === 'status_response' || msg.type === 'task' || msg.type === 'decision') {
      const payload = msg.payload as Record<string, unknown>;
      agentStatusCache.set(agentId, {
        agentId,
        agentType: String(payload?.agent || msg.from || '').toLowerCase(),
        status: String(payload?.status || 'active'),
        lastActivity: new Date().toISOString(),
        currentAction: msg.type === 'task' ? String(payload?.title || 'Processing task') : undefined,
      });
    }

    broadcast({
      type: 'agent_message',
      data: {
        channel,
        agentId,
        message: msg,
      },
      timestamp: new Date().toISOString(),
    });
  } else if (channel === channels.broadcast) {
    // Broadcast message - goes to all
    broadcast({
      type: 'system_event',
      data: msg,
      timestamp: new Date().toISOString(),
    });
  } else if (channel === channels.orchestrator) {
    // Orchestrator events
    broadcast({
      type: 'system_event',
      data: {
        source: 'orchestrator',
        ...msg,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Always update agent status on any activity
  if (msg.from && typeof msg.from === 'string') {
    const existing = agentStatusCache.get(msg.from);
    if (existing) {
      existing.lastActivity = new Date().toISOString();
      existing.currentAction = getActionDescription(msg);
    }

    // Broadcast status update
    broadcast({
      type: 'agent_status',
      data: {
        agentId: msg.from,
        lastActivity: new Date().toISOString(),
        currentAction: getActionDescription(msg),
      },
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Get human-readable action description
 */
function getActionDescription(msg: Record<string, unknown>): string | undefined {
  const type = msg.type as string;
  const payload = msg.payload as Record<string, unknown> | undefined;

  switch (type) {
    case 'task':
      return `Processing: ${payload?.title || 'task'}`;
    case 'decision':
      return `Proposing: ${payload?.title || 'decision'}`;
    case 'vote':
      return `Voting on decision`;
    case 'alert':
      return `Sending alert`;
    case 'worker_result':
      return `Worker completed`;
    case 'spawn_worker':
      return `Spawning worker`;
    default:
      return undefined;
  }
}

/**
 * Get current WebSocket stats
 */
export function getWebSocketStats(): { clientCount: number; cachedAgents: number } {
  return {
    clientCount: clients.size,
    cachedAgents: agentStatusCache.size,
  };
}

/**
 * Manually broadcast an event (for use by other modules)
 */
export function broadcastEvent(type: WSMessage['type'], data: unknown): void {
  broadcast({
    type,
    data,
    timestamp: new Date().toISOString(),
  });
}
