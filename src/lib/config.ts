import { z } from 'zod';

const configSchema = z.object({
  // Server
  PORT: z.string().default('8080'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  POSTGRES_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Portainer API (replaces Docker socket)
  PORTAINER_URL: z.string().optional(),
  PORTAINER_API_KEY: z.string().optional(),
  PORTAINER_ENV_ID: z.string().optional(),

  // Docker (deprecated)
  DOCKER_SOCKET: z.string().default('/var/run/docker.sock'),

  // AI (Ollama for local, Claude Code CLI for complex - NO API!)
  OLLAMA_URL: z.string().default('http://localhost:11434'),

  // Communication
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),

  // GitHub
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_ORG: z.string().default('og-shibaclassic'),

  // Agent Defaults
  DEFAULT_LOOP_INTERVAL: z.string().default('3600'), // 1 hour
  HEALTH_CHECK_INTERVAL: z.string().default('30'), // 30 seconds
  MAX_VETO_ROUNDS: z.string().default('3'),

  // Timeouts
  ESCALATION_TIMEOUT_CRITICAL: z.string().default('14400'), // 4 hours
  ESCALATION_TIMEOUT_HIGH: z.string().default('43200'), // 12 hours
  ESCALATION_TIMEOUT_NORMAL: z.string().default('86400'), // 24 hours
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
