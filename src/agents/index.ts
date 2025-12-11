/**
 * Agent Entry Point
 * Starts the agent daemon with signal handling
 */

import { createLogger } from '../lib/logger.js';
import { AgentDaemon, createDaemonConfigFromEnv } from './daemon.js';
import express from 'express';

const logger = createLogger('agent');

// Banner
const banner = `
╔════════════════════════════════════════════════════════════╗
║                    AITO AGENT                               ║
║                                                              ║
║  Type:      {{TYPE}}
║  ID:        {{ID}}
║  Profile:   {{PROFILE}}
║                                                              ║
╚════════════════════════════════════════════════════════════╝
`;

async function main(): Promise<void> {
  // Load config from environment
  const config = createDaemonConfigFromEnv();

  logger.info({ agentType: config.agentType }, 'Initializing agent');

  // Create daemon
  const daemon = new AgentDaemon(config);

  // Setup signal handlers
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');
    await daemon.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start health check server
  const healthPort = parseInt(process.env.HEALTH_PORT || '3001', 10);
  const app = express();

  app.get('/health', async (req, res) => {
    try {
      const status = await daemon.getHealthStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ healthy: false, error: 'Health check failed' });
    }
  });

  app.get('/ready', async (req, res) => {
    try {
      const status = await daemon.getHealthStatus();
      if (status.healthy) {
        res.json({ ready: true });
      } else {
        res.status(503).json({ ready: false });
      }
    } catch (error) {
      res.status(503).json({ ready: false });
    }
  });

  app.listen(healthPort, () => {
    logger.info({ port: healthPort }, 'Health check server started');
  });

  // Start the daemon
  try {
    await daemon.start();

    // Print banner
    const displayBanner = banner
      .replace('{{TYPE}}', config.agentType.toUpperCase().padEnd(44))
      .replace('{{ID}}', config.agentId.substring(0, 36).padEnd(46))
      .replace('{{PROFILE}}', config.profilePath.padEnd(43));

    console.log(displayBanner);

    logger.info({
      agentType: config.agentType,
      agentId: config.agentId,
      loopInterval: config.loopInterval,
      loopEnabled: config.loopEnabled,
    }, 'Agent running');

  } catch (error) {
    logger.error({ error }, 'Failed to start agent');
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  logger.error({ error }, 'Unhandled error');
  process.exit(1);
});
