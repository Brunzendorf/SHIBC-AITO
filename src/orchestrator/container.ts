/**
 * Container Manager - Portainer API Implementation
 * Uses Portainer REST API instead of Docker socket.
 */
import { config, agentConfigs } from '../lib/config.js';
import { createLogger } from '../lib/logger.js';
import { agentRepo, eventRepo } from '../lib/db.js';
import { setAgentStatus, acquireLock, releaseLock, keys } from '../lib/redis.js';
import type { AgentType, ContainerConfig, HealthStatus } from '../lib/types.js';

const logger = createLogger('container');

// Portainer API configuration
const portainerUrl = config.PORTAINER_URL;
const portainerApiKey = config.PORTAINER_API_KEY;
const portainerEnvId = config.PORTAINER_ENV_ID;
const isPortainerConfigured = !!(portainerUrl && portainerApiKey && portainerEnvId);

// Portainer API client
async function portainerFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  if (!isPortainerConfigured) throw new Error('Portainer not configured');
  const url = portainerUrl + path;
  const headers = { 'X-API-Key': portainerApiKey!, 'Content-Type': 'application/json', ...options.headers };
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) throw new Error('Portainer API error: ' + response.status);
  const text = await response.text();
  return text ? JSON.parse(text) : ({} as T);
}

// Docker API via Portainer
async function dockerApi<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  return portainerFetch<T>('/api/endpoints/' + portainerEnvId + '/docker' + path, options);
}

// Types
interface ContainerInfo { Id: string; Names: string[]; State: string; Status: string; Labels: Record<string, string>; }
interface ContainerStats { memory_stats?: { usage?: number }; cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number }; precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number }; }

// Container name prefix
const CONTAINER_PREFIX = 'aito-';
const AGENT_IMAGE = 'aito-agent:latest';

function getContainerName(agentType: AgentType): string {
  return CONTAINER_PREFIX + agentType;
}

function getContainerConfig(agentType: AgentType, agentId: string): ContainerConfig {
  const agentConfig = agentConfigs[agentType];
  return {
    image: AGENT_IMAGE,
    name: getContainerName(agentType),
    environment: {
      AGENT_ID: agentId,
      AGENT_TYPE: agentType,
      AGENT_PROFILE: '/profiles/' + agentType + '.md',
      LOOP_INTERVAL: String(agentConfig.loopInterval),
      POSTGRES_URL: config.POSTGRES_URL,
      REDIS_URL: config.REDIS_URL,
      OLLAMA_URL: config.OLLAMA_URL,
      GITHUB_TOKEN: config.GITHUB_TOKEN || '',
      GITHUB_ORG: config.GITHUB_ORG,
      ...('gitFilter' in agentConfig && agentConfig.gitFilter && { GIT_FILTER: agentConfig.gitFilter }),
    },
    volumes: [process.cwd() + '/profiles:/profiles:ro', process.cwd() + '/memory/' + agentType + ':/memory'],
    memory: '512m',
    cpus: '1',
    restart: 'unless-stopped',
  };
}

function toDockerCreateBody(containerConfig: ContainerConfig): Record<string, unknown> {
  const env = Object.entries(containerConfig.environment).map(([k, v]) => k + '=' + v);
  return {
    Image: containerConfig.image,
    Env: env,
    HostConfig: {
      Binds: containerConfig.volumes,
      Memory: containerConfig.memory ? parseMemory(containerConfig.memory) : undefined,
      NanoCpus: containerConfig.cpus ? parseCpus(containerConfig.cpus) : undefined,
      RestartPolicy: containerConfig.restart ? { Name: containerConfig.restart } : undefined,
      NetworkMode: 'aito-network',
    },
    Labels: { 'aito.managed': 'true', 'aito.type': containerConfig.name.replace(CONTAINER_PREFIX, '') },
  };
}

function parseMemory(mem: string): number {
  const units: Record<string, number> = { b: 1, k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 };
  const match = mem.toLowerCase().match(/^(\d+)([bkmg])?$/);
  if (!match) return 512 * 1024 * 1024;
  return parseInt(match[1]) * (units[match[2] || 'b'] || 1);
}

function parseCpus(cpus: string): number {
  return parseFloat(cpus) * 1e9;
}

export async function startAgent(agentType: AgentType): Promise<string> {
  if (!isPortainerConfigured) {
    logger.warn({ agentType }, 'Portainer not configured - skipping');
    return 'mock-container-id';
  }

  const lockKey = keys.lock.container(agentType);
  const lockAcquired = await acquireLock(lockKey, 120);
  if (!lockAcquired) throw new Error('Container ' + agentType + ' is already being modified');

  try {
    const containerName = getContainerName(agentType);
    logger.info({ agentType, containerName }, 'Starting agent container via Portainer');

    const containers = await dockerApi<ContainerInfo[]>(
      '/containers/json?all=true&filters=' + encodeURIComponent(JSON.stringify({ name: [containerName] }))
    );

    if (containers.length > 0) {
      const existing = containers[0];
      if (existing.State === 'running') {
        logger.info({ agentType }, 'Container already running');
        return existing.Id;
      }
      await dockerApi('/containers/' + existing.Id + '?force=true', { method: 'DELETE' });
      logger.info({ agentType }, 'Removed existing stopped container');
    }

    let agent = await agentRepo.findByType(agentType);
    if (!agent) {
      const agentConfig = agentConfigs[agentType];
      agent = await agentRepo.create({
        type: agentType,
        name: agentConfig.name,
        profilePath: '/profiles/' + agentType + '.md',
        loopInterval: agentConfig.loopInterval,
        gitRepo: config.GITHUB_ORG,
        gitFilter: 'gitFilter' in agentConfig ? agentConfig.gitFilter : undefined,
        status: 'starting',
      });
    }

    await agentRepo.updateStatus(agent.id, 'starting');
    const containerConfig = getContainerConfig(agentType, agent.id);
    const createBody = toDockerCreateBody(containerConfig);

    const createResult = await dockerApi<{ Id: string }>(
      '/containers/create?name=' + containerName,
      { method: 'POST', body: JSON.stringify(createBody) }
    );

    const containerId = createResult.Id;
    await dockerApi('/containers/' + containerId + '/start', { method: 'POST' });
    logger.info({ agentType, containerId }, 'Container started via Portainer');

    await agentRepo.updateStatus(agent.id, 'active', containerId);
    await setAgentStatus(agent.id, {
      agentId: agent.id,
      status: 'healthy',
      lastCheck: new Date(),
      containerId,
      containerStatus: 'running',
    });

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

export async function stopAgent(agentType: AgentType): Promise<void> {
  if (!isPortainerConfigured) {
    logger.warn({ agentType }, 'Portainer not configured - skipping');
    return;
  }

  const lockKey = keys.lock.container(agentType);
  const lockAcquired = await acquireLock(lockKey, 120);
  if (!lockAcquired) throw new Error('Container ' + agentType + ' is already being modified');

  try {
    const containerName = getContainerName(agentType);
    logger.info({ agentType, containerName }, 'Stopping agent container via Portainer');

    const containers = await dockerApi<ContainerInfo[]>(
      '/containers/json?all=true&filters=' + encodeURIComponent(JSON.stringify({ name: [containerName] }))
    );

    if (containers.length === 0) {
      logger.info({ agentType }, 'Container not found');
      return;
    }

    const containerInfo = containers[0];
    if (containerInfo.State === 'running') {
      await dockerApi('/containers/' + containerInfo.Id + '/stop?t=30', { method: 'POST' });
      logger.info({ agentType }, 'Container stopped');
    }

    const agent = await agentRepo.findByType(agentType);
    if (agent) {
      await agentRepo.updateStatus(agent.id, 'inactive');
      await eventRepo.log({ eventType: 'agent_stopped', sourceAgent: agent.id, payload: { agentType } });
    }
  } finally {
    await releaseLock(lockKey);
  }
}

export async function restartAgent(agentType: AgentType): Promise<string> {
  await stopAgent(agentType);
  return startAgent(agentType);
}

export async function getAgentContainerStatus(agentType: AgentType): Promise<HealthStatus | null> {
  if (!isPortainerConfigured) return null;

  const containerName = getContainerName(agentType);
  const containers = await dockerApi<ContainerInfo[]>(
    '/containers/json?all=true&filters=' + encodeURIComponent(JSON.stringify({ name: [containerName] }))
  );

  if (containers.length === 0) return null;

  const containerInfo = containers[0];
  const agent = await agentRepo.findByType(agentType);
  if (!agent) return null;

  let memoryUsage: number | undefined;
  let cpuUsage: number | undefined;

  if (containerInfo.State === 'running') {
    try {
      const stats = await dockerApi<ContainerStats>('/containers/' + containerInfo.Id + '/stats?stream=false');
      if (stats.memory_stats?.usage) memoryUsage = stats.memory_stats.usage;
      if (stats.cpu_stats?.cpu_usage?.total_usage) {
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
        const systemDelta = (stats.cpu_stats.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
        if (systemDelta > 0) cpuUsage = (cpuDelta / systemDelta) * 100;
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

export async function listManagedContainers(): Promise<ContainerInfo[]> {
  if (!isPortainerConfigured) return [];
  return dockerApi<ContainerInfo[]>(
    '/containers/json?all=true&filters=' + encodeURIComponent(JSON.stringify({ label: ['aito.managed=true'] }))
  );
}

export async function checkContainerHealth(agentType: AgentType): Promise<boolean> {
  const status = await getAgentContainerStatus(agentType);
  return status?.status === 'healthy';
}

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
          await agentRepo.updateStatus(agent.id, 'error');
          await eventRepo.log({ eventType: 'agent_error', sourceAgent: agent.id, payload: { error: String(err) } });
        }
      }
    }
  }
}

export async function ensureNetwork(): Promise<void> {
  if (!isPortainerConfigured) {
    logger.warn('Portainer not configured - skipping network check');
    return;
  }
  const networks = await dockerApi<{ Name: string }[]>(
    '/networks?filters=' + encodeURIComponent(JSON.stringify({ name: ['aito-network'] }))
  );
  if (networks.length === 0) {
    await dockerApi('/networks/create', { method: 'POST', body: JSON.stringify({ Name: 'aito-network', Driver: 'bridge' }) });
    logger.info('Created aito-network via Portainer');
  }
}

export async function initialize(): Promise<void> {
  logger.info('Initializing container manager');
  if (!isPortainerConfigured) {
    logger.warn('Portainer not configured - container management disabled');
    logger.info('Set PORTAINER_URL, PORTAINER_API_KEY, PORTAINER_ENV_ID to enable');
    return;
  }
  try {
    const status = await portainerFetch<{ Version: string }>('/api/status');
    logger.info({ version: status.Version }, 'Portainer connection established');
    await ensureNetwork();
  } catch (err) {
    logger.error({ err }, 'Failed to connect to Portainer');
    throw err;
  }
}

export async function cleanup(): Promise<void> {
  if (!isPortainerConfigured) return;
  const containers = await listManagedContainers();
  for (const containerInfo of containers) {
    if (containerInfo.State === 'running') {
      try {
        await dockerApi('/containers/' + containerInfo.Id + '/stop?t=30', { method: 'POST' });
      } catch (err) {
        logger.warn({ err, containerId: containerInfo.Id }, 'Failed to stop container during cleanup');
      }
    }
  }
}

export { isPortainerConfigured, portainerFetch, dockerApi };
