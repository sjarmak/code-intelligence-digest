/**
 * Item database operations
 */

import { getSqlite } from "./index";
import { FeedItem } from "../model";
import type { Category } from "../model";
import { logger } from "../logger";

/**
 * Save items to database
 */
export async function saveItems(items: FeedItem[]): Promise<void> {
  try {
    const sqlite = getSqlite();

    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO items 
      (id, stream_id, source_title, title, url, author, published_at, summary, content_snippet, categories, category, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `);

    const insertMany = sqlite.transaction((items: FeedItem[]) => {
      for (const item of items) {
        stmt.run(
          item.id,
          item.streamId,
          item.sourceTitle,
          item.title,
          item.url,
          item.author || null,
          Math.floor(item.publishedAt.getTime() / 1000), // Convert to Unix timestamp
          item.summary || null,
          item.contentSnippet || null,
          JSON.stringify(item.categories),
          item.category
        );
      }
    });

    insertMany(items);
    logger.info(`Saved ${items.length} items to database`);
  } catch (error) {
    logger.error("Failed to save items to database", error);
    throw error;
  }
}

/**
 * Load items for a given category within a time window
 */
export async function loadItemsByCategory(
  category: string,
  periodDays: number
): Promise<FeedItem[]> {
  try {
    const sqlite = getSqlite();

    const cutoffTime = Math.floor((Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000);

    const rows = sqlite
      .prepare(
        `
      SELECT * FROM items 
      WHERE category = ? AND published_at >= ?
      ORDER BY published_at DESC
      `
      )
      .all(category, cutoffTime) as Array<{
      id: string;
      stream_id: string;
      source_title: string;
      title: string;
      url: string;
      author: string | null;
      published_at: number;
      summary: string | null;
      content_snippet: string | null;
      categories: string;
      category: string;
    }>;

    const items: FeedItem[] = rows.map((row) => {
      const category = row.category as Category;
      return {
        id: row.id,
        streamId: row.stream_id,
        sourceTitle: row.source_title,
        title: row.title,
        url: row.url,
        author: row.author || undefined,
        publishedAt: new Date(row.published_at * 1000), // Convert from Unix timestamp
        summary: row.summary || undefined,
        contentSnippet: row.content_snippet || undefined,
        categories: JSON.parse(row.categories),
        category,
        raw: {}, // Raw data not stored in DB
      };
    });

    return items;
  } catch (error) {
    logger.error(
      `Failed to load items for category ${category} with period ${periodDays}d`,
      error
    );
    throw error;
  }
}

/**
 * Load a single item by ID
 */
export async function loadItem(itemId: string): Promise<FeedItem | null> {
  try {
    const sqlite = getSqlite();

    const row = sqlite
      .prepare(`SELECT * FROM items WHERE id = ?`)
      .get(itemId) as {
      id: string;
      stream_id: string;
      source_title: string;
      title: string;
      url: string;
      author: string | null;
      published_at: number;
      summary: string | null;
      content_snippet: string | null;
      categories: string;
      category: string;
    } | undefined;

    if (!row) {
      return null;
    }

    const category = row.category as Category;
    return {
      id: row.id,
      streamId: row.stream_id,
      sourceTitle: row.source_title,
      title: row.title,
      url: row.url,
      author: row.author || undefined,
      publishedAt: new Date(row.published_at * 1000),
      summary: row.summary || undefined,
      contentSnippet: row.content_snippet || undefined,
      categories: JSON.parse(row.categories),
      category,
      raw: {},
    };
  } catch (error) {
    logger.error(`Failed to load item ${itemId} from database`, error);
    throw error;
  }
}

/**
 * Get count of items in database
 */
export async function getItemsCount(): Promise<number> {
  try {
    const sqlite = getSqlite();

    const result = sqlite.prepare(`SELECT COUNT(*) as count FROM items`).get() as { count: number } | undefined;
    return result?.count ?? 0;
  } catch (error) {
    logger.error("Failed to get items count", error);
    throw error;
  }
}

/**
 * Get count of items for a specific category
 */
export async function getItemsCountByCategory(category: string): Promise<number> {
  try {
    const sqlite = getSqlite();

    const result = sqlite
      .prepare(`SELECT COUNT(*) as count FROM items WHERE category = ?`)
      .get(category) as { count: number } | undefined;
    return result?.count ?? 0;
  } catch (error) {
    logger.error(`Failed to get items count for category ${category}`, error);
    throw error;
  }
}

/**
 * Load pre-computed scores for items from the item_scores table
 */
export async function loadScoresForItems(
  itemIds: string[]
): Promise<Record<string, { llm_relevance: number; llm_usefulness: number; llm_tags: string[] }>> {
  try {
    if (itemIds.length === 0) {
      return {};
    }

    const sqlite = getSqlite();

    // Get the most recent scores for each item
    const placeholders = itemIds.map(() => "?").join(",");
    const rows = sqlite
      .prepare(
        `
      SELECT item_id, llm_relevance, llm_usefulness, llm_tags
      FROM item_scores
      WHERE item_id IN (${placeholders})
      ORDER BY scored_at DESC
    `
      )
      .all(...itemIds) as Array<{
      item_id: string;
      llm_relevance: number;
      llm_usefulness: number;
      llm_tags: string | null;
    }>;

    const scores: Record<string, { llm_relevance: number; llm_usefulness: number; llm_tags: string[] }> = {};
    const seen = new Set<string>();

    for (const row of rows) {
      // Only include the first (most recent) score for each item
      if (!seen.has(row.item_id)) {
        seen.add(row.item_id);
        scores[row.item_id] = {
          llm_relevance: row.llm_relevance,
          llm_usefulness: row.llm_usefulness,
          llm_tags: row.llm_tags ? JSON.parse(row.llm_tags) : [],
        };
      }
    }

    return scores;
  } catch (error) {
    logger.error("Failed to load scores for items", error);
    throw error;
  }
}

/**
 * Get the most recent published_at timestamp from all items in database
 * Used by daily sync to fetch only newer items
 */
export async function getLastPublishedTimestamp(): Promise<number | null> {
  try {
    const sqlite = getSqlite();

    const result = sqlite
      .prepare(`SELECT MAX(published_at) as max_published FROM items`)
      .get() as { max_published: number | null } | undefined;

    return result?.max_published ?? null;
  } catch (error) {
    logger.warn("Failed to get last published timestamp", error);
    return null;
  }
}

/**
 * Update cache metadata for items
 */
export async function updateItemsCacheMetadata(periodDays: number, count: number): Promise<void> {
  try {
    const sqlite = getSqlite();

    const cacheKey = `items_${periodDays}d`;
    sqlite.prepare(`
      INSERT OR REPLACE INTO cache_metadata (key, last_refresh_at, count, expires_at)
      VALUES (
        ?,
        strftime('%s', 'now'),
        ?,
        strftime('%s', 'now') + (1 * 3600)
      )
    `).run(cacheKey, count);

    logger.info(`Updated items cache metadata for ${periodDays}d period`);
  } catch (error) {
    logger.error("Failed to update items cache metadata", error);
    throw error;
  }
}
