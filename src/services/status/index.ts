/**
 * Agent Status Service
 *
 * Provides real-time status updates for all AITO agents.
 * Replaces workspace loop files and "proof" GitHub issues.
 *
 * TASK-108: Agent Status Service
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Pool } from 'pg';
import cors from 'cors';

// Types
interface StatusUpdate {
  agent: string;
  loop: number;
  status: 'working' | 'idle' | 'blocked' | 'completed';
  activity: string;
  issue?: number;
  details?: Record<string, unknown>;
}

interface AgentHeartbeat {
  agent_type: string;
  loop_number: number;
  current_status: string;
  current_activity: string;
  last_seen: Date;
  presence: string;
  actions_24h: number;
}

// Configuration
const PORT = parseInt(process.env.STATUS_PORT || '3002', 10);
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://aito:aito@aito-postgres:5432/aito';

// Database pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// HTTP Server
const server = createServer(app);

// WebSocket Server
const wss = new WebSocketServer({ server, path: '/ws/status-feed' });

// Connected WebSocket clients
const clients = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
  console.log('Dashboard connected to status feed');
  clients.add(ws);

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Dashboard disconnected');
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    clients.delete(ws);
  });

  // Send current status on connect
  getAllStatus().then((statuses) => {
    ws.send(JSON.stringify({ type: 'initial', data: statuses }));
  });
});

// Broadcast to all connected clients
function broadcast(message: object): void {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Database operations
async function updateStatus(update: StatusUpdate): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert status history
    await client.query(
      `INSERT INTO agent_status (agent_type, loop_number, status_type, activity, details, issue_ref)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [update.agent, update.loop, update.status, update.activity, update.details || null, update.issue || null]
    );

    // Update heartbeat
    await client.query(
      `INSERT INTO agent_heartbeat (agent_type, loop_number, current_status, current_activity, last_seen)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (agent_type) DO UPDATE SET
         loop_number = EXCLUDED.loop_number,
         current_status = EXCLUDED.current_status,
         current_activity = EXCLUDED.current_activity,
         last_seen = NOW()`,
      [update.agent, update.loop, update.status, update.activity]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getAllStatus(): Promise<AgentHeartbeat[]> {
  const result = await pool.query('SELECT * FROM agent_status_summary ORDER BY agent_type');
  return result.rows;
}

async function getAgentHistory(agent: string, limit: number = 50): Promise<object[]> {
  const result = await pool.query(
    `SELECT * FROM agent_status
     WHERE agent_type = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [agent, limit]
  );
  return result.rows;
}

// REST API Routes

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'aito-status', timestamp: new Date().toISOString() });
});

// Post status update (called by agents via MCP)
app.post('/api/status', async (req: Request, res: Response) => {
  try {
    const update: StatusUpdate = req.body;

    // Validate required fields
    if (!update.agent || !update.status || !update.activity) {
      res.status(400).json({ error: 'Missing required fields: agent, status, activity' });
      return;
    }

    // Validate agent type
    const validAgents = ['ceo', 'cmo', 'cto', 'cfo', 'coo', 'cco', 'dao'];
    if (!validAgents.includes(update.agent.toLowerCase())) {
      res.status(400).json({ error: `Invalid agent type. Must be one of: ${validAgents.join(', ')}` });
      return;
    }

    // Validate status
    const validStatuses = ['working', 'idle', 'blocked', 'completed'];
    if (!validStatuses.includes(update.status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    await updateStatus({
      ...update,
      agent: update.agent.toLowerCase(),
    });

    // Broadcast to dashboard
    broadcast({
      type: 'update',
      data: {
        agent: update.agent.toLowerCase(),
        loop: update.loop || 0,
        status: update.status,
        activity: update.activity,
        issue: update.issue,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[${update.agent.toUpperCase()}] Loop #${update.loop}: ${update.status} - ${update.activity}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to update status:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Get all agents current status
app.get('/api/status', async (_req: Request, res: Response) => {
  try {
    const statuses = await getAllStatus();
    res.json(statuses);
  } catch (err) {
    console.error('Failed to get status:', err);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Get single agent status + history
app.get('/api/status/:agent', async (req: Request, res: Response) => {
  try {
    const { agent } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 10;

    const [statusResult, history] = await Promise.all([
      pool.query('SELECT * FROM agent_status_summary WHERE agent_type = $1', [agent.toLowerCase()]),
      getAgentHistory(agent.toLowerCase(), limit),
    ]);

    if (statusResult.rows.length === 0) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json({
      current: statusResult.rows[0],
      history,
    });
  } catch (err) {
    console.error('Failed to get agent status:', err);
    res.status(500).json({ error: 'Failed to get agent status' });
  }
});

// Get agent history with pagination
app.get('/api/history/:agent', async (req: Request, res: Response) => {
  try {
    const { agent } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const result = await pool.query(
      `SELECT * FROM agent_status
       WHERE agent_type = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [agent.toLowerCase(), limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM agent_status WHERE agent_type = $1',
      [agent.toLowerCase()]
    );

    res.json({
      data: result.rows,
      pagination: {
        limit,
        offset,
        total: parseInt(countResult.rows[0].total, 10),
      },
    });
  } catch (err) {
    console.error('Failed to get history:', err);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// Cleanup old entries (can be called by cron or manually)
app.post('/api/cleanup', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT cleanup_old_status() as deleted');
    res.json({ deleted: result.rows[0].deleted });
  } catch (err) {
    console.error('Cleanup failed:', err);
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🟢 Agent Status Service running on port ${PORT}`);
  console.log(`   REST API: http://localhost:${PORT}/api/status`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws/status-feed`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down status service...');
  server.close();
  await pool.end();
  process.exit(0);
});
