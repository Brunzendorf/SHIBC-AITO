import pino from 'pino';
import { config } from './config.js';
import { getTraceInfo } from './tracing.js';

// Base pino logger
const baseLogger = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    config.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    service: 'aito-orchestrator',
  },
  // Mixin adds trace info to every log entry (TASK-033)
  mixin() {
    return getTraceInfo();
  },
});

// Export for compatibility
export const logger = baseLogger;

// Create child logger for specific components (TASK-033: includes automatic trace propagation)
export function createLogger(component: string) {
  return baseLogger.child({ component });
}
