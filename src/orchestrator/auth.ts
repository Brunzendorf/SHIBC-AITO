import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('auth');

// Supabase JWT secret from project settings
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string; // User ID
    email?: string;
    role?: string;
    aal?: string; // Authenticator Assurance Level
  };
}

/**
 * Middleware to validate Supabase JWT tokens
 * Extracts user info and attaches to request
 */
export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Skip auth for health endpoints
  if (req.path === '/health' || req.path === '/ready') {
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'Missing or invalid Authorization header',
      timestamp: new Date(),
    });
    return;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  if (!SUPABASE_JWT_SECRET) {
    logger.error('SUPABASE_JWT_SECRET not configured');
    res.status(500).json({
      success: false,
      error: 'Server authentication not configured',
      timestamp: new Date(),
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET) as jwt.JwtPayload;

    // Attach user info to request
    req.user = {
      sub: decoded.sub || '',
      email: decoded.email,
      role: decoded.role,
      aal: decoded.aal,
    };

    logger.debug({ userId: req.user.sub, email: req.user.email }, 'Request authenticated');
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: 'Token expired',
        timestamp: new Date(),
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: 'Invalid token',
        timestamp: new Date(),
      });
      return;
    }

    logger.error({ error }, 'JWT verification failed');
    res.status(401).json({
      success: false,
      error: 'Authentication failed',
      timestamp: new Date(),
    });
  }
}

/**
 * Optional: Require 2FA (AAL2) for sensitive operations
 */
export function require2FA(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: 'Not authenticated',
      timestamp: new Date(),
    });
    return;
  }

  if (req.user.aal !== 'aal2') {
    res.status(403).json({
      success: false,
      error: 'Two-factor authentication required',
      timestamp: new Date(),
    });
    return;
  }

  next();
}
