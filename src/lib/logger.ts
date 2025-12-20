import pino from 'pino';
import { config } from './config.js';
import { getTraceInfo } from './tracing.js';

/**
 * TASK-035: Sanitize sensitive data from log output
 * Redacts values for keys containing sensitive patterns
 */
const SENSITIVE_PATTERNS = [
  'token',
  'password',
  'secret',
  'key',
  'auth',
  'credential',
  'bearer',
  'api_key',
  'apikey',
  'private',
  'jwt',
];

const REDACTED = '***REDACTED***';

/**
 * Deep sanitize an object, redacting sensitive values
 */
function sanitizeObject(obj: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) return '[MAX_DEPTH]';

  if (obj === null || obj === undefined) return obj;

  // Handle primitives
  if (typeof obj !== 'object') return obj;

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1));
  }

  // Handle Error objects specially - preserve message but sanitize stack
  if (obj instanceof Error) {
    const sanitizedError: Record<string, unknown> = {
      name: obj.name,
      message: sanitizeString(obj.message),
    };
    if (obj.stack) {
      sanitizedError.stack = sanitizeString(obj.stack);
    }
    return sanitizedError;
  }

  // Handle plain objects
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const keyLower = key.toLowerCase();
    const isSensitive = SENSITIVE_PATTERNS.some((pattern) =>
      keyLower.includes(pattern)
    );

    if (isSensitive && value !== null && value !== undefined) {
      result[key] = REDACTED;
    } else if (typeof value === 'string') {
      result[key] = sanitizeString(value);
    } else {
      result[key] = sanitizeObject(value, depth + 1);
    }
  }
  return result;
}

/**
 * Sanitize a string value by masking token patterns
 */
function sanitizeString(str: string): string {
  // GitHub tokens
  let result = str.replace(/ghp_[A-Za-z0-9_]{36,}/g, 'ghp_***REDACTED***');
  result = result.replace(/gho_[A-Za-z0-9_]{36,}/g, 'gho_***REDACTED***');
  result = result.replace(/github_pat_[A-Za-z0-9_]{22,}/g, 'github_pat_***REDACTED***');

  // Bearer tokens
  result = result.replace(/Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, 'Bearer ***REDACTED***');

  // Generic API keys (long alphanumeric strings after common prefixes)
  result = result.replace(/sk-[A-Za-z0-9]{32,}/g, 'sk-***REDACTED***'); // OpenAI
  result = result.replace(/xox[aboprs]-[A-Za-z0-9\-]+/g, 'xox*-***REDACTED***'); // Slack

  return result;
}

// Base pino logger with sanitization
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
  // TASK-035: Custom serializers to sanitize sensitive data
  serializers: {
    err: (err: Error) => sanitizeObject(err) as pino.SerializedError,
    error: (err: unknown) => sanitizeObject(err),
    // Catch-all for common log properties
    req: (req: unknown) => sanitizeObject(req),
    res: (res: unknown) => sanitizeObject(res),
  },
  // Built-in redact for known paths (additional safety layer)
  redact: {
    paths: [
      'headers.authorization',
      'headers.cookie',
      'body.password',
      'body.token',
      'body.secret',
      'config.GITHUB_TOKEN',
      'config.TELEGRAM_BOT_TOKEN',
      'config.SENDGRID_API_KEY',
    ],
    censor: REDACTED,
  },
});

// Export for compatibility
export const logger = baseLogger;

// Create child logger for specific components (TASK-033: includes automatic trace propagation)
export function createLogger(component: string) {
  return baseLogger.child({ component });
}
