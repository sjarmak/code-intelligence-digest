/**
 * Rate limiting and usage tracking utilities
 * Prevents abuse and runaway costs from LLM API calls
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from './logger';
import { getSqlite } from './db/index';
import { detectDriver, getDbClient } from './db/driver';

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
 * Get client IP address from request
 */
function getClientIP(request: NextRequest): string {
  // Check various headers for IP
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  // Fallback to connection remote address (may not work in all environments)
  return 'unknown';
}

/**
 * Get or create usage record for endpoint + IP + time window
 */
async function getUsageRecord(
  endpoint: string,
  clientIP: string,
  window: 'hour' | 'day'
): Promise<UsageQuota> {
  const driver = detectDriver();
  const now = Math.floor(Date.now() / 1000);

  // Calculate window start time
  const windowMs = window === 'hour' ? 3600 * 1000 : 24 * 3600 * 1000;
  const windowStart = Math.floor((Date.now() / windowMs)) * windowMs;
  const resetAt = Math.floor((windowStart + windowMs) / 1000);

  const key = `${endpoint}:${clientIP}:${window}:${windowStart}`;

  if (driver === 'postgres') {
    const client = await getDbClient();
    const result = await client.query(
      `SELECT used FROM usage_quota WHERE key = $1`,
      [key]
    );

    if (result.rows.length > 0) {
      return {
        endpoint,
        window,
        limit: RATE_LIMITS[endpoint]?.[window === 'hour' ? 'hourly' : 'daily'] || 100,
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
      limit: RATE_LIMITS[endpoint]?.[window === 'hour' ? 'hourly' : 'daily'] || 100,
      used: 0,
      resetAt,
    };
  } else {
    // SQLite
    const sqlite = getSqlite();
    const row = sqlite
      .prepare('SELECT used FROM usage_quota WHERE key = ?')
      .get(key) as { used: number } | undefined;

    if (row) {
      return {
        endpoint,
        window,
        limit: RATE_LIMITS[endpoint]?.[window === 'hour' ? 'hourly' : 'daily'] || 100,
        used: row.used,
        resetAt,
      };
    }

    // Initialize new record
    sqlite
      .prepare(
        'INSERT OR IGNORE INTO usage_quota (key, endpoint, client_ip, window_type, used, reset_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
      )
      .run(key, endpoint, clientIP, window, resetAt, now);

    return {
      endpoint,
      window,
      limit: RATE_LIMITS[endpoint]?.[window === 'hour' ? 'hourly' : 'daily'] || 100,
      used: 0,
      resetAt,
    };
  }
}

/**
 * Increment usage count for endpoint + IP + window
 */
async function incrementUsage(
  endpoint: string,
  clientIP: string,
  window: 'hour' | 'day'
): Promise<UsageQuota> {
  const driver = detectDriver();
  const now = Math.floor(Date.now() / 1000);

  const windowMs = window === 'hour' ? 3600 * 1000 : 24 * 3600 * 1000;
  const windowStart = Math.floor((Date.now() / windowMs)) * windowMs;
  const resetAt = Math.floor((windowStart + windowMs) / 1000);

  const key = `${endpoint}:${clientIP}:${window}:${windowStart}`;

  if (driver === 'postgres') {
    const client = await getDbClient();
    await client.run(
      `INSERT INTO usage_quota (key, endpoint, client_ip, window_type, used, reset_at, created_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6)
       ON CONFLICT (key) DO UPDATE SET used = usage_quota.used + 1`,
      [key, endpoint, clientIP, window, resetAt, now]
    );
  } else {
    const sqlite = getSqlite();
    sqlite
      .prepare(
        'INSERT INTO usage_quota (key, endpoint, client_ip, window_type, used, reset_at, created_at) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(key) DO UPDATE SET used = used + 1'
      )
      .run(key, endpoint, clientIP, window, resetAt, now);
  }

  const quota = await getUsageRecord(endpoint, clientIP, window);
  return { ...quota, used: quota.used + 1 };
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

