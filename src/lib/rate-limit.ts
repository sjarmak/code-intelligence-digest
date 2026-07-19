/**
 * Rate limiting and usage tracking utilities
 * Prevents abuse and runaway costs from LLM API calls
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from './logger';
import { getDbClient } from './db/driver';

/**
 * Vitest runs without a configured Postgres URL for many unit tests.
 * In that environment, persist quotas in-memory so request validation tests
 * don't depend on DB connectivity.
 */
const USE_MEMORY_QUOTA = process.env.VITEST === 'true';
const memoryQuotaUsed = new Map<string, number>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp
  error?: string;
}

export interface UsageQuota {
  endpoint: string;
  window: 'hour' | 'day';
  limit: number;
  used: number;
  resetAt: number;
}

// Rate limit configurations per endpoint
const RATE_LIMITS: Record<string, { hourly: number; daily: number; maxRequestSize?: number }> = {
  '/api/items': {
    hourly: 600, // re-ranks on every call; generous for human browsing, blocks hammering
    daily: 5000,
  },
  '/api/newsletter/generate': {
    hourly: 10, // 10 newsletters per hour
    daily: 50, // 50 newsletters per day
    maxRequestSize: 10000, // Max items to process
  },
  '/api/podcast/generate': {
    hourly: 5, // 5 podcasts per hour (expensive)
    daily: 20, // 20 podcasts per day
    maxRequestSize: 10000,
  },
  '/api/podcast/render-audio': {
    hourly: 20, // 20 audio renders per hour
    daily: 100, // 100 audio renders per day
    maxRequestSize: 100000, // Max transcript length
  },
  '/api/ask': {
    hourly: 100, // 100 questions per hour (cheap)
    daily: 1000, // 1000 questions per day
  },
  '/api/papers/ask': {
    hourly: 50, // 50 paper questions per hour
    daily: 500, // 500 per day
  },
  '/api/search': {
    hourly: 500, // 500 searches per hour (very cheap)
    daily: 10000, // 10000 searches per day
  },
};

/**
 * Shared quota bucket for requests whose client IP cannot be attributed to a
 * trusted proxy hop. These requests contend for one bucket instead of each
 * minting a private one, so an unattributable flood exhausts a single quota.
 */
export const UNATTRIBUTED_CLIENT_IP = 'unattributed';

/**
 * Number of proxies between this app and the client that we trust to have
 * appended to X-Forwarded-For. On Render the platform load balancer is the
 * only such hop, so the default is 1. Set to 0 when the app is exposed
 * directly and no forwarding header should be believed.
 *
 * A blank value means "unset", not 0: `??` does not catch the empty string
 * that an env UI writes for a cleared field, and Number('') is a valid 0 that
 * would silently funnel every client into the shared bucket.
 *
 * Exported for tests; callers should use getClientIP.
 */
export function trustedProxyHops(): number {
  const configured = process.env.TRUSTED_PROXY_HOPS?.trim();
  return configured ? Number(configured) : 1;
}

/**
 * Structural check that a hop is an IP literal, so a bucket key is never built
 * out of free-form text. Deliberately loose about IPv6 shape: the value comes
 * from a trusted hop, and the key is opaque, so rejecting non-IP junk is the
 * whole requirement.
 */
function isIPLiteral(value: string): boolean {
  if (value.includes(':')) {
    return /^[0-9a-fA-F:.]+$/.test(value) && (value.match(/:/g)?.length ?? 0) >= 2;
  }
  const octets = value.split('.');
  return (
    octets.length === 4 &&
    octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)
  );
}

/**
 * Strip the port a proxy may append: `1.2.3.4:41234` or `[2001:db8::1]:41234`.
 */
function stripPort(hop: string): string {
  const bracketed = hop.match(/^\[(.+)\](?::\d+)?$/);
  if (bracketed) {
    return bracketed[1];
  }
  // A bare IPv6 literal has many colons; only a single trailing one is a port.
  const parts = hop.split(':');
  return parts.length === 2 ? parts[0] : hop;
}

/**
 * Resolve the client IP a quota bucket is keyed on.
 *
 * X-Forwarded-For is client-supplied up to the point a trusted proxy appends
 * to it, so only the hop `trustedHops` from the right can be believed. Taking
 * index 0 instead let a client mint a fresh bucket per request by rotating its
 * own prefix, bypassing the caps entirely. Anything we cannot attribute falls
 * back to the shared conservative bucket.
 *
 * Exported for tests; callers should use the request-scoped helpers below.
 */
export function resolveClientIP(request: NextRequest, trustedHops: number): string {
  const hops = Number.isInteger(trustedHops) && trustedHops >= 0 ? trustedHops : 1;
  if (hops === 0) {
    return UNATTRIBUTED_CLIENT_IP;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (!forwarded) {
    return UNATTRIBUTED_CLIENT_IP;
  }

  const chain = forwarded
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  if (chain.length < hops) {
    return UNATTRIBUTED_CLIENT_IP;
  }

  const candidate = stripPort(chain[chain.length - hops]);
  return isIPLiteral(candidate) ? candidate : UNATTRIBUTED_CLIENT_IP;
}

/**
 * Get client IP address from request
 */
function getClientIP(request: NextRequest): string {
  return resolveClientIP(request, trustedProxyHops());
}

/**
 * Get or create usage record for endpoint + IP + time window
 */
async function getUsageRecord(
  endpoint: string,
  clientIP: string,
  window: 'hour' | 'day'
): Promise<UsageQuota> {
  const now = Math.floor(Date.now() / 1000);

  // Calculate window start time
  const windowMs = window === 'hour' ? 3600 * 1000 : 24 * 3600 * 1000;
  const windowStart = Math.floor((Date.now() / windowMs)) * windowMs;
  const resetAt = Math.floor((windowStart + windowMs) / 1000);

  const key = `${endpoint}:${clientIP}:${window}:${windowStart}`;

  const limit = RATE_LIMITS[endpoint]?.[window === 'hour' ? 'hourly' : 'daily'] || 100;

  if (USE_MEMORY_QUOTA) {
    return {
      endpoint,
      window,
      limit,
      used: memoryQuotaUsed.get(key) ?? 0,
      resetAt,
    };
  }

  const client = await getDbClient();
  const result = await client.query(
    `SELECT used FROM usage_quota WHERE key = $1`,
    [key]
  );

  if (result.rows.length > 0) {
    return {
      endpoint,
      window,
      limit,
      used: result.rows[0].used as number,
      resetAt,
    };
  }

  // Initialize new record
  await client.run(
    `INSERT INTO usage_quota (key, endpoint, client_ip, window_type, used, reset_at, created_at)
     VALUES ($1, $2, $3, $4, 0, $5, $6)
     ON CONFLICT (key) DO NOTHING`,
    [key, endpoint, clientIP, window, resetAt, now]
  );

  return {
    endpoint,
    window,
    limit,
    used: 0,
    resetAt,
  };
}

/**
 * Increment usage count for endpoint + IP + window
 */
async function incrementUsage(
  endpoint: string,
  clientIP: string,
  window: 'hour' | 'day'
): Promise<UsageQuota> {
  const now = Math.floor(Date.now() / 1000);

  const windowMs = window === 'hour' ? 3600 * 1000 : 24 * 3600 * 1000;
  const windowStart = Math.floor((Date.now() / windowMs)) * windowMs;
  const resetAt = Math.floor((windowStart + windowMs) / 1000);

  const key = `${endpoint}:${clientIP}:${window}:${windowStart}`;

  if (USE_MEMORY_QUOTA) {
    const prev = memoryQuotaUsed.get(key) ?? 0;
    memoryQuotaUsed.set(key, prev + 1);
    const quota = await getUsageRecord(endpoint, clientIP, window);
    return { ...quota, used: quota.used };
  }

  const client = await getDbClient();
  await client.run(
    `INSERT INTO usage_quota (key, endpoint, client_ip, window_type, used, reset_at, created_at)
     VALUES ($1, $2, $3, $4, 1, $5, $6)
     ON CONFLICT (key) DO UPDATE SET used = usage_quota.used + 1`,
    [key, endpoint, clientIP, window, resetAt, now]
  );

  return getUsageRecord(endpoint, clientIP, window);
}

/**
 * Check rate limit for an endpoint
 * Returns whether request is allowed and remaining quota
 */
export async function checkRateLimit(
  request: NextRequest,
  endpoint: string
): Promise<RateLimitResult> {
  const clientIP = getClientIP(request);
  const limits = RATE_LIMITS[endpoint];

  if (!limits) {
    // No limits configured for this endpoint
    return {
      allowed: true,
      remaining: Infinity,
      resetAt: Math.floor(Date.now() / 1000) + 3600,
    };
  }

  // Check both hourly and daily limits
  const [hourlyQuota, dailyQuota] = await Promise.all([
    getUsageRecord(endpoint, clientIP, 'hour'),
    getUsageRecord(endpoint, clientIP, 'day'),
  ]);

  // Check if either limit is exceeded
  if (hourlyQuota.used >= hourlyQuota.limit) {
    logger.warn(`Rate limit exceeded: ${endpoint} hourly limit (${hourlyQuota.used}/${hourlyQuota.limit})`, {
      endpoint,
      clientIP,
      window: 'hour',
    });
    return {
      allowed: false,
      remaining: 0,
      resetAt: hourlyQuota.resetAt,
      error: `Hourly limit exceeded. You've used ${hourlyQuota.used}/${hourlyQuota.limit} requests. Try again after ${new Date(hourlyQuota.resetAt * 1000).toLocaleTimeString()}.`,
    };
  }

  if (dailyQuota.used >= dailyQuota.limit) {
    logger.warn(`Rate limit exceeded: ${endpoint} daily limit (${dailyQuota.used}/${dailyQuota.limit})`, {
      endpoint,
      clientIP,
      window: 'day',
    });
    return {
      allowed: false,
      remaining: 0,
      resetAt: dailyQuota.resetAt,
      error: `Daily limit exceeded. You've used ${dailyQuota.used}/${dailyQuota.limit} requests. Resets at ${new Date(dailyQuota.resetAt * 1000).toLocaleString()}.`,
    };
  }

  return {
    allowed: true,
    remaining: Math.min(hourlyQuota.limit - hourlyQuota.used, dailyQuota.limit - dailyQuota.used),
    resetAt: Math.min(hourlyQuota.resetAt, dailyQuota.resetAt),
  };
}

/**
 * Record usage after successful request
 */
export async function recordUsage(
  request: NextRequest,
  endpoint: string
): Promise<void> {
  const clientIP = getClientIP(request);
  await Promise.all([
    incrementUsage(endpoint, clientIP, 'hour'),
    incrementUsage(endpoint, clientIP, 'day'),
  ]);
}

/**
 * Check request size limits
 */
export function checkRequestSize(
  endpoint: string,
  requestSize: number
): { allowed: boolean; error?: string } {
  const limits = RATE_LIMITS[endpoint];

  if (!limits?.maxRequestSize) {
    return { allowed: true };
  }

  if (requestSize > limits.maxRequestSize) {
    return {
      allowed: false,
      error: `Request size too large. Maximum allowed: ${limits.maxRequestSize}, received: ${requestSize}`,
    };
  }

  return { allowed: true };
}

/**
 * Middleware helper to enforce rate limits
 * Returns NextResponse with 429 if rate limited, null if allowed
 */
export async function enforceRateLimit(
  request: NextRequest,
  endpoint: string
): Promise<NextResponse | null> {
  const result = await checkRateLimit(request, endpoint);

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.error || 'Rate limit exceeded',
        limitExceeded: true,
        resetAt: result.resetAt,
        resetAtFormatted: new Date(result.resetAt * 1000).toISOString(),
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': RATE_LIMITS[endpoint]?.daily.toString() || '100',
          'X-RateLimit-Remaining': result.remaining.toString(),
          'X-RateLimit-Reset': result.resetAt.toString(),
          'Retry-After': Math.ceil(result.resetAt - Date.now() / 1000).toString(),
        },
      }
    );
  }

  return null;
}

