import { createLogger } from '../lib/logger.js';
import { closePool } from '../lib/db.js';
import { closeConnections } from '../lib/redis.js';
import { initialize as initializeContainer, ensureAllAgentsRunning } from './container.js';
import { initialize as initializeScheduler, stopAllJobs } from './scheduler.js';
import { initialize as initializeEvents } from './events.js';
import { initialize as initializeRAG } from '../lib/rag.js';
import { startServer } from './api.js';
import { numericConfig } from '../lib/config.js';

const logger = createLogger('orchestrator');

async function main(): Promise<void> {
  logger.info('Starting AITO Orchestrator...');
  logger.info({
    port: numericConfig.port,
    healthCheckInterval: numericConfig.healthCheckInterval,
    maxVetoRounds: numericConfig.maxVetoRounds,
  }, 'Configuration loaded');

  try {
    // Initialize components in order
    logger.info('Initializing container manager...');
    await initializeContainer();

    logger.info('Initializing event system...');
    await initializeEvents();

    logger.info('Initializing scheduler...');
    await initializeScheduler();

    // Initialize RAG (creates Qdrant collection if needed)
    logger.info('Initializing RAG system...');
    await initializeRAG();

    // Start API server
    logger.info('Starting API server...');
    startServer();

    // Ensure all agents are running (start stopped containers)
    logger.info('Starting agent containers...');
    await ensureAllAgentsRunning();

    logger.info('AITO Orchestrator started successfully!');
    logger.info(`
╔════════════════════════════════════════════════════════════╗
║                    AITO ORCHESTRATOR                        ║
║                                                              ║
║  Status:    RUNNING                                         ║
║  API:       http://localhost:${numericConfig.port}                          ║
║  Health:    http://localhost:${numericConfig.port}/health                   ║
║  Metrics:   http://localhost:${numericConfig.port}/metrics                  ║
║                                                              ║
║  Ready to manage AI Agents!                                 ║
╚════════════════════════════════════════════════════════════╝
`);
  } catch (err) {
    logger.error({ err }, 'Failed to start orchestrator');
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal');

  try {
    // Stop scheduler
    logger.info('Stopping scheduler...');
    stopAllJobs();

    // NOTE: We intentionally do NOT stop agent containers on shutdown.
    // Agents are autonomous and should keep running even when orchestrator restarts.
    // They will be monitored and restarted by health checks if needed.
    logger.info('Orchestrator shutting down (agents remain running)...');

    // Close connections
    logger.info('Closing database connection...');
    await closePool();

    logger.info('Closing Redis connections...');
    await closeConnections();

    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
  shutdown('unhandledRejection');
});

// Start the orchestrator
main();
