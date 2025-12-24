/**
 * Bot Configuration
 */

import { z } from 'zod';

const ConfigSchema = z.object({
  botToken: z.string().min(1),
  redisUrl: z.string().url().optional(),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const result = ConfigSchema.safeParse({
    botToken: process.env.BOT_TOKEN,
    redisUrl: process.env.REDIS_URL,
    logLevel: process.env.LOG_LEVEL,
    nodeEnv: process.env.NODE_ENV,
  });

  if (!result.success) {
    console.error('Invalid configuration:', result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
