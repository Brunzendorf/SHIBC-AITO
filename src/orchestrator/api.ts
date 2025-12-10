import express, { Request, Response, NextFunction } from 'express';
import { createLogger } from '../lib/logger.js';
import { numericConfig } from '../lib/config.js';
import { agentRepo, eventRepo, taskRepo, decisionRepo, escalationRepo } from '../lib/db.js';
import { startAgent, stopAgent, restartAgent, getAgentContainerStatus, listManagedContainers } from './container.js';
import { getScheduledJobs, pauseJob, resumeJob } from './scheduler.js';
import { getSystemHealth, isAlive, isReady, getAgentHealth } from './health.js';
import { triggerEscalation } from './events.js';
import type { AgentType, ApiResponse } from '../lib/types.js';

const logger = createLogger('api');

export const app = express();

// Middleware
app.use(express.json());

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

// === Decision Endpoints ===

// Get pending decisions
app.get('/decisions/pending', asyncHandler(async (_req, res) => {
  const decisions = await decisionRepo.findPending();
  sendResponse(res, decisions);
}));

// Get decision by ID
app.get('/decisions/:id', asyncHandler(async (req, res) => {
  const decision = await decisionRepo.findById(req.params.id);
  if (!decision) {
    return sendError(res, 'Decision not found', 404);
  }
  sendResponse(res, decision);
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
export function startServer(port: number = numericConfig.port): void {
  app.listen(port, () => {
    logger.info({ port }, 'API server started');
  });
}
