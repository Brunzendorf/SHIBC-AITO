import express, { Request, Response, NextFunction } from 'express';
import { createLogger } from '../lib/logger.js';
import { numericConfig } from '../lib/config.js';
import { agentRepo, eventRepo, taskRepo, decisionRepo, escalationRepo, historyRepo, domainApprovalRepo, domainWhitelistRepo, settingsRepo, stateRepo, projectRepo } from '../lib/db.js';
import { publisher, channels, redis } from '../lib/redis.js';
import { startAgent, stopAgent, restartAgent, getAgentContainerStatus, listManagedContainers } from './container.js';
import { getScheduledJobs, pauseJob, resumeJob } from './scheduler.js';
import { getSystemHealth, isAlive, isReady, getAgentHealth } from './health.js';
import { triggerEscalation } from './events.js';
import { authMiddleware, type AuthenticatedRequest } from './auth.js';
import type { AgentType, AgentMessage, ApiResponse, DecisionStatus } from '../lib/types.js';
import crypto from 'crypto';
import { benchmarkRunner, BENCHMARK_TASKS } from '../lib/llm/benchmark.js';
import type { BenchmarkTest } from '../lib/llm/benchmark.js';
import { withTraceAsync, generateTraceId, getTraceId, TRACE_HEADER, SPAN_HEADER } from '../lib/tracing.js';
// TASK-024: Request validation schemas
import {
  validate,
  createTaskSchema,
  updateTaskStatusSchema,
  humanDecisionSchema,
  sendMessageSchema,
  broadcastSchema,
  focusSettingsSchema,
  addDomainWhitelistSchema,
  runBenchmarkSchema,
  createProjectSchema,
  updateProjectSchema,
  createProjectTaskSchema,
  updateProjectTaskSchema,
  createScheduledEventSchema,
  updateScheduledEventSchema,
} from './validation.js';

const logger = createLogger('api');

// TASK-025: Hard limit for all query limits to prevent unbounded queries
const MAX_QUERY_LIMIT = 500;

/**
 * TASK-025: Parse query limit with hard cap
 * Prevents unbounded queries that could slow down the database
 */
function parseLimit(queryLimit: unknown, defaultValue: number = 50): number {
  const parsed = parseInt(queryLimit as string) || defaultValue;
  return Math.min(parsed, MAX_QUERY_LIMIT);
}

export const app = express();

// Middleware
app.use(express.json());

// CORS middleware - allow dashboard access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', `Content-Type, Authorization, ${TRACE_HEADER}, ${SPAN_HEADER}`);
  if (req.method === 'OPTIONS') {
    res.sendStatus(200); return;
  }
  next();
});

// Distributed tracing middleware (TASK-033)
// Wraps each request in a trace context for end-to-end tracking
app.use((req, res, next) => {
  // Use incoming trace ID from header or generate new one
  const incomingTraceId = req.headers[TRACE_HEADER.toLowerCase()] as string | undefined;
  const traceId = incomingTraceId || generateTraceId();

  // Add trace ID to response headers for client correlation
  res.setHeader(TRACE_HEADER, traceId);

  // Run request handler within trace context
  withTraceAsync(async () => {
    next();
  }, {
    traceId,
    metadata: {
      method: req.method,
      path: req.path,
      userAgent: req.headers['user-agent'],
    },
  }).catch(next);
});

// Request logging (now includes trace IDs automatically via logger mixin)
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

// Authentication middleware (skips /health and /ready)
app.use(authMiddleware);

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

// Session pool status (EXPERIMENTAL feature)
app.get('/health/sessions', asyncHandler(async (_req, res) => {
  const enabled = process.env.SESSION_POOL_ENABLED === 'true';
  if (!enabled) {
    return sendResponse(res, {
      enabled: false,
      message: 'Session pool is disabled. Set SESSION_POOL_ENABLED=true to enable.',
    });
  }

  // Note: Session pool runs in agent containers, not orchestrator
  // This endpoint shows configuration only
  sendResponse(res, {
    enabled: true,
    config: {
      maxLoops: parseInt(process.env.SESSION_MAX_LOOPS || '50', 10),
      idleTimeoutMs: parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || '1800000', 10),
    },
    description: 'Session pool reduces token usage by ~80% using persistent Claude CLI sessions',
  });
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
  const limit = parseLimit(req.query.limit);
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

// Get agent state (TASK-026)
app.get('/agents/:type/state', asyncHandler(async (req, res) => {
  const agentType = req.params.type as AgentType;
  const agent = await agentRepo.findByType(agentType);

  if (!agent) {
    return sendError(res, 'Agent not found', 404);
  }

  // Get all state for this agent
  const state = await stateRepo.getAll(agent.id);

  sendResponse(res, {
    agentId: agent.id,
    agentType: agent.type,
    state,
    retrievedAt: new Date().toISOString(),
  });
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
  const limit = parseLimit(req.query.limit, 100);
  const events = await eventRepo.getRecent(limit);
  sendResponse(res, events);
}));

// Get events for specific agent
app.get('/events/agent/:id', asyncHandler(async (req, res) => {
  const agentId = req.params.id;
  const limit = parseLimit(req.query.limit);
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

// Create task (TASK-024: validated)
app.post('/tasks', validate(createTaskSchema), asyncHandler(async (req, res) => {
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

// Update task status (TASK-024: validated)
app.patch('/tasks/:id/status', validate(updateTaskStatusSchema), asyncHandler(async (req, res) => {
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
  result?: string;  // Worker output result
  mode?: string;
  dryRun?: boolean;
}

// Get all worker executions (combined real + dry-run)
app.get('/workers', asyncHandler(async (req, res) => {
  const limit = parseLimit(req.query.limit, 100);
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
  const limit = parseLimit(req.query.limit);
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

// Human decision on escalated decision (TASK-024: validated)
app.post('/decisions/:id/human-decision', validate(humanDecisionSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { decision, reason } = req.body;

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

// Send message to specific agent (Human Oversight → Agent) (TASK-024: validated)
app.post('/agents/:type/message', validate(sendMessageSchema), asyncHandler(async (req, res) => {
  const { type } = req.params;
  const { message, priority } = req.body;

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

// Broadcast message to all agents (TASK-024: validated)
app.post('/broadcast', validate(broadcastSchema), asyncHandler(async (req, res) => {
  const { message, priority } = req.body;

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

// === Focus Settings Endpoints ===

const FOCUS_KEY = 'settings:focus';

interface FocusSettings {
  revenueFocus: number;
  communityGrowth: number;
  marketingVsDev: number;
  riskTolerance: number;
  timeHorizon: number;
  updatedAt?: string;
  updatedBy?: string;
}

const DEFAULT_FOCUS: FocusSettings = {
  revenueFocus: 80,
  communityGrowth: 60,
  marketingVsDev: 50,
  riskTolerance: 40,
  timeHorizon: 30,
};

// Get focus settings
app.get('/focus', asyncHandler(async (_req, res) => {
  const stored = await redis.get(FOCUS_KEY);
  if (stored) {
    sendResponse(res, JSON.parse(stored));
  } else {
    sendResponse(res, DEFAULT_FOCUS);
  }
}));

// Get initiatives
app.get('/initiatives', asyncHandler(async (_req, res) => {
  // Get initiative events directly by type (not filtered from recent)
  const initiativeEvents = await eventRepo.getByType('initiative_created', 100);

  const initiatives = initiativeEvents.map(e => {
    const payload = e.payload as Record<string, unknown>;
    return {
      title: payload?.title || 'Unknown',
      description: payload?.description || '',
      priority: payload?.priority || 'medium',
      revenueImpact: Number(payload?.revenueImpact) || 0,
      effort: Number(payload?.effort) || 0,
      suggestedAssignee: (payload?.suggestedAssignee as string) || e.sourceAgent || 'unknown',
      tags: (payload?.tags as string[]) || [],
      issueUrl: payload?.issueUrl || null,
      status: 'completed',
      createdAt: e.createdAt,
    };
  });

  sendResponse(res, initiatives);
}));

// Update focus settings (TASK-024: validated - Zod handles min/max)
app.post('/focus', validate(focusSettingsSchema), asyncHandler(async (req, res) => {
  const settings: FocusSettings = {
    revenueFocus: req.body.revenueFocus ?? DEFAULT_FOCUS.revenueFocus,
    communityGrowth: req.body.communityGrowth ?? DEFAULT_FOCUS.communityGrowth,
    marketingVsDev: req.body.marketingVsDev ?? DEFAULT_FOCUS.marketingVsDev,
    riskTolerance: req.body.riskTolerance ?? DEFAULT_FOCUS.riskTolerance,
    timeHorizon: req.body.timeHorizon ?? DEFAULT_FOCUS.timeHorizon,
    updatedAt: new Date().toISOString(),
    updatedBy: req.body.updatedBy || 'dashboard',
  };

  await redis.set(FOCUS_KEY, JSON.stringify(settings));

  // Broadcast focus change to all agents
  await publisher.publish(channels.broadcast, JSON.stringify({
    id: crypto.randomUUID(),
    type: 'focus_updated',
    from: 'orchestrator',
    to: 'broadcast',
    payload: settings,
  }));

  logger.info({ settings }, 'Focus settings updated');
  sendResponse(res, settings);
}));

// === Domain Approval Endpoints ===

// Get all domain approval requests
app.get('/domain-approvals', asyncHandler(async (req, res) => {
  const status = req.query.status as string | undefined;
  const limit = parseLimit(req.query.limit);

  let approvals;
  if (status === 'pending') {
    approvals = await domainApprovalRepo.getPending();
  } else {
    approvals = await domainApprovalRepo.getAll(limit);
  }

  sendResponse(res, approvals);
}));

// Get pending domain approval requests count
app.get('/domain-approvals/pending/count', asyncHandler(async (_req, res) => {
  const pending = await domainApprovalRepo.getPending();
  sendResponse(res, { count: pending.length });
}));

// Get single domain approval request
app.get('/domain-approvals/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const approval = await domainApprovalRepo.getById(id);

  if (!approval) {
    return sendError(res, 'Domain approval request not found', 404);
  }

  sendResponse(res, approval);
}));

// Approve domain request
app.post('/domain-approvals/:id/approve', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reviewedBy = 'human', notes, category } = req.body;

  const approval = await domainApprovalRepo.getById(id);
  if (!approval) {
    return sendError(res, 'Domain approval request not found', 404);
  }

  if (approval.status !== 'pending') {
    return sendError(res, `Request is already ${approval.status}`, 400);
  }

  const result = await domainApprovalRepo.approve(id, reviewedBy, notes, category || approval.suggestedCategory);

  if (result) {
    // Broadcast approval notification
    await publisher.publish(channels.broadcast, JSON.stringify({
      type: 'domain_approved',
      domain: result.domain,
      approvedBy: reviewedBy,
      timestamp: new Date().toISOString(),
    }));

    logger.info({ id, domain: result.domain, reviewedBy }, 'Domain approval request approved');
  }

  sendResponse(res, result);
}));

// Reject domain request
app.post('/domain-approvals/:id/reject', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reviewedBy = 'human', notes } = req.body;

  const approval = await domainApprovalRepo.getById(id);
  if (!approval) {
    return sendError(res, 'Domain approval request not found', 404);
  }

  if (approval.status !== 'pending') {
    return sendError(res, `Request is already ${approval.status}`, 400);
  }

  const result = await domainApprovalRepo.reject(id, reviewedBy, notes);

  if (result) {
    logger.info({ id, domain: result.domain, reviewedBy, notes }, 'Domain approval request rejected');
  }

  sendResponse(res, result);
}));

// === Domain Whitelist Endpoints ===

// Get all whitelisted domains
app.get('/whitelist', asyncHandler(async (_req, res) => {
  const domains = await domainWhitelistRepo.getAll();
  sendResponse(res, domains);
}));

// Get whitelist categories
app.get('/whitelist/categories', asyncHandler(async (_req, res) => {
  const categories = await domainWhitelistRepo.getCategories();
  sendResponse(res, categories);
}));

// Add domain to whitelist (manual) (TASK-024: validated)
app.post('/whitelist', validate(addDomainWhitelistSchema), asyncHandler(async (req, res) => {
  const { domain, category, description, addedBy } = req.body;

  const result = await domainWhitelistRepo.add(domain, category, description, addedBy);
  logger.info({ domain, category, addedBy }, 'Domain added to whitelist');
  sendResponse(res, result, 201);
}));

// Remove domain from whitelist
app.delete('/whitelist/:domain', asyncHandler(async (req, res) => {
  const { domain } = req.params;
  await domainWhitelistRepo.remove(domain);
  logger.info({ domain }, 'Domain removed from whitelist');
  sendResponse(res, { domain, status: 'removed' });
}));

// === Backlog / Kanban Endpoints ===

// Get backlog issues (from Redis cache or GitHub)
app.get('/backlog/issues', asyncHandler(async (_req, res) => {
  // Try to get from Redis cache first
  const cached = await redis.get('context:backlog');
  if (cached) {
    try {
      const backlogState = JSON.parse(cached);
      // Transform to KanbanIssue format
      const issues = backlogState.issues?.map((issue: {
        number: number;
        title: string;
        body?: string;
        labels?: string[];
        state?: string;
        created_at?: string;
        assignee?: string;
        html_url?: string;
      }) => {
        // Extract status from labels
        const statusLabel = issue.labels?.find((l: string) => l.startsWith('status:')) || '';
        const status = statusLabel.replace('status:', '').replace('-', '_') || 'backlog';

        // Extract priority from labels
        const priorityLabel = issue.labels?.find((l: string) => l.startsWith('priority:'));
        const priority = priorityLabel?.replace('priority:', '');

        // Extract effort from labels
        const effortLabel = issue.labels?.find((l: string) => l.startsWith('effort:'));
        const effort = effortLabel?.replace('effort:', '');

        // Extract agent from labels
        const agentLabel = issue.labels?.find((l: string) => l.startsWith('agent:'));
        const assignee = agentLabel?.replace('agent:', '') || issue.assignee;

        // Check if epic or subtask
        const isEpic = issue.labels?.includes('type:epic');
        const subtaskLabel = issue.labels?.find((l: string) => l.startsWith('epic:'));
        const epicNumber = subtaskLabel ? parseInt(subtaskLabel.replace('epic:', '')) : undefined;

        return {
          number: issue.number,
          title: issue.title,
          body: issue.body || null,
          labels: issue.labels || [],
          status,
          priority,
          effort,
          assignee,
          isEpic,
          epicNumber,
          created_at: issue.created_at || new Date().toISOString(),
          html_url: issue.html_url || `https://github.com/Brunzendorf/SHIBC-AITO/issues/${issue.number}`,
        };
      }) || [];

      sendResponse(res, issues);
      return;
    } catch {
      // Fall through to empty response
    }
  }

  // No cached data - return empty with message
  sendResponse(res, []);
}));

// Get backlog stats
app.get('/backlog/stats', asyncHandler(async (_req, res) => {
  const cached = await redis.get('context:backlog');
  if (cached) {
    try {
      const backlogState = JSON.parse(cached);
      const issues = backlogState.issues || [];

      // Calculate stats
      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      const byAgent: Record<string, number> = {};

      for (const issue of issues) {
        // Count by status
        const statusLabel = issue.labels?.find((l: string) => l.startsWith('status:')) || 'status:backlog';
        const status = statusLabel.replace('status:', '');
        byStatus[status] = (byStatus[status] || 0) + 1;

        // Count by priority
        const priorityLabel = issue.labels?.find((l: string) => l.startsWith('priority:'));
        if (priorityLabel) {
          const priority = priorityLabel.replace('priority:', '');
          byPriority[priority] = (byPriority[priority] || 0) + 1;
        }

        // Count by agent
        const agentLabel = issue.labels?.find((l: string) => l.startsWith('agent:'));
        if (agentLabel) {
          const agent = agentLabel.replace('agent:', '');
          byAgent[agent] = (byAgent[agent] || 0) + 1;
        }
      }

      sendResponse(res, {
        total: issues.length,
        byStatus,
        byPriority,
        byAgent,
        lastGroomed: backlogState.lastGroomed,
      });
      return;
    } catch {
      // Fall through
    }
  }

  sendResponse(res, {
    total: 0,
    byStatus: {},
    byPriority: {},
    byAgent: {},
  });
}));

// Trigger backlog grooming manually
app.post('/backlog/refresh', asyncHandler(async (_req, res) => {
  const { runBacklogGrooming } = await import('../workers/backlog-groomer.js');
  logger.info('Manual backlog grooming triggered');

  // Run async, don't wait
  runBacklogGrooming().catch(err => logger.error({ err }, 'Backlog grooming failed'));

  sendResponse(res, { message: 'Backlog grooming started', timestamp: new Date().toISOString() });
}));

// === Project Planning Endpoints ===

// Get all projects (dashboard view)
app.get('/projects', asyncHandler(async (req, res) => {
  const status = req.query.status as string | undefined;
  const owner = req.query.owner as string | undefined;

  let projects;
  if (status || owner) {
    // Filter by status or owner
    const allProjects = await projectRepo.findAll();
    projects = allProjects.filter(p => {
      if (status && p.status !== status) return false;
      if (owner && p.owner !== owner) return false;
      return true;
    });
  } else {
    projects = await projectRepo.getDashboardProjects();
  }

  sendResponse(res, projects);
}));

// Get project by ID
app.get('/projects/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const project = await projectRepo.findById(id);

  if (!project) {
    return sendError(res, 'Project not found', 404);
  }

  // Also fetch tasks and events for this project
  const tasks = await projectRepo.findTasksByProject(id);
  const events = await projectRepo.findEventsByProject(id);

  sendResponse(res, { ...project, tasks, events });
}));

// Create new project
app.post('/projects', validate(createProjectSchema), asyncHandler(async (req, res) => {
  const projectData = req.body;

  const project = await projectRepo.create(projectData);

  // Log event
  await eventRepo.log({
    eventType: 'project_created',
    sourceAgent: undefined,
    payload: { projectId: project.id, title: project.title, owner: project.owner },
  });

  // Notify owner agent
  const ownerAgent = await agentRepo.findByType(projectData.owner);
  if (ownerAgent) {
    await publisher.publish(channels.agent(ownerAgent.id), JSON.stringify({
      type: 'project_assigned',
      from: 'orchestrator',
      payload: {
        projectId: project.id,
        title: project.title,
        description: project.description,
        priority: project.priority,
      },
    }));
  }

  logger.info({ projectId: project.id, title: project.title }, 'Project created');
  sendResponse(res, project, 201);
}));

// Update project
app.patch('/projects/:id', validate(updateProjectSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const existing = await projectRepo.findById(id);
  if (!existing) {
    return sendError(res, 'Project not found', 404);
  }

  const project = await projectRepo.update(id, updates);

  // Broadcast status change if relevant
  if (updates.status && updates.status !== existing.status) {
    await publisher.publish(channels.broadcast, JSON.stringify({
      type: 'project_status_changed',
      from: 'orchestrator',
      payload: {
        projectId: id,
        title: project!.title,
        oldStatus: existing.status,
        newStatus: updates.status,
      },
    }));
  }

  logger.info({ projectId: id, updates }, 'Project updated');
  sendResponse(res, project);
}));

// Delete project
app.delete('/projects/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await projectRepo.findById(id);
  if (!existing) {
    return sendError(res, 'Project not found', 404);
  }

  await projectRepo.delete(id);

  logger.info({ projectId: id, title: existing.title }, 'Project deleted');
  sendResponse(res, { id, status: 'deleted' });
}));

// Get project stats (aggregated view for dashboard)
app.get('/projects/stats/summary', asyncHandler(async (_req, res) => {
  const stats = await projectRepo.getProjectStats();
  sendResponse(res, stats);
}));

// Get agent workload
app.get('/projects/stats/workload', asyncHandler(async (_req, res) => {
  const workload = await projectRepo.getAgentWorkload();
  sendResponse(res, workload);
}));

// === Project Tasks Endpoints ===

// Get tasks for a project
app.get('/projects/:projectId/tasks', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const tasks = await projectRepo.findTasksByProject(projectId);
  sendResponse(res, tasks);
}));

// Get single task
app.get('/project-tasks/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const task = await projectRepo.findTaskById(id);

  if (!task) {
    return sendError(res, 'Task not found', 404);
  }

  // Check if task can be started (all dependencies done)
  const canStart = await projectRepo.canStartTask(id);

  sendResponse(res, { ...task, canStart });
}));

// Create project task
app.post('/project-tasks', validate(createProjectTaskSchema), asyncHandler(async (req, res) => {
  const taskData = req.body;

  // Verify project exists
  const project = await projectRepo.findById(taskData.projectId);
  if (!project) {
    return sendError(res, 'Project not found', 404);
  }

  const task = await projectRepo.createTask(taskData);

  // Notify assignee if set
  if (taskData.assignee) {
    const assigneeAgent = await agentRepo.findByType(taskData.assignee);
    if (assigneeAgent) {
      await publisher.publish(channels.agent(assigneeAgent.id), JSON.stringify({
        type: 'task_assigned',
        from: 'orchestrator',
        payload: {
          taskId: task.id,
          projectId: project.id,
          projectTitle: project.title,
          title: task.title,
          description: task.description,
          storyPoints: task.storyPoints,
        },
      }));
    }
  }

  logger.info({ taskId: task.id, projectId: taskData.projectId }, 'Project task created');
  sendResponse(res, task, 201);
}));

// Update project task
app.patch('/project-tasks/:id', validate(updateProjectTaskSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const existing = await projectRepo.findTaskById(id);
  if (!existing) {
    return sendError(res, 'Task not found', 404);
  }

  // Use updateTaskStatus for status changes, otherwise generic update
  if (updates.status && updates.status !== existing.status) {
    await projectRepo.updateTaskStatus(id, updates.status, updates.tokensUsed);
  }

  // For other updates, we need a generic update (not in current repo, use SQL)
  // For now, status changes are the main concern

  const task = await projectRepo.findTaskById(id);

  logger.info({ taskId: id, updates }, 'Project task updated');
  sendResponse(res, task);
}));

// Get blocked tasks (tasks waiting on dependencies)
app.get('/project-tasks/blocked/all', asyncHandler(async (_req, res) => {
  const blockedTasks = await projectRepo.getAllBlockedTasks();
  sendResponse(res, blockedTasks);
}));

// === Scheduled Events Endpoints ===

// Get upcoming events (next 14 days by default)
app.get('/scheduled-events', asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days as string) || 14;
  const platform = req.query.platform as string | undefined;
  const agent = req.query.agent as string | undefined;

  let events = await projectRepo.findUpcomingEvents(days);

  // Filter by platform or agent if specified
  if (platform) {
    events = events.filter(e => e.platform === platform);
  }
  if (agent) {
    events = events.filter(e => e.agent === agent);
  }

  sendResponse(res, events);
}));

// Get events by date range (for calendar view)
app.get('/scheduled-events/range', asyncHandler(async (req, res) => {
  const start = req.query.start as string;
  const end = req.query.end as string;

  if (!start || !end) {
    return sendError(res, 'start and end query parameters required', 400);
  }

  const events = await projectRepo.findEventsByDateRange(new Date(start), new Date(end));
  sendResponse(res, events);
}));

// Get events for a project
app.get('/projects/:projectId/events', asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const events = await projectRepo.findEventsByProject(projectId);
  sendResponse(res, events);
}));

// Get single event
app.get('/scheduled-events/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Get from upcoming events (no findById in current repo)
  const allEvents = await projectRepo.findUpcomingEvents(365);
  const event = allEvents.find(e => e.id === id);

  if (!event) {
    return sendError(res, 'Event not found', 404);
  }

  sendResponse(res, event);
}));

// Create scheduled event
app.post('/scheduled-events', validate(createScheduledEventSchema), asyncHandler(async (req, res) => {
  const eventData = req.body;

  // Verify project exists if specified
  if (eventData.projectId) {
    const project = await projectRepo.findById(eventData.projectId);
    if (!project) {
      return sendError(res, 'Project not found', 404);
    }
  }

  const event = await projectRepo.createEvent({
    ...eventData,
    scheduledAt: new Date(eventData.scheduledAt),
  });

  // Notify responsible agent
  const agentRecord = await agentRepo.findByType(eventData.agent);
  if (agentRecord) {
    await publisher.publish(channels.agent(agentRecord.id), JSON.stringify({
      type: 'event_scheduled',
      from: 'orchestrator',
      payload: {
        eventId: event.id,
        title: event.title,
        eventType: event.eventType,
        scheduledAt: event.scheduledAt,
        platform: event.platform,
      },
    }));
  }

  logger.info({ eventId: event.id, type: event.eventType, scheduledAt: event.scheduledAt }, 'Event scheduled');
  sendResponse(res, event, 201);
}));

// Update scheduled event
app.patch('/scheduled-events/:id', validate(updateScheduledEventSchema), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Update status if provided
  if (updates.status) {
    await projectRepo.updateEventStatus(id, updates.status, updates.status === 'published' ? { executedAt: new Date() } : undefined);
  }

  // Get updated event
  const allEvents = await projectRepo.findUpcomingEvents(365);
  const event = allEvents.find(e => e.id === id);

  logger.info({ eventId: id, updates }, 'Event updated');
  sendResponse(res, event);
}));

// Get due events (for scheduler to execute)
app.get('/scheduled-events/due/now', asyncHandler(async (_req, res) => {
  const dueEvents = await projectRepo.findDueEvents();
  sendResponse(res, dueEvents);
}));

// === LLM Benchmark Endpoints ===

// Get all benchmark tasks (available test suite)
app.get('/benchmarks/tasks', asyncHandler(async (_req, res) => {
  sendResponse(res, BENCHMARK_TASKS);
}));

// List all benchmark runs (from Redis)
app.get('/benchmarks/runs', asyncHandler(async (req, res) => {
  const limit = parseLimit(req.query.limit, 20);

  try {
    const keys = await redis.keys('benchmark:run:*');

    if (keys.length === 0) {
      return sendResponse(res, []);
    }

    // Get all runs and sort by timestamp
    const runs = await Promise.all(
      keys.slice(0, limit).map(async (key) => {
        const data = await redis.get(key);
        return data ? JSON.parse(data) : null;
      })
    );

    const validRuns = runs.filter(r => r !== null).sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    sendResponse(res, validRuns);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch benchmark runs');
    sendError(res, 'Failed to fetch benchmark runs', 500);
  }
}));

// Get specific benchmark run by ID
app.get('/benchmarks/runs/:runId', asyncHandler(async (req, res) => {
  const { runId } = req.params;

  try {
    const data = await redis.get(`benchmark:run:${runId}`);

    if (!data) {
      return sendError(res, 'Benchmark run not found', 404);
    }

    const benchmarkRun = JSON.parse(data);
    sendResponse(res, benchmarkRun);
  } catch (err) {
    logger.error({ err, runId }, 'Failed to fetch benchmark run');
    sendError(res, 'Failed to fetch benchmark run', 500);
  }
}));

// Get latest benchmark run
app.get('/benchmarks/latest', asyncHandler(async (_req, res) => {
  try {
    const keys = await redis.keys('benchmark:run:*');

    if (keys.length === 0) {
      return sendResponse(res, null);
    }

    // Get all runs and find latest
    const runs = await Promise.all(
      keys.map(async (key) => {
        const data = await redis.get(key);
        return data ? JSON.parse(data) : null;
      })
    );

    const validRuns = runs.filter(r => r !== null);
    const latest = validRuns.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0];

    if (!latest) {
      return sendResponse(res, null);
    }

    sendResponse(res, latest);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch latest benchmark');
    sendError(res, 'Failed to fetch latest benchmark', 500);
  }
}));

// Run new benchmark (async, returns immediately) (TASK-024: validated)
app.post('/benchmarks/run', validate(runBenchmarkSchema), asyncHandler(async (req, res) => {
  const { models, tasks, description, enableTools } = req.body as {
    models?: BenchmarkTest['models'];
    tasks?: typeof BENCHMARK_TASKS;
    description?: string;
    enableTools?: boolean;
  };

  // Default models if not specified (Claude-only until Gemini quota restored)
  // TODO: Re-add when quotas available:
  //   { provider: 'gemini', model: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
  //   { provider: 'openai', model: 'gpt-5-codex', displayName: 'OpenAI Codex' },
  const defaultModels: BenchmarkTest['models'] = [
    { provider: 'claude', model: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5' },
  ];

  const modelsToTest = models || defaultModels;
  const tasksToRun = tasks || BENCHMARK_TASKS;
  const toolsEnabled = enableTools !== undefined ? enableTools : true; // Default to true

  logger.info({
    modelCount: modelsToTest.length,
    taskCount: tasksToRun.length,
    description,
    enableTools: toolsEnabled
  }, 'Starting benchmark run');

  // Run benchmark async (don't block request)
  benchmarkRunner.runBenchmark(modelsToTest, tasksToRun, toolsEnabled).then((result) => {
    logger.info({ runId: result.runId }, 'Benchmark completed successfully');
  }).catch((err) => {
    logger.error({ err }, 'Benchmark run failed');
  });

  sendResponse(res, {
    message: 'Benchmark started',
    description,
    models: modelsToTest.length,
    tasks: tasksToRun.length,
    timestamp: new Date().toISOString(),
  }, 202); // 202 Accepted
}));

// Get benchmark leaderboard (current rankings)
app.get('/benchmarks/leaderboard', asyncHandler(async (_req, res) => {
  try {
    const keys = await redis.keys('benchmark:run:*');

    if (keys.length === 0) {
      return sendResponse(res, []);
    }

    // Get latest run
    const runs = await Promise.all(
      keys.map(async (key) => {
        const data = await redis.get(key);
        return data ? JSON.parse(data) : null;
      })
    );

    const validRuns = runs.filter(r => r !== null);
    const latest = validRuns.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0];

    if (!latest || !latest.leaderboard) {
      return sendResponse(res, []);
    }

    sendResponse(res, latest.leaderboard);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch leaderboard');
    sendError(res, 'Failed to fetch leaderboard', 500);
  }
}));

// Error handling middleware
// === System Settings Endpoints ===

// Get all settings
app.get('/settings', asyncHandler(async (_req, res) => {
  const settings = await settingsRepo.getAll();
  // Group by category for easier frontend consumption
  const grouped: Record<string, Record<string, unknown>> = {};
  for (const s of settings) {
    if (!grouped[s.category]) grouped[s.category] = {};
    grouped[s.category][s.settingKey] = {
      value: s.settingValue,
      description: s.description,
      isSecret: s.isSecret,
      updatedAt: s.updatedAt,
    };
  }
  sendResponse(res, grouped);
}));

// Get settings by category
app.get('/settings/:category', asyncHandler(async (req, res) => {
  const { category } = req.params;
  const settings = await settingsRepo.getByCategory(category);
  const result: Record<string, unknown> = {};
  for (const s of settings) {
    result[s.settingKey] = {
      value: s.settingValue,
      description: s.description,
      isSecret: s.isSecret,
      updatedAt: s.updatedAt,
    };
  }
  sendResponse(res, result);
}));

// Get single setting
app.get('/settings/:category/:key', asyncHandler(async (req, res) => {
  const { category, key } = req.params;
  const setting = await settingsRepo.get(category, key);
  if (!setting) {
    return sendError(res, 'Setting not found', 404);
  }
  sendResponse(res, {
    value: setting.settingValue,
    description: setting.description,
    isSecret: setting.isSecret,
    updatedAt: setting.updatedAt,
  });
}));

// Update setting
app.put('/settings/:category/:key', asyncHandler(async (req, res) => {
  const { category, key } = req.params;
  const { value, description } = req.body;

  if (value === undefined) {
    return sendError(res, 'Value is required', 400);
  }

  const setting = await settingsRepo.set(category, key, value, description);
  logger.info({ category, key, value }, 'Setting updated');

  // Notify agents if relevant settings changed
  if (category === 'queue' || category === 'agents' || category === 'llm') {
    await publisher.publish(channels.broadcast, JSON.stringify({
      type: 'settings_updated',
      category,
      key,
      timestamp: new Date().toISOString(),
    }));
  }

  sendResponse(res, {
    value: setting.settingValue,
    description: setting.description,
    updatedAt: setting.updatedAt,
  });
}));

// Bulk update settings
app.put('/settings/:category', asyncHandler(async (req, res) => {
  const { category } = req.params;
  const updates = req.body as Record<string, unknown>;

  if (!updates || typeof updates !== 'object') {
    return sendError(res, 'Request body must be an object', 400);
  }

  const results: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    const setting = await settingsRepo.set(category, key, value);
    results[key] = setting.settingValue;
  }

  logger.info({ category, keyCount: Object.keys(updates).length }, 'Bulk settings updated');

  // Notify agents
  await publisher.publish(channels.broadcast, JSON.stringify({
    type: 'settings_updated',
    category,
    timestamp: new Date().toISOString(),
  }));

  sendResponse(res, results);
}));

// Get available categories
app.get('/settings-categories', asyncHandler(async (_req, res) => {
  const categories = await settingsRepo.getCategories();
  sendResponse(res, categories);
}));

// Convenience endpoints for specific setting groups
app.get('/settings/queue/delays', asyncHandler(async (_req, res) => {
  const delays = await settingsRepo.getQueueDelays();
  sendResponse(res, delays);
}));

app.get('/settings/agents/intervals', asyncHandler(async (_req, res) => {
  const intervals = await settingsRepo.getAgentLoopIntervals();
  sendResponse(res, intervals);
}));

app.get('/settings/llm/config', asyncHandler(async (_req, res) => {
  const config = await settingsRepo.getLLMSettings();
  sendResponse(res, config);
}));

// Error handler
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
