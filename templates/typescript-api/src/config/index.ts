/**
 * Application Configuration
 * All config values loaded from environment variables
 */

import { z } from 'zod';

const ConfigSchema = z.object({
  // Server
  port: z.coerce.number().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  apiBaseUrl: z.string().url().default('http://localhost:3000'),

  // Database
  databaseUrl: z.string().url(),

  // CORS
  corsOrigins: z
    .string()
    .transform((val) => val.split(',').map((s) => s.trim()))
    .default('http://localhost:3000'),

  // Logging
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const result = ConfigSchema.safeParse({
    port: process.env.PORT,
    nodeEnv: process.env.NODE_ENV,
    apiBaseUrl: process.env.API_BASE_URL,
    databaseUrl: process.env.DATABASE_URL,
    corsOrigins: process.env.CORS_ORIGINS,
    logLevel: process.env.LOG_LEVEL,
  });

  if (!result.success) {
    console.error('Invalid configuration:', result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
