/**
 * Health Check Routes
 * Used by Kubernetes probes and load balancers
 */

import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness probe - is the process running?
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Readiness probe - is the app ready to receive traffic?
  app.get('/ready', async () => {
    // Add database connectivity check here
    const checks = {
      database: true, // TODO: Implement actual DB check
    };

    const allHealthy = Object.values(checks).every(Boolean);

    return {
      status: allHealthy ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  });
}
