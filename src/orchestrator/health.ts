import { createLogger } from '../lib/logger.js';
import { checkConnection as checkDbConnection } from '../lib/db.js';
import { checkConnection as checkRedisConnection, setAgentStatus, getAllAgentStatuses } from '../lib/redis.js';
import { getAgentContainerStatus, checkContainerHealth } from './container.js';
import { agentRepo } from '../lib/db.js';
import type { HealthStatus, AgentType } from '../lib/types.js';

const logger = createLogger('health');

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    docker: ComponentHealth;
    agents: AgentHealthSummary;
  };
  uptime: number;
}

interface ComponentHealth {
  status: 'healthy' | 'unhealthy';
  latencyMs?: number;
  error?: string;
}

interface AgentHealthSummary {
  total: number;
  healthy: number;
  unhealthy: number;
  inactive: number;
  details: Record<string, HealthStatus>;
}

// Track start time for uptime calculation
const startTime = Date.now();

// Check database health
async function checkDatabaseHealth(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const ok = await checkDbConnection();
    return {
      status: ok ? 'healthy' : 'unhealthy',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: String(err),
    };
  }
}

// Check Redis health
async function checkRedisHealth(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const ok = await checkRedisConnection();
    return {
      status: ok ? 'healthy' : 'unhealthy',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: String(err),
    };
  }
}

// Check Docker health (basic ping)
async function checkDockerHealth(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    // Import dynamically to avoid circular dependency
    const { isPortainerConfigured, portainerFetch } = await import('./container.js');
    if (!isPortainerConfigured) return { status: 'unhealthy', latencyMs: Date.now() - start, error: 'Not configured' }; await portainerFetch('/api/status');
    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      error: String(err),
    };
  }
}

// Check all agent container health
async function checkAgentsHealth(): Promise<AgentHealthSummary> {
  const agents = await agentRepo.findAll();
  const details: Record<string, HealthStatus> = {};

  let healthy = 0;
  let unhealthy = 0;
  let inactive = 0;

  for (const agent of agents) {
    if (agent.status === 'inactive') {
      inactive++;
      details[agent.type] = {
        agentId: agent.id,
        status: 'unknown',
        lastCheck: new Date(),
        containerStatus: 'not running',
      };
      continue;
    }

    const status = await getAgentContainerStatus(agent.type);
    if (status) {
      details[agent.type] = status;
      await setAgentStatus(agent.id, status);

      if (status.status === 'healthy') {
        healthy++;
      } else {
        unhealthy++;
      }
    } else {
      unhealthy++;
      details[agent.type] = {
        agentId: agent.id,
        status: 'unhealthy',
        lastCheck: new Date(),
        errorMessage: 'Container not found',
      };
    }
  }

  return {
    total: agents.length,
    healthy,
    unhealthy,
    inactive,
    details,
  };
}

// Full system health check
export async function getSystemHealth(): Promise<SystemHealth> {
  logger.debug('Running system health check');

  const [database, redis, docker, agents] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkDockerHealth(),
    checkAgentsHealth(),
  ]);

  // Determine overall status
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  // Critical components
  if (database.status === 'unhealthy' || redis.status === 'unhealthy') {
    status = 'unhealthy';
  }
  // Docker issue = degraded (can't manage containers but existing ones may run)
  else if (docker.status === 'unhealthy') {
    status = 'degraded';
  }
  // Some agents unhealthy = degraded
  else if (agents.unhealthy > 0) {
    status = 'degraded';
  }

  return {
    status,
    timestamp: new Date(),
    components: {
      database,
      redis,
      docker,
      agents,
    },
    uptime: Date.now() - startTime,
  };
}

// Quick liveness check (for k8s probes)
export async function isAlive(): Promise<boolean> {
  return true; // Process is running
}

// Readiness check (for k8s probes)
export async function isReady(): Promise<boolean> {
  try {
    const [dbOk, redisOk] = await Promise.all([
      checkDbConnection(),
      checkRedisConnection(),
    ]);
    return dbOk && redisOk;
  } catch {
    return false;
  }
}

// Get agent-specific health
export async function getAgentHealth(agentType: AgentType): Promise<HealthStatus | null> {
  return getAgentContainerStatus(agentType);
}

// Monitor and log health periodically
export async function runHealthCheck(): Promise<void> {
  const health = await getSystemHealth();

  if (health.status === 'unhealthy') {
    logger.error({ health }, 'System unhealthy');
  } else if (health.status === 'degraded') {
    logger.warn({ health }, 'System degraded');
  } else {
    logger.debug({ status: health.status, uptime: health.uptime }, 'Health check OK');
  }

  // Update Redis with latest statuses
  for (const [agentType, status] of Object.entries(health.components.agents.details)) {
    await setAgentStatus(status.agentId, status);
  }
}

// Get cached agent statuses from Redis (fast)
export async function getCachedAgentStatuses(): Promise<Record<string, HealthStatus>> {
  return getAllAgentStatuses();
}
