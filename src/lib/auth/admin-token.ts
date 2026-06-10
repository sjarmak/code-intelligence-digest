/**
 * Admin API token validation
 *
 * Validates `Authorization: Bearer <ADMIN_API_TOKEN>` on admin endpoints so
 * external callers (cron services, curl) can hit them without a browser
 * session. Edge-runtime safe (no Node-only imports) — also used by middleware.
 */

import { NextResponse } from 'next/server';
import { isProduction } from './guards';

/** Constant-time string comparison (no early exit on first mismatch). */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * True iff ADMIN_API_TOKEN is configured and the header is exactly
 * `Bearer <token>`. An unset token never validates (fail closed).
 */
export function isValidAdminToken(authHeader: string | null | undefined): boolean {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected || !authHeader) return false;
  if (!authHeader.startsWith('Bearer ')) return false;
  return timingSafeEquals(authHeader.slice('Bearer '.length), expected);
}

/**
 * Route-level guard for admin endpoints that must stay callable in production.
 *
 * Production: requires a valid bearer token; 401 otherwise (including when
 * ADMIN_API_TOKEN is unset — fail closed).
 * Non-production: requests without an Authorization header are allowed for
 * dev convenience, but explicitly wrong credentials are still rejected.
 */
export function requireAdminToken(request: Request): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  if (isValidAdminToken(authHeader)) return null;

  if (!isProduction() && !authHeader) return null;

  return NextResponse.json(
    { error: 'Unauthorized', message: 'Valid admin API token required' },
    { status: 401 }
  );
}
