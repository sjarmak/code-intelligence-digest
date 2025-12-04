/**
 * Feed database operations
 */

import { getSqlite } from "./index";
import { FeedConfig } from "../../config/feeds";
import type { Category } from "../model";
import { logger } from "../logger";

/**
 * Save feeds to database
 */
export async function saveFeeds(feedConfigs: FeedConfig[]): Promise<void> {
  try {
    const sqlite = getSqlite();

    // Use transaction for atomic operation
    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO feeds 
      (id, stream_id, canonical_name, default_category, vendor, tags, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `);

    const insertMany = sqlite.transaction((configs: FeedConfig[]) => {
      for (const config of configs) {
        stmt.run(
          config.streamId, // Use streamId as id
          config.streamId,
          config.canonicalName,
          config.defaultCategory,
          config.vendor || null,
          config.tags ? JSON.stringify(config.tags) : null
        );
      }
    });

    insertMany(feedConfigs);
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
    const sqlite = getSqlite();

    const rows = sqlite
      .prepare(`SELECT * FROM feeds ORDER BY updated_at DESC`)
      .all() as Array<{
      stream_id: string;
      canonical_name: string;
      default_category: string;
      vendor: string | null;
      tags: string | null;
    }>;

    const feeds: FeedConfig[] = rows.map((row) => {
      // DB stores as string, cast to Category type
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
    const sqlite = getSqlite();

    const row = sqlite
      .prepare(`SELECT * FROM feeds WHERE stream_id = ?`)
      .get(streamId) as {
      stream_id: string;
      canonical_name: string;
      default_category: string;
      vendor: string | null;
      tags: string | null;
    } | undefined;

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
    const sqlite = getSqlite();

    const result = sqlite.prepare(`SELECT COUNT(*) as count FROM feeds`).get() as { count: number } | undefined;
    return result?.count ?? 0;
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
    const sqlite = getSqlite();

    const row = sqlite
      .prepare(`SELECT last_refresh_at, count, expires_at FROM cache_metadata WHERE key = 'feeds'`)
      .get() as { last_refresh_at: number | null; count: number; expires_at: number | null } | undefined;

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
