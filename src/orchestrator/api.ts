import express, { Request, Response, NextFunction } from 'express';
import { createLogger } from '../lib/logger.js';
import { numericConfig } from '../lib/config.js';
import { agentRepo, eventRepo, taskRepo, decisionRepo, escalationRepo, historyRepo } from '../lib/db.js';
import { publisher, channels, redis } from '../lib/redis.js';
import { startAgent, stopAgent, restartAgent, getAgentContainerStatus, listManagedContainers } from './container.js';
import { getScheduledJobs, pauseJob, resumeJob } from './scheduler.js';
import { getSystemHealth, isAlive, isReady, getAgentHealth } from './health.js';
import { triggerEscalation } from './events.js';
import type { AgentType, AgentMessage, ApiResponse, DecisionStatus } from '../lib/types.js';
import crypto from 'crypto';

const logger = createLogger('api');

export const app = express();

// Middleware
app.use(express.json());

// CORS middleware - allow dashboard access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200); return;
  }
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.debug({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
});

// Error handler
const asyncHandler = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

// Response helper
function sendResponse<T>(res: Response, data: T, status = 200): void {
  const response: ApiResponse<T> = {
    success: true,
    data,
    timestamp: new Date(),
  };
  res.status(status).json(response);
}

function sendError(res: Response, message: string, status = 500): void {
  const response: ApiResponse = {
    success: false,
    error: message,
    timestamp: new Date(),
  };
  res.status(status).json(response);
}

// === Health Endpoints ===

// Liveness probe
app.get('/health', asyncHandler(async (_req, res) => {
  const alive = await isAlive();
  res.status(alive ? 200 : 503).json({ status: alive ? 'ok' : 'error' });
}));

// Readiness probe
app.get('/ready', asyncHandler(async (_req, res) => {
  const ready = await isReady();
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'not ready' });
}));

// Full system health
app.get('/health/full', asyncHandler(async (_req, res) => {
  const health = await getSystemHealth();
  const status = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
  sendResponse(res, health, status);
}));

// === Agent Endpoints ===

// List all agents
app.get('/agents', asyncHandler(async (_req, res) => {
  const agents = await agentRepo.findAll();
  const agentsWithStatus = await Promise.all(
    agents.map(async (agent) => ({
      ...agent,
      containerStatus: await getAgentContainerStatus(agent.type),
    }))
  );
  sendResponse(res, agentsWithStatus);
}));

// Get agent by type
app.get('/agents/:type', asyncHandler(async (req, res) => {
  const agentType = req.params.type as AgentType;
  const agent = await agentRepo.findByType(agentType);

  if (!agent) {
    return sendError(res, 'Agent not found', 404);
  }

  const containerStatus = await getAgentContainerStatus(agentType);
  sendResponse(res, { ...agent, containerStatus });
}));

// Get agent history
app.get('/agents/:type/history', asyncHandler(async (req, res) => {
  const agentType = req.params.type as AgentType;
  const limit = parseInt(req.query.limit as string) || 50;
  const agent = await agentRepo.findByType(agentType);

  if (!agent) {
    return sendError(res, 'Agent not found', 404);
  }

  const history = await historyRepo.getRecent(agent.id, limit);
  sendResponse(res, history);
}));

// Start agent
app.post('/agents/:type/start', asyncHandler(async (req, res) => {
  const agentType = req.params.type as AgentType;
  logger.info({ agentType }, 'Starting agent via API');

  try {
    const containerId = await startAgent(agentType);
    sendResponse(res, { agentType, containerId, status: 'started' });
  } catch (err) {
    logger.error({ err, agentType }, 'Failed to start agent');
    sendError(res, String(err), 500);
  }
}));

// Stop agent
app.post('/agents/:type/stop', asyncHandler(async (req, res) => {
  const agentType = req.params.type as AgentType;
  logger.info({ agentType }, 'Stopping agent via API');

  try {
    await stopAgent(agentType);
    sendResponse(res, { agentType, status: 'stopped' });
  } catch (err) {
    logger.error({ err, agentType }, 'Failed to stop agent');
    sendError(res, String(err), 500);
  }
}));

// Restart agent
app.post('/agents/:type/restart', asyncHandler(async (req, res) => {
  const agentType = req.params.type as AgentType;
  logger.info({ agentType }, 'Restarting agent via API');

  try {
    const containerId = await restartAgent(agentType);
    sendResponse(res, { agentType, containerId, status: 'restarted' });
  } catch (err) {
    logger.error({ err, agentType }, 'Failed to restart agent');
    sendError(res, String(err), 500);
  }
}));

// Get agent health
app.get('/agents/:type/health', asyncHandler(async (req, res) => {
  const agentType = req.params.type as AgentType;
  const health = await getAgentHealth(agentType);

  if (!health) {
    return sendError(res, 'Agent not found or not running', 404);
  }

  sendResponse(res, health);
}));

// === Container Endpoints ===

// List all managed containers
app.get('/containers', asyncHandler(async (_req, res) => {
  const containers = await listManagedContainers();
  sendResponse(res, containers);
}));

// === Event Endpoints ===

// Get recent events
app.get('/events', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const events = await eventRepo.getRecent(limit);
  sendResponse(res, events);
}));

// Get events for specific agent
app.get('/events/agent/:id', asyncHandler(async (req, res) => {
  const agentId = req.params.id;
  const limit = parseInt(req.query.limit as string) || 50;
  const events = await eventRepo.getByAgent(agentId, limit);
  sendResponse(res, events);
}));

// === Task Endpoints ===

// Get tasks for agent
app.get('/tasks/agent/:id', asyncHandler(async (req, res) => {
  const agentId = req.params.id;
  const status = req.query.status as string | undefined;
  const tasks = await taskRepo.findByAgent(agentId, status as any);
  sendResponse(res, tasks);
}));

// Create task
app.post('/tasks', asyncHandler(async (req, res) => {
  const { title, description, assignedTo, createdBy, priority, dueDate } = req.body;

  const task = await taskRepo.create({
    title,
    description,
    assignedTo,
    createdBy: createdBy || 'api',
    status: 'pending',
    priority: priority || 3,
    dueDate: dueDate ? new Date(dueDate) : undefined,
  });

  sendResponse(res, task, 201);
}));

// Update task status
app.patch('/tasks/:id/status', asyncHandler(async (req, res) => {
  const taskId = req.params.id;
  const { status, result } = req.body;

  await taskRepo.updateStatus(taskId, status, result);
  sendResponse(res, { taskId, status });
}));

// === Worker Execution Endpoints ===

// Worker execution log entry interface
interface WorkerLogEntry {
  timestamp: string;
  taskId: string;
  parentAgent: string;
  servers: string[];
  task?: string;
  toolsUsed?: string[];
  success: boolean;
  duration: number;
  error?: string;
  mode?: string;
  dryRun?: boolean;
}

// Get all worker executions (combined real + dry-run)
app.get('/workers', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const agentFilter = req.query.agent as string | undefined;
  const includeDryRun = req.query.includeDryRun !== 'false';

  // Fetch from Redis
  const realLogs = await redis.lrange('worker:logs:history', 0, limit - 1);
  const dryRunLogs = includeDryRun ? await redis.lrange('worker:dryrun:history', 0, limit - 1) : [];

  // Parse and combine
  let executions: WorkerLogEntry[] = [];

  for (const log of realLogs) {
    try {
      const entry = JSON.parse(log) as WorkerLogEntry;
      entry.dryRun = false;
      executions.push(entry);
    } catch {}
  }

  for (const log of dryRunLogs) {
    try {
      const entry = JSON.parse(log) as WorkerLogEntry;
      entry.dryRun = true;
      executions.push(entry);
    } catch {}
  }

  // Sort by timestamp (newest first)
  executions.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Filter by agent if specified
  if (agentFilter) {
    executions = executions.filter(e => e.parentAgent === agentFilter);
  }

  // Limit results
  executions = executions.slice(0, limit);

  sendResponse(res, executions);
}));

// Get worker execution by taskId
app.get('/workers/:taskId', asyncHandler(async (req, res) => {
  const taskId = req.params.taskId;

  // Search in both logs
  const realLogs = await redis.lrange('worker:logs:history', 0, 999);
  const dryRunLogs = await redis.lrange('worker:dryrun:history', 0, 999);

  for (const log of [...realLogs, ...dryRunLogs]) {
    try {
      const entry = JSON.parse(log) as WorkerLogEntry;
      if (entry.taskId === taskId) {
        entry.dryRun = dryRunLogs.includes(log);
        return sendResponse(res, entry);
      }
    } catch {}
  }

  sendError(res, 'Worker execution not found', 404);
}));

// Get worker stats
app.get('/workers/stats/summary', asyncHandler(async (_req, res) => {
  const realLogs = await redis.lrange('worker:logs:history', 0, 999);
  const dryRunLogs = await redis.lrange('worker:dryrun:history', 0, 999);

  let totalExecutions = 0;
  let successCount = 0;
  let failureCount = 0;
  let totalDuration = 0;
  const byAgent: Record<string, number> = {};
  const byServer: Record<string, number> = {};

  for (const log of [...realLogs, ...dryRunLogs]) {
    try {
      const entry = JSON.parse(log) as WorkerLogEntry;
      totalExecutions++;

      if (entry.success) successCount++;
      else failureCount++;

      totalDuration += entry.duration || 0;

      byAgent[entry.parentAgent] = (byAgent[entry.parentAgent] || 0) + 1;

      for (const server of entry.servers || []) {
        byServer[server] = (byServer[server] || 0) + 1;
      }
    } catch {}
  }

  sendResponse(res, {
    total: totalExecutions,
    success: successCount,
    failure: failureCount,
    dryRunCount: dryRunLogs.length,
    avgDurationMs: totalExecutions > 0 ? Math.round(totalDuration / totalExecutions) : 0,
    byAgent,
    byServer,
  });
}));

// === Decision Endpoints ===

// Get all decisions (history)
app.get('/decisions', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const decisions = await decisionRepo.findAll(limit, offset);
  sendResponse(res, decisions);
}));

// Get pending decisions
app.get('/decisions/pending', asyncHandler(async (_req, res) => {
  const decisions = await decisionRepo.findPending();
  sendResponse(res, decisions);
}));

// Get escalated decisions (waiting for human) - MUST be before :id route
app.get('/decisions/escalated', asyncHandler(async (_req, res) => {
  const decisions = await decisionRepo.findEscalated();
  sendResponse(res, decisions);
}));

// Get decision by ID - MUST be after specific routes
app.get('/decisions/:id', asyncHandler(async (req, res) => {
  const decision = await decisionRepo.findById(req.params.id);
  if (!decision) {
    return sendError(res, 'Decision not found', 404);
  }
  sendResponse(res, decision);
}));

// Human decision on escalated decision
app.post('/decisions/:id/human-decision', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { decision, reason } = req.body;

  if (!decision || !['approve', 'reject'].includes(decision)) {
    return sendError(res, 'Invalid decision. Must be "approve" or "reject"', 400);
  }

  const existingDecision = await decisionRepo.findById(id);
  if (!existingDecision) {
    return sendError(res, 'Decision not found', 404);
  }

  if (existingDecision.status !== 'escalated') {
    return sendError(res, 'Decision is not in escalated status', 400);
  }

  // Update decision status
  const newStatus: DecisionStatus = decision === 'approve' ? 'approved' : 'rejected';
  await decisionRepo.updateStatus(id, newStatus, new Date());
  await decisionRepo.setHumanDecision(id, decision, reason);

  // Broadcast result
  await publisher.publish(channels.broadcast, JSON.stringify({
    type: 'decision_result',
    from: 'orchestrator',
    payload: {
      decisionId: id,
      title: existingDecision.title,
      status: newStatus,
      humanDecision: decision,
      reason,
    },
  }));

  logger.info({ decisionId: id, decision, reason }, 'Human decision recorded');
  sendResponse(res, { status: newStatus, decision, reason });
}));

// === Escalation Endpoints ===

// Get pending escalations
app.get('/escalations/pending', asyncHandler(async (_req, res) => {
  const escalations = await escalationRepo.findPending();
  sendResponse(res, escalations);
}));

// Trigger manual escalation
app.post('/escalate', asyncHandler(async (req, res) => {
  const { reason, decisionId, channels } = req.body;

  const escalationId = await triggerEscalation({
    reason,
    decisionId,
    channels: channels || ['telegram'],
  });

  sendResponse(res, { escalationId, status: 'escalated' }, 201);
}));

// Respond to escalation (human input)
app.post('/escalations/:id/respond', asyncHandler(async (req, res) => {
  const escalationId = req.params.id;
  const { response } = req.body;

  await escalationRepo.respond(escalationId, response);
  sendResponse(res, { escalationId, status: 'responded' });
}));

// === Human-to-Agent Messaging ===

// Send message to specific agent (Human Oversight → Agent)
app.post('/agents/:type/message', asyncHandler(async (req, res) => {
  const { type } = req.params;
  const { message, priority = 'normal' } = req.body;

  if (!message || typeof message !== 'string') {
    return sendError(res, 'Message is required', 400);
  }

  // Find agent by type
  const agent = await agentRepo.findByType(type as AgentType);
  if (!agent) {
    return sendError(res, `Agent ${type} not found`, 404);
  }

  // Create message payload
  const messagePayload: AgentMessage = {
    id: crypto.randomUUID(),
    type: 'task',
    from: 'human_oversight',
    to: agent.id,
    payload: {
      title: 'Message from Human Oversight',
      content: message,
      priority,
      timestamp: new Date().toISOString(),
    },
    priority: priority as 'low' | 'normal' | 'high' | 'critical',
    timestamp: new Date(),
    requiresResponse: true,
  };

  // Publish to agent's channel
  await publisher.publish(channels.agent(agent.id), JSON.stringify(messagePayload));

  // Log event
  await eventRepo.log({
    eventType: 'human_message',
    sourceAgent: undefined,
    targetAgent: agent.id,
    payload: { message, priority },
  });

  logger.info({ agentType: type, agentId: agent.id, messageLength: message.length }, 'Human message sent to agent');
  sendResponse(res, {
    status: 'sent',
    messageId: messagePayload.id,
    agentType: type,
    agentId: agent.id
  }, 201);
}));

// Broadcast message to all agents
app.post('/broadcast', asyncHandler(async (req, res) => {
  const { message, priority = 'normal' } = req.body;

  if (!message || typeof message !== 'string') {
    return sendError(res, 'Message is required', 400);
  }

  const messagePayload = {
    id: crypto.randomUUID(),
    type: 'broadcast',
    from: 'human_oversight',
    payload: {
      title: 'Broadcast from Human Oversight',
      content: message,
      priority,
      timestamp: new Date().toISOString(),
    },
  };

  await publisher.publish(channels.broadcast, JSON.stringify(messagePayload));

  logger.info({ messageLength: message.length }, 'Human broadcast sent to all agents');
  sendResponse(res, { status: 'broadcast_sent', messageId: messagePayload.id }, 201);
}));

// === Scheduler Endpoints ===

// Get scheduled jobs
app.get('/scheduler/jobs', asyncHandler(async (_req, res) => {
  const jobs = getScheduledJobs();
  sendResponse(res, jobs);
}));

// Pause job
app.post('/scheduler/jobs/:id/pause', asyncHandler(async (req, res) => {
  const jobId = req.params.id;
  const success = pauseJob(jobId);
  if (!success) {
    return sendError(res, 'Job not found', 404);
  }
  sendResponse(res, { jobId, status: 'paused' });
}));

// Resume job
app.post('/scheduler/jobs/:id/resume', asyncHandler(async (req, res) => {
  const jobId = req.params.id;
  const success = resumeJob(jobId);
  if (!success) {
    return sendError(res, 'Job not found', 404);
  }
  sendResponse(res, { jobId, status: 'resumed' });
}));

// === Metrics Endpoint (Prometheus format) ===

app.get('/metrics', asyncHandler(async (_req, res) => {
  const health = await getSystemHealth();
  const agents = await agentRepo.findAll();

  const metrics: string[] = [
    '# HELP aito_system_status System health status (1=healthy, 0.5=degraded, 0=unhealthy)',
    '# TYPE aito_system_status gauge',
    `aito_system_status ${health.status === 'healthy' ? 1 : health.status === 'degraded' ? 0.5 : 0}`,
    '',
    '# HELP aito_uptime_seconds Orchestrator uptime in seconds',
    '# TYPE aito_uptime_seconds counter',
    `aito_uptime_seconds ${Math.floor(health.uptime / 1000)}`,
    '',
    '# HELP aito_agents_total Total number of agents',
    '# TYPE aito_agents_total gauge',
    `aito_agents_total ${health.components.agents.total}`,
    '',
    '# HELP aito_agents_healthy Number of healthy agents',
    '# TYPE aito_agents_healthy gauge',
    `aito_agents_healthy ${health.components.agents.healthy}`,
    '',
    '# HELP aito_agents_unhealthy Number of unhealthy agents',
    '# TYPE aito_agents_unhealthy gauge',
    `aito_agents_unhealthy ${health.components.agents.unhealthy}`,
    '',
  ];

  // Per-agent metrics
  for (const agent of agents) {
    const status = health.components.agents.details[agent.type];
    const statusValue = status?.status === 'healthy' ? 1 : 0;
    metrics.push(`aito_agent_status{type="${agent.type}",id="${agent.id}"} ${statusValue}`);
  }

  res.set('Content-Type', 'text/plain');
  res.send(metrics.join('\n'));
}));

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'API error');
  sendError(res, err.message, 500);
});

// Start API server
import { createServer, Server } from 'http';

export function startServer(port: number = numericConfig.port): Server {
  const server = createServer(app);
  server.listen(port, () => {
    logger.info({ port }, 'API server started');
  });
  return server;
}
