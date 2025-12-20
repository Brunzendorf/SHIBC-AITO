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

  // LLM Routing (Claude + Gemini)
  LLM_ROUTING_STRATEGY: z.enum(['task-type', 'agent-role', 'load-balance', 'gemini-prefer', 'claude-only']).default('task-type'),
  LLM_ENABLE_FALLBACK: z.string().default('true'),
  LLM_PREFER_GEMINI: z.string().default('false'), // Cost optimization
  GEMINI_DEFAULT_MODEL: z.string().default('gemini-2.0-flash-exp'),

  // LLM Quota Limits (optional - for monitoring only)
  CLAUDE_MONTHLY_QUOTA: z.string().optional(), // Estimated tokens per month
  GEMINI_MONTHLY_QUOTA: z.string().optional(), // Estimated tokens per month

  // RAG / Vector DB
  QDRANT_URL: z.string().default('http://localhost:6333'),

  // Communication
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),

  // GitHub
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_ORG: z.string().default('Brunzendorf'),

  // Workspace Git Repository (separate repo for agent outputs)
  WORKSPACE_REPO_URL: z.string().default('https://github.com/Brunzendorf/shibc-workspace.git'),
  WORKSPACE_BRANCH: z.string().default('main'),  // shibc-workspace uses 'main'
  WORKSPACE_AUTO_COMMIT: z.string().default('true'),  // Auto-commit on file changes
  WORKSPACE_USE_PR: z.string().default('true'),       // Use branch+PR workflow (quality gate)
  WORKSPACE_AUTO_MERGE: z.string().default('false'),  // Auto-merge PRs after RAG approval
  WORKSPACE_SKIP_PR: z.string().default('false'),     // Bypass PR workflow - direct push (saves tokens)

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
  skipPR: config.WORKSPACE_SKIP_PR === 'true',     // Bypass PR workflow - direct push
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
// Loop intervals adjusted for balanced activity without excessive API calls
// Critical agents (CEO, CTO, COO) run more frequently for oversight
export const agentConfigs = {
  ceo: {
    name: 'CEO Agent',
    loopInterval: 1800, // 30 min - frequent oversight
    tier: 'head' as const,
  },
  dao: {
    name: 'DAO Agent',
    loopInterval: 14400, // 4 hours - governance doesn't need constant polling
    tier: 'head' as const,
  },
  cmo: {
    name: 'CMO Agent',
    loopInterval: 7200, // 2 hours - marketing needs reactivity
    tier: 'clevel' as const,
    gitFilter: 'content/*',
  },
  cto: {
    name: 'CTO Agent',
    loopInterval: 3600, // 1 hour - tech oversight
    tier: 'clevel' as const,
    gitFilter: 'website/*',
  },
  cfo: {
    name: 'CFO Agent',
    loopInterval: 14400, // 4 hours - treasury monitoring
    tier: 'clevel' as const,
    gitFilter: 'treasury/*',
  },
  coo: {
    name: 'COO Agent',
    loopInterval: 3600, // 1 hour - operations need quick response
    tier: 'clevel' as const,
    gitFilter: 'community/*',
  },
  cco: {
    name: 'CCO Agent',
    loopInterval: 43200, // 12 hours - compliance less time-critical
    tier: 'clevel' as const,
    gitFilter: 'legal/*',
  },
};

// LLM Router configuration
export const llmConfig = {
  strategy: config.LLM_ROUTING_STRATEGY,
  enableFallback: config.LLM_ENABLE_FALLBACK === 'true',
  preferGemini: config.LLM_PREFER_GEMINI === 'true',
  geminiDefaultModel: config.GEMINI_DEFAULT_MODEL,
};
