/**
 * Container Manager - Portainer API Implementation
 * Uses Portainer REST API instead of Docker socket.
 */
import { config, agentConfigs, isDryRun } from '../lib/config.js';
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

// Docker Compose project name (must match docker-compose.yml deployment)
const COMPOSE_PROJECT = config.COMPOSE_PROJECT || 'shibc-aito';

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

function getAgentImage(agentType: AgentType): string {
  return 'shibc-aito-' + agentType + '-agent:latest';
}

function getContainerName(agentType: AgentType): string {
  return CONTAINER_PREFIX + agentType;
}

function getContainerConfig(agentType: AgentType, agentId: string): ContainerConfig {
  const agentConfig = agentConfigs[agentType];
  return {
    image: getAgentImage(agentType),
    name: getContainerName(agentType),
    environment: {
      // Core agent settings
      AGENT_ID: agentId,
      AGENT_TYPE: agentType,
      AGENT_PROFILE: '/app/profiles/' + agentType + '.md',
      LOOP_INTERVAL: String(agentConfig.loopInterval),
      DRY_RUN: String(isDryRun),
      // Database & Infrastructure
      POSTGRES_URL: config.POSTGRES_URL,
      REDIS_URL: config.REDIS_URL,
      OLLAMA_URL: config.OLLAMA_URL,
      QDRANT_URL: config.QDRANT_URL,
      // GitHub
      GITHUB_TOKEN: config.GITHUB_TOKEN || '',
      GITHUB_ORG: config.GITHUB_ORG,
      // LLM Routing Configuration (CRITICAL - prevents Gemini quota issues)
      LLM_ROUTING_STRATEGY: config.LLM_ROUTING_STRATEGY,
      LLM_ENABLE_FALLBACK: config.LLM_ENABLE_FALLBACK,
      LLM_PREFER_GEMINI: config.LLM_PREFER_GEMINI,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
      GEMINI_DEFAULT_MODEL: config.GEMINI_DEFAULT_MODEL,
      GEMINI_MONTHLY_QUOTA: process.env.GEMINI_MONTHLY_QUOTA || '10000000',
      // Workspace configuration
      WORKSPACE_REPO_URL: process.env.WORKSPACE_REPO_URL || 'https://github.com/Brunzendorf/shibc-workspace.git',
      WORKSPACE_BRANCH: process.env.WORKSPACE_BRANCH || 'main',
      WORKSPACE_SKIP_PR: process.env.WORKSPACE_SKIP_PR || 'false',
      // Optional filters per agent
      ...('gitFilter' in agentConfig && agentConfig.gitFilter && { GIT_FILTER: agentConfig.gitFilter }),
    },
    volumes: [
      // Named volumes with compose project prefix for stack consistency
      COMPOSE_PROJECT + '_' + agentType + '_memory:/app/memory',
      COMPOSE_PROJECT + '_shared_claude_config:/app/.claude',
      COMPOSE_PROJECT + '_shared_gemini_config:/app/.gemini',
      COMPOSE_PROJECT + '_' + agentType + '_workspace:/app/workspace',
      './profiles:/app/profiles:ro',
    ],
    memory: '512m',
    cpus: '1',
    restart: 'unless-stopped',
  };
}

function toDockerCreateBody(containerConfig: ContainerConfig): Record<string, unknown> {
  const env = Object.entries(containerConfig.environment).map(([k, v]) => k + '=' + v);
  const agentType = containerConfig.name.replace(CONTAINER_PREFIX, '');
  const serviceName = agentType + '-agent';

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
    Labels: {
      // Custom labels
      'aito.managed': 'true',
      'aito.type': agentType,
      // Docker Compose labels for stack integration
      'com.docker.compose.project': COMPOSE_PROJECT,
      'com.docker.compose.service': serviceName,
      'com.docker.compose.container-number': '1',
      'com.docker.compose.oneoff': 'False',
      'com.docker.compose.project.working_dir': '/app',
      'com.docker.compose.version': '2.24.0',
    },
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
      const containerStatus = await getAgentContainerStatus(agent.type);

      // Container doesn't exist or is not running
      if (!containerStatus || containerStatus.containerStatus !== 'running') {
        const action = containerStatus?.containerStatus === 'exited' ? 'starting stopped' : 'creating';
        logger.warn({ agentType: agent.type, containerStatus: containerStatus?.containerStatus }, `${action} container`);
        try {
          // Use startAgent for stopped/missing containers (it creates if needed)
          await startAgent(agent.type);
          logger.info({ agentType: agent.type }, 'Container started successfully');
        } catch (err) {
          logger.error({ err, agentType: agent.type }, 'Failed to start container');
          await agentRepo.updateStatus(agent.id, 'error');
          await eventRepo.log({ eventType: 'agent_error', sourceAgent: agent.id, payload: { error: String(err) } });
        }
      }
    }
  }
}

// Ensure all active agents have running containers (called at startup)
export async function ensureAllAgentsRunning(): Promise<void> {
  logger.info('Ensuring all active agents have running containers...');
  const agents = await agentRepo.findAll();
  let started = 0;
  let alreadyRunning = 0;

  for (const agent of agents) {
    if (agent.status === 'active') {
      const containerStatus = await getAgentContainerStatus(agent.type);

      if (!containerStatus || containerStatus.containerStatus !== 'running') {
        logger.info({ agentType: agent.type }, 'Starting agent container');
        try {
          await startAgent(agent.type);
          started++;
        } catch (err) {
          logger.error({ err, agentType: agent.type }, 'Failed to start agent container');
        }
      } else {
        alreadyRunning++;
      }
    }
  }

  logger.info({ started, alreadyRunning }, 'Agent startup check complete');
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
    // Don't throw - orchestrator should continue even if Portainer fails
    logger.warn({ err }, 'Portainer unavailable - container management disabled (orchestrator continues)');
    logger.info('To enable container management: reconfigure Portainer API key or check env vars');
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
