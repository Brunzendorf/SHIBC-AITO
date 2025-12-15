import cron from 'node-cron';
import { v4 as uuid } from 'uuid';
import { createLogger } from '../lib/logger.js';
import { agentRepo, eventRepo } from '../lib/db.js';
import { publish, channels } from '../lib/redis.js';
import { agentConfigs, numericConfig } from '../lib/config.js';
import { autoRestartUnhealthy } from './container.js';
import { runArchiveWorker, getArchiveStats } from '../workers/archive-worker.js';
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
      logger.error({ err }, 'Health check failed');
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

  // Schedule agent loops
  await initializeAgentSchedules();
}
