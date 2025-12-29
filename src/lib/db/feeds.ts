/**
 * Feed database operations
 */

import { getDbClient, detectDriver } from "./driver";
import { FeedConfig } from "../../config/feeds";
import type { Category } from "../model";
import { logger } from "../logger";

/**
 * Save feeds to database
 */
export async function saveFeeds(feedConfigs: FeedConfig[]): Promise<void> {
  try {
    const driver = detectDriver();
    const client = await getDbClient();

    if (driver === 'postgres') {
      // PostgreSQL: use ON CONFLICT syntax
      for (const config of feedConfigs) {
        await client.run(
          `INSERT INTO feeds (id, stream_id, canonical_name, default_category, vendor, tags, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, EXTRACT(EPOCH FROM NOW())::INTEGER)
           ON CONFLICT (id) DO UPDATE SET
             stream_id = EXCLUDED.stream_id,
             canonical_name = EXCLUDED.canonical_name,
             default_category = EXCLUDED.default_category,
             vendor = EXCLUDED.vendor,
             tags = EXCLUDED.tags,
             updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER`,
          [
            config.streamId, // Use streamId as id
            config.streamId,
            config.canonicalName,
            config.defaultCategory,
            config.vendor || null,
            config.tags ? JSON.stringify(config.tags) : null,
          ]
        );
      }
    } else {
      // SQLite: use INSERT OR REPLACE
      const { getSqlite } = await import("./index");
      const sqlite = getSqlite();
      const stmt = sqlite.prepare(`
        INSERT OR REPLACE INTO feeds
        (id, stream_id, canonical_name, default_category, vendor, tags, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
      `);

      const insertMany = sqlite.transaction((configs: FeedConfig[]) => {
        for (const config of configs) {
          stmt.run(
            config.streamId,
            config.streamId,
            config.canonicalName,
            config.defaultCategory,
            config.vendor || null,
            config.tags ? JSON.stringify(config.tags) : null
          );
        }
      });

      insertMany(feedConfigs);
    }

    logger.info(`Saved ${feedConfigs.length} feeds to database`);
  } catch (error) {
    logger.error("Failed to save feeds to database", error);
    throw error;
  }
}

/**
 * Load all feeds from database
 */
export async function loadAllFeeds(): Promise<FeedConfig[]> {
  try {
    const driver = detectDriver();
    const client = await getDbClient();

    let rows: Array<{
      stream_id: string;
      canonical_name: string;
      default_category: string;
      vendor: string | null;
      tags: string | null;
    }>;

    if (driver === 'postgres') {
      const result = await client.query(
        `SELECT stream_id, canonical_name, default_category, vendor, tags FROM feeds ORDER BY updated_at DESC`
      );
      rows = result.rows as typeof rows;
    } else {
      const { getSqlite } = await import("./index");
      const sqlite = getSqlite();
      rows = sqlite
        .prepare(`SELECT stream_id, canonical_name, default_category, vendor, tags FROM feeds ORDER BY updated_at DESC`)
        .all() as typeof rows;
    }

    const feeds: FeedConfig[] = rows.map((row) => {
      const category = row.default_category as Category;
      return {
        streamId: row.stream_id,
        canonicalName: row.canonical_name,
        defaultCategory: category,
        vendor: row.vendor || undefined,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
      };
    });

    return feeds;
  } catch (error) {
    logger.error("Failed to load feeds from database", error);
    throw error;
  }
}

/**
 * Load a single feed by streamId
 */
export async function loadFeed(streamId: string): Promise<FeedConfig | null> {
  try {
    const driver = detectDriver();
    const client = await getDbClient();

    let row: {
      stream_id: string;
      canonical_name: string;
      default_category: string;
      vendor: string | null;
      tags: string | null;
    } | undefined;

    if (driver === 'postgres') {
      const result = await client.query(
        `SELECT stream_id, canonical_name, default_category, vendor, tags FROM feeds WHERE stream_id = $1`,
        [streamId]
      );
      row = result.rows[0] as typeof row | undefined;
    } else {
      const { getSqlite } = await import("./index");
      const sqlite = getSqlite();
      row = sqlite
        .prepare(`SELECT stream_id, canonical_name, default_category, vendor, tags FROM feeds WHERE stream_id = ?`)
        .get(streamId) as typeof row | undefined;
    }

    if (!row) {
      return null;
    }

    const category = row.default_category as Category;
    return {
      streamId: row.stream_id,
      canonicalName: row.canonical_name,
      defaultCategory: category,
      vendor: row.vendor || undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
    };
  } catch (error) {
    logger.error(`Failed to load feed ${streamId} from database`, error);
    throw error;
  }
}

/**
 * Get count of feeds in database
 */
export async function getFeedsCount(): Promise<number> {
  try {
    const driver = detectDriver();
    const client = await getDbClient();

    if (driver === 'postgres') {
      const result = await client.query(`SELECT COUNT(*) as count FROM feeds`);
      const row = result.rows[0] as { count: string | number } | undefined;
      return typeof row?.count === 'string' ? parseInt(row.count, 10) : (row?.count ?? 0);
    } else {
      const { getSqlite } = await import("./index");
      const sqlite = getSqlite();
      const result = sqlite.prepare(`SELECT COUNT(*) as count FROM feeds`).get() as { count: number } | undefined;
      return result?.count ?? 0;
    }
  } catch (error) {
    logger.error("Failed to get feeds count", error);
    throw error;
  }
}

/**
 * Update cache metadata for feeds
 */
export async function updateFeedsCacheMetadata(count: number): Promise<void> {
  try {
    const driver = detectDriver();
    const client = await getDbClient();

    if (driver === 'postgres') {
      await client.run(
        `INSERT INTO cache_metadata (key, last_refresh_at, count, expires_at)
         VALUES ($1, EXTRACT(EPOCH FROM NOW())::INTEGER, $2, EXTRACT(EPOCH FROM NOW())::INTEGER + (6 * 3600))
         ON CONFLICT (key) DO UPDATE SET
           last_refresh_at = EXTRACT(EPOCH FROM NOW())::INTEGER,
           count = EXCLUDED.count,
           expires_at = EXTRACT(EPOCH FROM NOW())::INTEGER + (6 * 3600)`,
        ['feeds', count]
      );
    } else {
      const { getSqlite } = await import("./index");
      const sqlite = getSqlite();
      sqlite.prepare(`
        INSERT OR REPLACE INTO cache_metadata (key, last_refresh_at, count, expires_at)
        VALUES (
          'feeds',
          strftime('%s', 'now'),
          ?,
          strftime('%s', 'now') + (6 * 3600)
        )
      `).run(count);
    }

    logger.info("Updated feeds cache metadata");
  } catch (error) {
    logger.error("Failed to update feeds cache metadata", error);
    throw error;
  }
}

/**
 * Get feeds cache metadata (when it was last fetched, how many, when it expires)
 */
export async function getFeedsCacheMetadata(): Promise<{
  lastRefreshAt: number | null;
  count: number;
  expiresAt: number | null;
} | null> {
  try {
    const driver = detectDriver();
    const client = await getDbClient();

    let row: { last_refresh_at: number | null; count: number; expires_at: number | null } | undefined;

    if (driver === 'postgres') {
      const result = await client.query(
        `SELECT last_refresh_at, count, expires_at FROM cache_metadata WHERE key = $1`,
        ['feeds']
      );
      row = result.rows[0] as typeof row | undefined;
    } else {
      const { getSqlite } = await import("./index");
      const sqlite = getSqlite();
      row = sqlite
        .prepare(`SELECT last_refresh_at, count, expires_at FROM cache_metadata WHERE key = 'feeds'`)
        .get() as typeof row | undefined;
    }

    if (!row) {
      return null;
    }

    return {
      lastRefreshAt: row.last_refresh_at,
      count: row.count,
      expiresAt: row.expires_at,
    };
  } catch (error) {
    logger.error("Failed to get feeds cache metadata", error);
    throw error;
  }
}

/**
 * Check if feeds cache is still valid
 */
export async function isFeedsCacheValid(): Promise<boolean> {
  try {
    const metadata = await getFeedsCacheMetadata();
    if (!metadata || !metadata.expiresAt) {
      return false;
    }
    return metadata.expiresAt > Math.floor(Date.now() / 1000);
  } catch (error) {
    logger.error("Failed to check feeds cache validity", error);
    return false;
  }
}
