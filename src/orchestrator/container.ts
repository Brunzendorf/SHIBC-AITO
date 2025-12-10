import Docker from 'dockerode';
import { config, agentConfigs } from '../lib/config.js';
import { createLogger } from '../lib/logger.js';
import { agentRepo, eventRepo } from '../lib/db.js';
import { setAgentStatus, acquireLock, releaseLock, keys } from '../lib/redis.js';
import type { AgentType, AgentStatus, ContainerConfig, HealthStatus } from '../lib/types.js';

const logger = createLogger('container');

// Docker client
const docker = new Docker({ socketPath: config.DOCKER_SOCKET });

// Container name prefix
const CONTAINER_PREFIX = 'aito-';

// Base agent image
const AGENT_IMAGE = 'aito-agent:latest';

// Get container name for agent
function getContainerName(agentType: AgentType): string {
  return `${CONTAINER_PREFIX}${agentType}`;
}

// Get container config for agent type
function getContainerConfig(agentType: AgentType, agentId: string): ContainerConfig {
  const agentConfig = agentConfigs[agentType];

  return {
    image: AGENT_IMAGE,
    name: getContainerName(agentType),
    environment: {
      AGENT_ID: agentId,
      AGENT_TYPE: agentType,
      AGENT_PROFILE: `/profiles/${agentType}.md`,
      LOOP_INTERVAL: String(agentConfig.loopInterval),
      POSTGRES_URL: config.POSTGRES_URL,
      REDIS_URL: config.REDIS_URL,
      OLLAMA_URL: config.OLLAMA_URL,
      GITHUB_TOKEN: config.GITHUB_TOKEN || '',
      GITHUB_ORG: config.GITHUB_ORG,
      ...(agentConfig.gitFilter && { GIT_FILTER: agentConfig.gitFilter }),
    },
    volumes: [
      `${process.cwd()}/profiles:/profiles:ro`,
      `${process.cwd()}/memory/${agentType}:/memory`,
    ],
    memory: '512m',
    cpus: '1',
    restart: 'unless-stopped',
  };
}

// Convert config to Docker create options
function toDockerCreateOptions(containerConfig: ContainerConfig): Docker.ContainerCreateOptions {
  const env = Object.entries(containerConfig.environment).map(
    ([k, v]) => `${k}=${v}`
  );

  return {
    Image: containerConfig.image,
    name: containerConfig.name,
    Env: env,
    HostConfig: {
      Binds: containerConfig.volumes,
      Memory: containerConfig.memory ? parseMemory(containerConfig.memory) : undefined,
      NanoCpus: containerConfig.cpus ? parseCpus(containerConfig.cpus) : undefined,
      RestartPolicy: containerConfig.restart
        ? { Name: containerConfig.restart }
        : undefined,
      NetworkMode: 'aito-network',
    },
    Labels: {
      'aito.managed': 'true',
      'aito.type': containerConfig.name.replace(CONTAINER_PREFIX, ''),
    },
  };
}

// Parse memory string (e.g., "512m" -> bytes)
function parseMemory(mem: string): number {
  const units: Record<string, number> = {
    b: 1,
    k: 1024,
    m: 1024 * 1024,
    g: 1024 * 1024 * 1024,
  };
  const match = mem.toLowerCase().match(/^(\d+)([bkmg])?$/);
  if (!match) return 512 * 1024 * 1024; // Default 512MB
  return parseInt(match[1]) * (units[match[2] || 'b'] || 1);
}

// Parse CPU string (e.g., "1" -> nanoseconds)
function parseCpus(cpus: string): number {
  return parseFloat(cpus) * 1e9;
}

// Start an agent container
export async function startAgent(agentType: AgentType): Promise<string> {
  const lockKey = keys.lock.container(agentType);
  const lockAcquired = await acquireLock(lockKey, 120);

  if (!lockAcquired) {
    throw new Error(`Container ${agentType} is already being modified`);
  }

  try {
    const containerName = getContainerName(agentType);
    logger.info({ agentType, containerName }, 'Starting agent container');

    // Check if container already exists
    const existingContainers = await docker.listContainers({
      all: true,
      filters: { name: [containerName] },
    });

    if (existingContainers.length > 0) {
      const existing = existingContainers[0];
      if (existing.State === 'running') {
        logger.info({ agentType }, 'Container already running');
        return existing.Id;
      }

      // Remove stopped container
      const container = docker.getContainer(existing.Id);
      await container.remove({ force: true });
      logger.info({ agentType }, 'Removed existing stopped container');
    }

    // Get or create agent in database
    let agent = await agentRepo.findByType(agentType);
    if (!agent) {
      const agentConfig = agentConfigs[agentType];
      agent = await agentRepo.create({
        type: agentType,
        name: agentConfig.name,
        profilePath: `/profiles/${agentType}.md`,
        loopInterval: agentConfig.loopInterval,
        gitRepo: config.GITHUB_ORG,
        gitFilter: agentConfig.gitFilter,
        status: 'starting',
      });
    }

    // Update status to starting
    await agentRepo.updateStatus(agent.id, 'starting');

    // Get container config
    const containerConfig = getContainerConfig(agentType, agent.id);
    const createOptions = toDockerCreateOptions(containerConfig);

    // Create and start container
    const container = await docker.createContainer(createOptions);
    await container.start();

    const containerId = container.id;
    logger.info({ agentType, containerId }, 'Container started');

    // Update agent status
    await agentRepo.updateStatus(agent.id, 'active', containerId);

    // Set Redis status
    await setAgentStatus(agent.id, {
      agentId: agent.id,
      status: 'healthy',
      lastCheck: new Date(),
      containerId,
      containerStatus: 'running',
    });

    // Log event
    await eventRepo.log({
      eventType: 'agent_started',
      sourceAgent: agent.id,
      payload: { agentType, containerId },
    });

    return containerId;
  } finally {
    await releaseLock(lockKey);
  }
}

// Stop an agent container
export async function stopAgent(agentType: AgentType): Promise<void> {
  const lockKey = keys.lock.container(agentType);
  const lockAcquired = await acquireLock(lockKey, 120);

  if (!lockAcquired) {
    throw new Error(`Container ${agentType} is already being modified`);
  }

  try {
    const containerName = getContainerName(agentType);
    logger.info({ agentType, containerName }, 'Stopping agent container');

    const containers = await docker.listContainers({
      all: true,
      filters: { name: [containerName] },
    });

    if (containers.length === 0) {
      logger.info({ agentType }, 'Container not found');
      return;
    }

    const containerInfo = containers[0];
    const container = docker.getContainer(containerInfo.Id);

    if (containerInfo.State === 'running') {
      await container.stop({ t: 30 }); // 30 sec grace period
      logger.info({ agentType }, 'Container stopped');
    }

    // Update database
    const agent = await agentRepo.findByType(agentType);
    if (agent) {
      await agentRepo.updateStatus(agent.id, 'inactive');

      // Log event
      await eventRepo.log({
        eventType: 'agent_stopped',
        sourceAgent: agent.id,
        payload: { agentType },
      });
    }
  } finally {
    await releaseLock(lockKey);
  }
}

// Restart an agent container
export async function restartAgent(agentType: AgentType): Promise<string> {
  await stopAgent(agentType);
  return startAgent(agentType);
}

// Get agent container status
export async function getAgentContainerStatus(
  agentType: AgentType
): Promise<HealthStatus | null> {
  const containerName = getContainerName(agentType);

  const containers = await docker.listContainers({
    all: true,
    filters: { name: [containerName] },
  });

  if (containers.length === 0) {
    return null;
  }

  const containerInfo = containers[0];
  const agent = await agentRepo.findByType(agentType);

  if (!agent) {
    return null;
  }

  // Get detailed stats if running
  let memoryUsage: number | undefined;
  let cpuUsage: number | undefined;

  if (containerInfo.State === 'running') {
    try {
      const container = docker.getContainer(containerInfo.Id);
      const stats = await container.stats({ stream: false });

      // Calculate memory usage
      if (stats.memory_stats?.usage) {
        memoryUsage = stats.memory_stats.usage;
      }

      // Calculate CPU usage
      if (stats.cpu_stats?.cpu_usage?.total_usage) {
        const cpuDelta =
          stats.cpu_stats.cpu_usage.total_usage -
          (stats.precpu_stats?.cpu_usage?.total_usage || 0);
        const systemDelta =
          stats.cpu_stats.system_cpu_usage -
          (stats.precpu_stats?.system_cpu_usage || 0);
        if (systemDelta > 0) {
          cpuUsage = (cpuDelta / systemDelta) * 100;
        }
      }
    } catch (err) {
      logger.warn({ err, agentType }, 'Failed to get container stats');
    }
  }

  return {
    agentId: agent.id,
    status: containerInfo.State === 'running' ? 'healthy' : 'unhealthy',
    lastCheck: new Date(),
    containerId: containerInfo.Id,
    containerStatus: containerInfo.State,
    memoryUsage,
    cpuUsage,
  };
}

// Get all AITO-managed containers
export async function listManagedContainers(): Promise<Docker.ContainerInfo[]> {
  return docker.listContainers({
    all: true,
    filters: { label: ['aito.managed=true'] },
  });
}

// Check container health
export async function checkContainerHealth(
  agentType: AgentType
): Promise<boolean> {
  const status = await getAgentContainerStatus(agentType);
  return status?.status === 'healthy';
}

// Auto-restart unhealthy containers
export async function autoRestartUnhealthy(): Promise<void> {
  const agents = await agentRepo.findAll();

  for (const agent of agents) {
    if (agent.status === 'active') {
      const healthy = await checkContainerHealth(agent.type);
      if (!healthy) {
        logger.warn({ agentType: agent.type }, 'Unhealthy container detected, restarting');
        try {
          await restartAgent(agent.type);
        } catch (err) {
          logger.error({ err, agentType: agent.type }, 'Failed to restart container');

          // Update status to error
          await agentRepo.updateStatus(agent.id, 'error');

          // Log event
          await eventRepo.log({
            eventType: 'agent_error',
            sourceAgent: agent.id,
            payload: { error: String(err) },
          });
        }
      }
    }
  }
}

// Ensure network exists
export async function ensureNetwork(): Promise<void> {
  const networks = await docker.listNetworks({
    filters: { name: ['aito-network'] },
  });

  if (networks.length === 0) {
    await docker.createNetwork({
      Name: 'aito-network',
      Driver: 'bridge',
    });
    logger.info('Created aito-network');
  }
}

// Initialize container manager
export async function initialize(): Promise<void> {
  logger.info('Initializing container manager');
  await ensureNetwork();

  // Check Docker connection
  try {
    await docker.ping();
    logger.info('Docker connection established');
  } catch (err) {
    logger.error({ err }, 'Failed to connect to Docker');
    throw err;
  }
}

// Cleanup
export async function cleanup(): Promise<void> {
  // Stop all managed containers gracefully
  const containers = await listManagedContainers();
  for (const containerInfo of containers) {
    if (containerInfo.State === 'running') {
      const container = docker.getContainer(containerInfo.Id);
      await container.stop({ t: 30 });
    }
  }
}

export { docker };
