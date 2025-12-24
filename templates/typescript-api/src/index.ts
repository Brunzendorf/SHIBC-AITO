/**
 * SHIBC TypeScript API Template
 * Fastify-based REST API with PostgreSQL
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { healthRoutes } from './routes/health.js';
import { apiRoutes } from './routes/api.js';

async function main(): Promise<void> {
  const app = Fastify({
    logger: logger,
    trustProxy: true,
  });

  // Security Plugins
  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'SHIBC API',
        description: 'Shiba Classic API',
        version: '1.0.0',
      },
      servers: [{ url: config.apiBaseUrl }],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list' },
  });

  // Routes
  await app.register(healthRoutes, { prefix: '/' });
  await app.register(apiRoutes, { prefix: '/api/v1' });

  // Start Server
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`Server running on port ${config.port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

// Graceful Shutdown
const signals = ['SIGINT', 'SIGTERM'] as const;
signals.forEach((signal) => {
  process.on(signal, () => {
    logger.info(`Received ${signal}, shutting down...`);
    process.exit(0);
  });
});

main();
