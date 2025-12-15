import { z } from 'zod';

const configSchema = z.object({
  // Server
  PORT: z.string().default('8080'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Dry-Run Mode - logs all external actions but doesn't execute them
  DRY_RUN: z.string().default('false'),

  // Database
  POSTGRES_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Portainer API (replaces Docker socket)
  PORTAINER_URL: z.string().optional(),
  PORTAINER_API_KEY: z.string().optional(),
  PORTAINER_ENV_ID: z.string().optional(),

  // Docker Compose project name (for stack integration)
  COMPOSE_PROJECT: z.string().default('shibc-aito'),

  // Docker (deprecated)
  DOCKER_SOCKET: z.string().default('/var/run/docker.sock'),

  // AI (Ollama for local, Claude Code CLI for complex - NO API!)
  OLLAMA_URL: z.string().default('http://localhost:11434'),

  // RAG / Vector DB
  QDRANT_URL: z.string().default('http://localhost:6333'),

  // Communication
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),

  // GitHub
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_ORG: z.string().default('og-shibaclassic'),

  // Workspace Git Repository
  WORKSPACE_REPO_URL: z.string().default('https://github.com/Brunzendorf/shibc-workspace.git'),
  WORKSPACE_BRANCH: z.string().default('main'),
  WORKSPACE_AUTO_COMMIT: z.string().default('true'),  // Auto-commit on file changes
  WORKSPACE_USE_PR: z.string().default('true'),       // Use branch+PR workflow (quality gate)
  WORKSPACE_AUTO_MERGE: z.string().default('false'),  // Auto-merge PRs after RAG approval

  // Agent Defaults
  DEFAULT_LOOP_INTERVAL: z.string().default('3600'), // 1 hour
  HEALTH_CHECK_INTERVAL: z.string().default('30'), // 30 seconds
  MAX_VETO_ROUNDS: z.string().default('3'),

  // Timeouts (legacy)
  ESCALATION_TIMEOUT_CRITICAL: z.string().default('14400'), // 4 hours
  ESCALATION_TIMEOUT_HIGH: z.string().default('43200'), // 12 hours
  ESCALATION_TIMEOUT_NORMAL: z.string().default('86400'), // 24 hours

  // Decision Tier Timeouts (in ms)
  DECISION_TIMEOUT_MINOR: z.string().default('14400000'), // 4 hours (auto-approve)
  DECISION_TIMEOUT_MAJOR: z.string().default('86400000'), // 24 hours (escalate)
  DECISION_TIMEOUT_CRITICAL: z.string().default('172800000'), // 48 hours (escalate)
});

type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid configuration:');
    console.error(result.error.format());
    throw new Error('Configuration validation failed');
  }

  return result.data;
}

export const config = loadConfig();

// Parsed numeric values
export const numericConfig = {
  port: parseInt(config.PORT, 10),
  defaultLoopInterval: parseInt(config.DEFAULT_LOOP_INTERVAL, 10),
  healthCheckInterval: parseInt(config.HEALTH_CHECK_INTERVAL, 10),
  maxVetoRounds: parseInt(config.MAX_VETO_ROUNDS, 10),
  escalationTimeouts: {
    critical: parseInt(config.ESCALATION_TIMEOUT_CRITICAL, 10),
    high: parseInt(config.ESCALATION_TIMEOUT_HIGH, 10),
    normal: parseInt(config.ESCALATION_TIMEOUT_NORMAL, 10),
  },
  // Decision tier timeouts (in ms)
  decisionTimeouts: {
    minor: parseInt(config.DECISION_TIMEOUT_MINOR, 10),    // 4h auto-approve
    major: parseInt(config.DECISION_TIMEOUT_MAJOR, 10),    // 24h escalate
    critical: parseInt(config.DECISION_TIMEOUT_CRITICAL, 10), // 48h escalate
  },
};

// Dry-Run mode - when true, external actions are logged but not executed
export const isDryRun = config.DRY_RUN === 'true';

// Workspace git settings
export const workspaceConfig = {
  repoUrl: config.WORKSPACE_REPO_URL,
  branch: config.WORKSPACE_BRANCH,
  autoCommit: config.WORKSPACE_AUTO_COMMIT === 'true',
  usePR: config.WORKSPACE_USE_PR === 'true',       // Branch+PR workflow
  autoMerge: config.WORKSPACE_AUTO_MERGE === 'true', // Auto-merge after approval
  // Build authenticated URL if token available
  getAuthenticatedUrl: () => {
    if (!config.GITHUB_TOKEN) return config.WORKSPACE_REPO_URL;
    const url = new URL(config.WORKSPACE_REPO_URL);
    return `https://${config.GITHUB_TOKEN}@${url.host}${url.pathname}`;
  },
  // Get repo owner/name for gh CLI
  getRepoSlug: () => {
    const url = new URL(config.WORKSPACE_REPO_URL);
    return url.pathname.replace(/^\//, '').replace(/\.git$/, '');
  },
};

// Agent configurations
export const agentConfigs = {
  ceo: {
    name: 'CEO Agent',
    loopInterval: 3600, // 1 hour
    tier: 'head' as const,
  },
  dao: {
    name: 'DAO Agent',
    loopInterval: 21600, // 6 hours
    tier: 'head' as const,
  },
  cmo: {
    name: 'CMO Agent',
    loopInterval: 14400, // 4 hours
    tier: 'clevel' as const,
    gitFilter: 'content/*',
  },
  cto: {
    name: 'CTO Agent',
    loopInterval: 3600, // 1 hour
    tier: 'clevel' as const,
    gitFilter: 'website/*',
  },
  cfo: {
    name: 'CFO Agent',
    loopInterval: 21600, // 6 hours
    tier: 'clevel' as const,
    gitFilter: 'treasury/*',
  },
  coo: {
    name: 'COO Agent',
    loopInterval: 7200, // 2 hours
    tier: 'clevel' as const,
    gitFilter: 'community/*',
  },
  cco: {
    name: 'CCO Agent',
    loopInterval: 86400, // 24 hours
    tier: 'clevel' as const,
    gitFilter: 'legal/*',
  },
};
