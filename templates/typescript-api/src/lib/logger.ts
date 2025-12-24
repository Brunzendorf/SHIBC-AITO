/**
 * Pino Logger Configuration
 * Structured JSON logging with sensitive data redaction
 */

import pino from 'pino';

const sensitiveKeys = ['password', 'token', 'secret', 'authorization', 'apiKey', 'api_key'];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: sensitiveKeys.flatMap((key) => [`*.${key}`, `*.*.${key}`, `${key}`]),
    censor: '[REDACTED]',
  },
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});
