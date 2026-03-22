/**
 * Cache management operations
 * Handle cache invalidation, TTL checks, and stale fallback
 */

import { logger } from "../logger";
import { getDbClient } from "./driver";

export interface CacheMetadata {
  key: string;
  lastRefreshAt: number | null;
  count: number;
  expiresAt: number | null;
}

/**
 * Check if a cache key is expired
 */
export async function isCacheExpired(key: string): Promise<boolean> {
  try {
    const client = await getDbClient();
    const result = await client.query(`SELECT expires_at FROM cache_metadata WHERE key = $1`, [
      key,
    ]);
    const row = result.rows[0] as { expires_at: number | null } | undefined;

    if (!row || !row.expires_at) {
      return true; // No metadata = expired
    }

    const isExpired = row.expires_at <= Math.floor(Date.now() / 1000);
    return isExpired;
  } catch (error) {
    logger.error(`Failed to check cache expiration for ${key}`, error);
    return true; // Default to expired on error
  }
}

/**
 * Invalidate a cache key (force refresh on next request)
 */
export async function invalidateCacheKey(key: string): Promise<void> {
  try {
    const client = await getDbClient();
    await client.run(
      `
      UPDATE cache_metadata
      SET expires_at = 0
      WHERE key = $1
    `,
      [key],
    );

    logger.info(`Invalidated cache key: ${key}`);
  } catch (error) {
    logger.error(`Failed to invalidate cache key ${key}`, error);
    throw error;
  }
}

/**
 * Invalidate all item caches for a category
 */
export async function invalidateCategoryItems(category: string): Promise<void> {
  try {
    // Invalidate both 7d and 30d caches for this category
    for (const period of [7, 30]) {
      const key = `items_${period}d_${category}`;
      await invalidateCacheKey(key);
    }

    logger.info(`Invalidated all item caches for category: ${category}`);
  } catch (error) {
    logger.error(`Failed to invalidate items for category ${category}`, error);
    throw error;
  }
}

/**
 * Invalidate all feeds cache
 */
export async function invalidateFeeds(): Promise<void> {
  try {
    await invalidateCacheKey("feeds");
    logger.info("Invalidated feeds cache");
  } catch (error) {
    logger.error("Failed to invalidate feeds cache", error);
    throw error;
  }
}

/**
 * Get current cache metadata
 */
export async function getCacheMetadata(key: string): Promise<CacheMetadata | null> {
  try {
    const client = await getDbClient();
    const result = await client.query(
      `SELECT key, last_refresh_at, count, expires_at FROM cache_metadata WHERE key = $1`,
      [key],
    );
    const row = result.rows[0] as
      | {
          key: string;
          last_refresh_at: number | null;
          count: number;
          expires_at: number | null;
        }
      | undefined;
    if (!row) return null;
    return {
      key: row.key,
      lastRefreshAt: row.last_refresh_at,
      count: row.count,
      expiresAt: row.expires_at,
    };
  } catch (error) {
    logger.error(`Failed to get cache metadata for ${key}`, error);
    return null;
  }
}

/**
 * Get all cache metadata
 */
export async function getAllCacheMetadata(): Promise<CacheMetadata[]> {
  try {
    const client = await getDbClient();
    const result = await client.query(
      `SELECT key, last_refresh_at, count, expires_at FROM cache_metadata ORDER BY expires_at DESC`,
    );
    const rows = result.rows as Array<{
      key: string;
      last_refresh_at: number | null;
      count: number;
      expires_at: number | null;
    }>;
    return rows.map((r) => ({
      key: r.key,
      lastRefreshAt: r.last_refresh_at,
      count: r.count,
      expiresAt: r.expires_at,
    }));
  } catch (error) {
    logger.error("Failed to get all cache metadata", error);
    return [];
  }
}

/**
 * Extend cache TTL by specified seconds (for "smart stale" fallback)
 */
export async function extendCacheTTL(key: string, extensionSeconds: number): Promise<void> {
  try {
    const client = await getDbClient();

    const newExpiresAt = Math.floor(Date.now() / 1000) + extensionSeconds;
    await client.run(`UPDATE cache_metadata SET expires_at = $1 WHERE key = $2`, [
      newExpiresAt,
      key,
    ]);

    logger.info(
      `Extended cache TTL for ${key} by ${extensionSeconds}s (expires at ${newExpiresAt})`
    );
  } catch (error) {
    logger.error(`Failed to extend cache TTL for ${key}`, error);
    throw error;
  }
}

/**
 * Set cache metadata with explicit expiration
 */
export async function setCacheMetadata(
  key: string,
  count: number,
  ttlSeconds: number
): Promise<void> {
  try {
    const client = await getDbClient();

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;

    await client.run(
      `
      INSERT INTO cache_metadata (key, last_refresh_at, count, expires_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (key) DO UPDATE SET
        last_refresh_at = EXCLUDED.last_refresh_at,
        count = EXCLUDED.count,
        expires_at = EXCLUDED.expires_at
    `,
      [key, now, count, expiresAt],
    );

    logger.info(`Set cache metadata: ${key}, count=${count}, expires_at=${expiresAt}`);
  } catch (error) {
    logger.error(`Failed to set cache metadata for ${key}`, error);
    throw error;
  }
}
