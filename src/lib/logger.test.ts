import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pino before importing logger
vi.mock('pino', () => {
  const mockChild = vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }));

  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: mockChild,
  };

  return {
    default: vi.fn(() => mockLogger),
  };
});

describe('Logger', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('logger', () => {
    it('should create a logger instance', async () => {
      const { logger } = await import('./logger.js');
      expect(logger).toBeDefined();
    });

    it('should have info method', async () => {
      const { logger } = await import('./logger.js');
      expect(typeof logger.info).toBe('function');
    });

    it('should have error method', async () => {
      const { logger } = await import('./logger.js');
      expect(typeof logger.error).toBe('function');
    });

    it('should have warn method', async () => {
      const { logger } = await import('./logger.js');
      expect(typeof logger.warn).toBe('function');
    });

    it('should have debug method', async () => {
      const { logger } = await import('./logger.js');
      expect(typeof logger.debug).toBe('function');
    });

    it('should have child method', async () => {
      const { logger } = await import('./logger.js');
      expect(typeof logger.child).toBe('function');
    });
  });

  describe('createLogger', () => {
    it('should create a child logger with component name', async () => {
      const { createLogger } = await import('./logger.js');
      const childLogger = createLogger('test-component');
      expect(childLogger).toBeDefined();
    });

    it('should have all log methods on child logger', async () => {
      const { createLogger } = await import('./logger.js');
      const childLogger = createLogger('api');

      expect(typeof childLogger.info).toBe('function');
      expect(typeof childLogger.error).toBe('function');
      expect(typeof childLogger.warn).toBe('function');
      expect(typeof childLogger.debug).toBe('function');
    });

    it('should create different loggers for different components', async () => {
      const { createLogger } = await import('./logger.js');
      const apiLogger = createLogger('api');
      const dbLogger = createLogger('db');

      expect(apiLogger).toBeDefined();
      expect(dbLogger).toBeDefined();
    });
  });
});
