/**
 * Production guard utilities
 *
 * Helpers to restrict access to certain routes/features in production.
 */

import { NextResponse } from 'next/server';

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Block a route in production with 403 Forbidden
 */
export function blockInProduction(): NextResponse | null {
  if (isProduction()) {
    return NextResponse.json(
      { error: 'This endpoint is disabled in production' },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Require ADMIN_API_TOKEN for protected routes
 * Returns error response if unauthorized, null if authorized
 */
export function requireAdminToken(authHeader: string | null): NextResponse | null {
  const adminToken = process.env.ADMIN_API_TOKEN;

  // In production, token is required
  if (isProduction() && !adminToken) {
    return NextResponse.json(
      { error: 'ADMIN_API_TOKEN not configured' },
      { status: 500 }
    );
  }

  // If token is set, validate it
  if (adminToken && authHeader !== `Bearer ${adminToken}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return null;
}

/**
 * Check if admin UI should be enabled
 * Controlled by ENABLE_ADMIN_UI env var (default: true in dev, false in prod)
 */
export function isAdminUIEnabled(): boolean {
  const envValue = process.env.ENABLE_ADMIN_UI;
  if (envValue !== undefined) {
    return envValue === 'true' || envValue === '1';
  }
  // Default: enabled in dev, disabled in prod
  return !isProduction();
}
