/**
 * Tests for Authentication Middleware
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth.js';

// Mock jwt
vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    TokenExpiredError: class TokenExpiredError extends Error {
      name = 'TokenExpiredError';
    },
    JsonWebTokenError: class JsonWebTokenError extends Error {
      name = 'JsonWebTokenError';
    },
  },
}));

// Mock logger
vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Auth Middleware', () => {
  let authMiddleware: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
  let require2FA: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Save and set JWT secret
    originalEnv = process.env.SUPABASE_JWT_SECRET;
    process.env.SUPABASE_JWT_SECRET = 'test-secret';

    // Import fresh module
    const authModule = await import('./auth.js');
    authMiddleware = authModule.authMiddleware;
    require2FA = authModule.require2FA;

    // Setup mock request
    mockReq = {
      path: '/api/test',
      headers: {},
    };

    // Setup mock response
    mockRes = {
      status: vi.fn().mockReturnThis() as any,
      json: vi.fn().mockReturnThis() as any,
    };

    // Setup mock next
    mockNext = vi.fn();
  });

  afterEach(() => {
    // Restore env
    if (originalEnv) {
      process.env.SUPABASE_JWT_SECRET = originalEnv;
    } else {
      delete process.env.SUPABASE_JWT_SECRET;
    }
  });

  describe('authMiddleware', () => {
    it('should skip auth for /health endpoint', () => {
      mockReq.path = '/health';

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should skip auth for /ready endpoint', () => {
      mockReq.path = '/ready';

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject request without Authorization header', () => {
      mockReq.headers = {};

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Missing or invalid Authorization header',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with non-Bearer authorization', () => {
      mockReq.headers = { authorization: 'Basic dXNlcjpwYXNz' };

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should authenticate valid JWT token', () => {
      mockReq.headers = { authorization: 'Bearer valid-token' };
      vi.mocked(jwt.verify).mockReturnValue({
        sub: 'user-123',
        email: 'test@example.com',
        role: 'admin',
        aal: 'aal1',
      } as any);

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
      expect(mockReq.user).toEqual({
        sub: 'user-123',
        email: 'test@example.com',
        role: 'admin',
        aal: 'aal1',
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle missing sub in token', () => {
      mockReq.headers = { authorization: 'Bearer valid-token' };
      vi.mocked(jwt.verify).mockReturnValue({
        email: 'test@example.com',
      } as any);

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockReq.user?.sub).toBe('');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject expired token', () => {
      mockReq.headers = { authorization: 'Bearer expired-token' };
      const expiredError = new jwt.TokenExpiredError('jwt expired', new Date());
      vi.mocked(jwt.verify).mockImplementation(() => {
        throw expiredError;
      });

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Token expired',
        })
      );
    });

    it('should reject invalid token', () => {
      mockReq.headers = { authorization: 'Bearer invalid-token' };
      const invalidError = new jwt.JsonWebTokenError('invalid signature');
      vi.mocked(jwt.verify).mockImplementation(() => {
        throw invalidError;
      });

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Invalid token',
        })
      );
    });

    it('should handle unexpected errors', () => {
      mockReq.headers = { authorization: 'Bearer some-token' };
      vi.mocked(jwt.verify).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Authentication failed',
        })
      );
    });
  });

  describe('authMiddleware without JWT secret', () => {
    it('should return 500 when SUPABASE_JWT_SECRET not configured', async () => {
      // Reset modules and remove secret
      vi.resetModules();
      delete process.env.SUPABASE_JWT_SECRET;

      const authModule = await import('./auth.js');
      const middleware = authModule.authMiddleware;

      const req = {
        path: '/api/test',
        headers: { authorization: 'Bearer token' },
      } as AuthenticatedRequest;

      middleware(req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Server authentication not configured',
        })
      );
    });
  });

  describe('require2FA', () => {
    it('should reject unauthenticated request', () => {
      mockReq.user = undefined;

      require2FA(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Not authenticated',
        })
      );
    });

    it('should reject request without 2FA (aal1)', () => {
      mockReq.user = {
        sub: 'user-123',
        email: 'test@example.com',
        aal: 'aal1',
      };

      require2FA(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Two-factor authentication required',
        })
      );
    });

    it('should allow request with 2FA (aal2)', () => {
      mockReq.user = {
        sub: 'user-123',
        email: 'test@example.com',
        aal: 'aal2',
      };

      require2FA(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });
});
