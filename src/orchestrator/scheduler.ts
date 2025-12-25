import cron from 'node-cron';
import { v4 as uuid } from 'uuid';
import { createLogger } from '../lib/logger.js';
import { agentRepo, eventRepo, projectRepo, taskRepo } from '../lib/db.js';
import { publish, channels, popUrgent } from '../lib/redis.js';
import { agentConfigs, numericConfig } from '../lib/config.js';
import { autoRestartUnhealthy } from './container.js';
import { runArchiveWorker, getArchiveStats } from '../workers/archive-worker.js';
import { runDataFetch } from '../lib/data-fetcher.js';
import { runBacklogGrooming } from '../workers/backlog-groomer.js';
import type { AgentType, ScheduledJob, AgentMessage } from '../lib/types.js';

const logger = createLogger('scheduler');

// Active cron jobs
const jobs: Map<string, cron.ScheduledTask> = new Map();
const jobMetadata: Map<string, ScheduledJob> = new Map();

// Convert loop interval (seconds) to cron expression
function intervalToCron(intervalSeconds: number): string {
  if (intervalSeconds < 60) {
    // Every X seconds (only for dev)
    return `*/${intervalSeconds} * * * * *`;
  }

  const minutes = Math.floor(intervalSeconds / 60);

  if (minutes < 60) {
    // Every X minutes
    return `*/${minutes} * * * *`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    // Every X hours
    return `0 */${hours} * * *`;
  }

  // Daily
  return '0 9 * * *'; // 9:00 UTC
}

// Schedule agent loop
export function scheduleAgentLoop(agentId: string, agentType: AgentType): string {
  const agentConfig = agentConfigs[agentType];
  const cronExpression = intervalToCron(agentConfig.loopInterval);
  const jobId = `loop-${agentType}`;

  // Remove existing job if any
  if (jobs.has(jobId)) {
    jobs.get(jobId)!.stop();
    jobs.delete(jobId);
  }

  logger.info(
    { agentType, cronExpression, intervalSeconds: agentConfig.loopInterval },
    'Scheduling agent loop'
  );

  const task = cron.schedule(cronExpression, async () => {
    await triggerAgentLoop(agentId, agentType);
  });

  jobs.set(jobId, task);
  jobMetadata.set(jobId, {
    id: jobId,
    agentId,
    cronExpression,
    enabled: true,
  });

  return jobId;
}

// Trigger an agent's loop
async function triggerAgentLoop(agentId: string, agentType: AgentType): Promise<void> {
  logger.info({ agentType }, 'Triggering agent loop');

  try {
    // Update job metadata
    const jobId = `loop-${agentType}`;
    const meta = jobMetadata.get(jobId);
    if (meta) {
      meta.lastRun = new Date();
      meta.nextRun = getNextRun(meta.cronExpression);
    }

    // Send wake-up message to agent
    const message: AgentMessage = {
      id: uuid(),
      type: 'broadcast',
      from: 'orchestrator',
      to: agentId,
      payload: {
        action: 'loop_trigger',
        timestamp: new Date().toISOString(),
      },
      priority: 'normal',
      timestamp: new Date(),
      requiresResponse: false,
    };

    await publish(channels.agent(agentId), message);

    // Log event
    await eventRepo.log({
      eventType: 'broadcast',
      sourceAgent: 'orchestrator',
      targetAgent: agentId,
      payload: { action: 'loop_trigger' },
    });
  } catch (err) {
    logger.error({ err, agentType }, 'Failed to trigger agent loop');
  }
}

// Get next run time from cron expression
function getNextRun(_cronExpression: string): Date {
  // Note: node-cron doesn't have a native "next run" method
  // This is a simplified estimation
  const now = new Date();
  return new Date(now.getTime() + 60000); // Approximate
}

// Schedule health checks
export function scheduleHealthChecks(): string {
  const jobId = 'health-checks';
  const intervalSeconds = numericConfig.healthCheckInterval;
  const cronExpression = intervalToCron(intervalSeconds);

  logger.info({ cronExpression, intervalSeconds }, 'Scheduling health checks');

  const task = cron.schedule(cronExpression, async () => {
    logger.debug('Running health checks');
    try {
      await autoRestartUnhealthy();
    } catch (err) {
      // Only log at debug level for Portainer errors (not critical)
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Portainer')) {
        logger.debug({ error: errMsg }, 'Health check skipped - Portainer unavailable');
      } else {
        logger.error({ err }, 'Health check failed');
      }
    }
  });

  jobs.set(jobId, task);
  jobMetadata.set(jobId, {
    id: jobId,
    agentId: 'system',
    cronExpression,
    enabled: true,
  });

  return jobId;
}

// Schedule escalation timeout checks
export function scheduleEscalationChecks(): string {
  const jobId = 'escalation-checks';
  const cronExpression = '*/5 * * * *'; // Every 5 minutes

  logger.info({ cronExpression }, 'Scheduling escalation checks');

  const task = cron.schedule(cronExpression, async () => {
    logger.debug('Checking escalation timeouts');
    // Implementation in escalation module
  });

  jobs.set(jobId, task);
  jobMetadata.set(jobId, {
    id: jobId,
    agentId: 'system',
    cronExpression,
    enabled: true,
  });

  return jobId;
}

// Schedule Archive Worker - intelligent RAG knowledge curation
export function scheduleArchiveWorker(): string {
  const jobId = 'archive-worker';
  const cronExpression = '*/15 * * * *'; // Every 15 minutes

  logger.info({ cronExpression }, 'Scheduling Archive Worker');

  const task = cron.schedule(cronExpression, async () => {
    try {
      const stats = await getArchiveStats();
      if (stats.queueLength > 0) {
        logger.info({ queueLength: stats.queueLength }, 'Running Archive Worker');
        await runArchiveWorker();
      } else {
        logger.debug('Archive queue empty, skipping');
      }
    } catch (err) {
      logger.error({ err }, 'Archive Worker failed');
    }
  });

  jobs.set(jobId, task);
  jobMetadata.set(jobId, {
    id: jobId,
    agentId: 'system',
    cronExpression,
    enabled: true,
  });

  return jobId;
}

// Schedule Data Fetcher - external data (news, market, etc.) caching
export function scheduleDataFetcher(): string {
  const jobId = 'data-fetcher';
  const cronExpression = '*/10 * * * *'; // Every 10 minutes

  logger.info({ cronExpression }, 'Scheduling Data Fetcher');

  const task = cron.schedule(cronExpression, async () => {
    try {
      logger.info('Running Data Fetcher');
      await runDataFetch();
    } catch (err) {
      logger.error({ err }, 'Data Fetcher failed');
    }
  });

  jobs.set(jobId, task);
  jobMetadata.set(jobId, {
    id: jobId,
    agentId: 'system',
    cronExpression,
    enabled: true,
  });

  return jobId;
}

// Schedule Urgent Queue Processor - forwards urgent tasks to agents (TASK-101)
export function scheduleUrgentQueueProcessor(): string {
  const jobId = 'urgent-queue-processor';
  const cronExpression = '*/10 * * * * *'; // Every 10 seconds

  logger.info({ cronExpression }, 'Scheduling Urgent Queue Processor');

  const task = cron.schedule(cronExpression, async () => {
    await processUrgentQueue();
  });

  jobs.set(jobId, task);
  jobMetadata.set(jobId, {
    id: jobId,
    agentId: 'system',
    cronExpression,
    enabled: true,
  });

  return jobId;
}

// Process urgent queue items and forward to agents
async function processUrgentQueue(): Promise<void> {
  let processed = 0;
  const maxBatch = 10; // Process max 10 items per run

  while (processed < maxBatch) {
    const item = await popUrgent() as { agentId: string; taskId: string; priority: string } | null;
    if (!item) break; // Queue empty

    try {
      // Get the task from DB
      const task = await taskRepo.findById(item.taskId);
      if (!task) {
        logger.warn({ taskId: item.taskId }, 'Urgent task not found in DB, skipping');
        processed++;
        continue;
      }

      // Forward to agent as high-priority task message
      const message: AgentMessage = {
        id: uuid(),
        type: 'task',
        from: 'orchestrator',
        to: item.agentId,
        payload: {
          task_id: task.id,
          title: task.title,
          description: task.description,
          priority: 'urgent',
          source: 'urgent_queue',
        },
        priority: 'urgent',
        timestamp: new Date(),
        requiresResponse: true,
      };

      await publish(channels.agent(item.agentId), message);

      logger.info({
        taskId: item.taskId,
        agentId: item.agentId
      }, 'Urgent task forwarded to agent');

      processed++;
    } catch (err) {
      logger.error({ err, item }, 'Failed to process urgent queue item');
      processed++;
    }
  }

  if (processed > 0) {
    logger.debug({ processed }, 'Urgent queue batch processed');
  }
}

// Schedule Backlog Grooming - workflow optimization every 3 hours
export function scheduleBacklogGrooming(): string {
  const jobId = 'backlog-grooming';
  const cronExpression = '0 */3 * * *'; // Every 3 hours

  logger.info({ cronExpression }, 'Scheduling Backlog Grooming');

  const task = cron.schedule(cronExpression, async () => {
    try {
      logger.info('Running Backlog Grooming');
      await runBacklogGrooming();
    } catch (err) {
      logger.error({ err }, 'Backlog Grooming failed');
    }
  });

  jobs.set(jobId, task);
  jobMetadata.set(jobId, {
    id: jobId,
    agentId: 'system',
    cronExpression,
    enabled: true,
  });

  return jobId;
}

// Schedule Event Executor - processes due scheduled events (posts, releases, etc.)
export function scheduleEventExecutor(): string {
  const jobId = 'event-executor';
  const cronExpression = '* * * * *'; // Every minute

  logger.info({ cronExpression }, 'Scheduling Event Executor');

  const task = cron.schedule(cronExpression, async () => {
    try {
      await executeDueEvents();
    } catch (err) {
      logger.error({ err }, 'Event Executor failed');
    }
  });

  jobs.set(jobId, task);
  jobMetadata.set(jobId, {
    id: jobId,
    agentId: 'system',
    cronExpression,
    enabled: true,
  });

  return jobId;
}

// Execute due scheduled events
async function executeDueEvents(): Promise<void> {
  const dueEvents = await projectRepo.findDueEvents();

  if (dueEvents.length === 0) {
    return; // Nothing to execute
  }

  logger.info({ count: dueEvents.length }, 'Processing due scheduled events');

  for (const event of dueEvents) {
    try {
      // Find the responsible agent
      const agent = await agentRepo.findByType(event.agent as any);
      if (!agent) {
        logger.warn({ eventId: event.id, agent: event.agent }, 'Agent not found for event');
        await projectRepo.updateEventStatus(event.id, 'failed', {
          error: `Agent ${event.agent} not found`,
          attemptedAt: new Date().toISOString(),
        });
        continue;
      }

      // Build the task message based on event type
      let taskPayload: Record<string, unknown>;

      switch (event.eventType) {
        case 'post':
          taskPayload = {
            action: 'execute_scheduled_post',
            eventId: event.id,
            platform: event.platform,
            content: event.content,
            mediaUrls: event.mediaUrls || [],
            title: event.title,
          };
          break;

        case 'ama':
          taskPayload = {
            action: 'start_ama_session',
            eventId: event.id,
            platform: event.platform,
            title: event.title,
            description: event.description,
            durationMinutes: event.durationMinutes,
          };
          break;

        case 'release':
          taskPayload = {
            action: 'execute_release',
            eventId: event.id,
            title: event.title,
            description: event.description,
          };
          break;

        case 'milestone':
        case 'deadline':
          taskPayload = {
            action: 'announce_milestone',
            eventId: event.id,
            title: event.title,
            description: event.description,
            projectId: event.projectId,
          };
          break;

        default:
          taskPayload = {
            action: 'execute_scheduled_event',
            eventId: event.id,
            eventType: event.eventType,
            title: event.title,
            description: event.description,
          };
      }

      // Send task to the responsible agent
      const message: AgentMessage = {
        id: uuid(),
        type: 'task',
        from: 'orchestrator',
        to: agent.id,
        payload: taskPayload,
        priority: 'high', // Scheduled events are time-sensitive
        timestamp: new Date(),
        requiresResponse: true,
        responseDeadline: new Date(Date.now() + 300000), // 5 min deadline
      };

      await publish(channels.agent(agent.id), message);

      // Update event status to processing (we'll mark as published when agent confirms)
      // For now, mark as published since we sent the task
      await projectRepo.updateEventStatus(event.id, 'published', {
        dispatchedAt: new Date().toISOString(),
        messageId: message.id,
      });

      // Log the event execution
      await eventRepo.log({
        eventType: 'event_scheduled',
        sourceAgent: 'orchestrator',
        targetAgent: agent.id,
        payload: {
          scheduledEventId: event.id,
          eventType: event.eventType,
          platform: event.platform,
          title: event.title,
        },
      });

      logger.info({
        eventId: event.id,
        eventType: event.eventType,
        agent: event.agent,
        platform: event.platform,
      }, 'Scheduled event dispatched to agent');

    } catch (err) {
      logger.error({ err, eventId: event.id }, 'Failed to execute scheduled event');
      await projectRepo.updateEventStatus(event.id, 'failed', {
        error: err instanceof Error ? err.message : String(err),
        attemptedAt: new Date().toISOString(),
      });
    }
  }
}

// Schedule daily digest
export function scheduleDailyDigest(): string {
  const jobId = 'daily-digest';
  const cronExpression = '0 9 * * *'; // 9:00 UTC

  logger.info({ cronExpression }, 'Scheduling daily digest');

  const task = cron.schedule(cronExpression, async () => {
    logger.info('Generating daily digest');
    // Send digest request to CEO
    const ceoAgent = await agentRepo.findByType('ceo');
    if (ceoAgent) {
      const message: AgentMessage = {
        id: uuid(),
        type: 'task',
        from: 'orchestrator',
        to: ceoAgent.id,
        payload: {
          action: 'generate_daily_digest',
          date: new Date().toISOString().split('T')[0],
        },
        priority: 'normal',
        timestamp: new Date(),
        requiresResponse: true,
        responseDeadline: new Date(Date.now() + 3600000), // 1 hour
      };

      await publish(channels.agent(ceoAgent.id), message);
    }
  });

  jobs.set(jobId, task);
  jobMetadata.set(jobId, {
    id: jobId,
    agentId: 'system',
    cronExpression,
    enabled: true,
  });

  return jobId;
}

// Stop a scheduled job
export function stopJob(jobId: string): boolean {
  const task = jobs.get(jobId);
  if (!task) return false;

  task.stop();
  jobs.delete(jobId);
  jobMetadata.delete(jobId);

  logger.info({ jobId }, 'Stopped scheduled job');
  return true;
}

// Pause a job
export function pauseJob(jobId: string): boolean {
  const task = jobs.get(jobId);
  if (!task) return false;

  task.stop();
  const meta = jobMetadata.get(jobId);
  if (meta) meta.enabled = false;

  logger.info({ jobId }, 'Paused scheduled job');
  return true;
}

// Resume a job
export function resumeJob(jobId: string): boolean {
  const task = jobs.get(jobId);
  if (!task) return false;

  task.start();
  const meta = jobMetadata.get(jobId);
  if (meta) meta.enabled = true;

  logger.info({ jobId }, 'Resumed scheduled job');
  return true;
}

// Get all scheduled jobs
export function getScheduledJobs(): ScheduledJob[] {
  return Array.from(jobMetadata.values());
}

// Initialize scheduler for all active agents
export async function initializeAgentSchedules(): Promise<void> {
  logger.info('Initializing agent schedules');

  const agents = await agentRepo.findAll();
  for (const agent of agents) {
    if (agent.status === 'active') {
      scheduleAgentLoop(agent.id, agent.type);
    }
  }
}

// Stop all scheduled jobs
export function stopAllJobs(): void {
  logger.info('Stopping all scheduled jobs');

  for (const [jobId, task] of jobs) {
    task.stop();
    logger.debug({ jobId }, 'Stopped job');
  }

  jobs.clear();
  jobMetadata.clear();
}

// Initialize scheduler
export async function initialize(): Promise<void> {
  logger.info('Initializing scheduler');

  // Schedule system jobs
  scheduleHealthChecks();
  scheduleEscalationChecks();
  scheduleDailyDigest();
  scheduleArchiveWorker();
  scheduleDataFetcher();
  scheduleBacklogGrooming();
  scheduleEventExecutor();
  scheduleUrgentQueueProcessor(); // TASK-101: Process urgent queue

  // Run data fetch immediately on startup
  logger.info('Running initial data fetch...');
  runDataFetch().catch(err => logger.error({ err }, 'Initial data fetch failed'));

  // Run backlog grooming immediately on startup (TASK-100)
  // This populates context:backlog in Redis so agents can see Kanban issues
  logger.info('Running initial backlog grooming...');
  runBacklogGrooming().catch(err => logger.error({ err }, 'Initial backlog grooming failed'));

  // Schedule agent loops
  await initializeAgentSchedules();
}
