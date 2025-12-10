import { vi, beforeAll, afterAll, afterEach } from 'vitest';

// Mock environment variables
process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.DOCKER_SOCKET = '/var/run/docker.sock';
process.env.NODE_ENV = 'test';
process.env.PORT = '8080';
process.env.OLLAMA_URL = 'http://localhost:11434';
process.env.GITHUB_ORG = 'test-org';

// Mock pino logger to prevent console output during tests
vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    })),
  }),
}));

// Reset mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});
