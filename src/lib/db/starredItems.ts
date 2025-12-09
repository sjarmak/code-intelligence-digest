/**
 * Starred items management
 * Syncs and tracks items marked as starred in Inoreader for curation
 */

import { getSqlite } from "./index";
import { logger } from "../logger";

export type RelevanceRating = 0 | 1 | 2 | 3 | null;

export const RATING_LABELS: Record<NonNullable<RelevanceRating>, string> = {
  0: "Not Relevant",
  1: "Somewhat Relevant",
  2: "Relevant",
  3: "Highly Relevant",
};

/**
 * Save a starred item from Inoreader
 */
export async function saveStarredItem(
  itemId: string,
  inoreaderItemId: string,
  starredAt: Date
): Promise<void> {
  try {
    const sqlite = getSqlite();
    const id = `starred-${itemId}`;
    const now = Math.floor(Date.now() / 1000);

    sqlite
      .prepare(
        `INSERT OR IGNORE INTO starred_items 
         (id, item_id, inoreader_item_id, starred_at, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        itemId,
        inoreaderItemId,
        Math.floor(starredAt.getTime() / 1000),
        now,
        now
      );

    logger.info("Saved starred item", { itemId, inoreaderItemId });
  } catch (error) {
    logger.error("Failed to save starred item", { itemId, error });
    throw error;
  }
}

/**
 * Batch save starred items
 */
export async function saveStarredItems(
  items: Array<{ itemId: string; inoreaderItemId: string; starredAt: Date }>
): Promise<number> {
  try {
    const sqlite = getSqlite();
    const now = Math.floor(Date.now() / 1000);

    const stmt = sqlite.prepare(
      `INSERT OR IGNORE INTO starred_items 
       (id, item_id, inoreader_item_id, starred_at, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const insertMany = sqlite.transaction((records: typeof items) => {
      for (const item of records) {
        stmt.run(
          `starred-${item.itemId}`,
          item.itemId,
          item.inoreaderItemId,
          Math.floor(item.starredAt.getTime() / 1000),
          now,
          now
        );
      }
      return records.length;
    });

    const count = insertMany(items);
    logger.info("Saved starred items", { count });
    return count;
  } catch (error) {
    logger.error("Failed to save starred items", { count: items.length, error });
    throw error;
  }
}

/**
 * Get all starred items with optional rating filter
 */
export async function getStarredItems(options?: {
  onlyRated?: boolean;
  limit?: number;
  offset?: number;
}) {
  try {
    const sqlite = getSqlite();

    let sql = `
      SELECT 
        si.id,
        si.item_id as itemId,
        si.inoreader_item_id as inoreaderItemId,
        si.relevance_rating as relevanceRating,
        si.notes,
        si.starred_at as starredAt,
        si.rated_at as ratedAt,
        i.title,
        i.url,
        i.source_title as sourceTitle,
        i.published_at as publishedAt,
        i.summary
      FROM starred_items si
      LEFT JOIN items i ON si.item_id = i.id
    `;

    if (options?.onlyRated) {
      sql += ` WHERE si.relevance_rating IS NOT NULL`;
    }

    sql += ` ORDER BY si.starred_at ASC`;

    if (options?.limit) {
      sql += ` LIMIT ${options.limit}`;
    }

    if (options?.offset) {
      sql += ` OFFSET ${options.offset}`;
    }

    const results = sqlite.prepare(sql).all() as Array<{
      id: string;
      itemId: string;
      inoreaderItemId: string;
      relevanceRating: number | null;
      notes: string | null;
      starredAt: number;
      ratedAt: number | null;
      title: string | null;
      url: string | null;
      sourceTitle: string | null;
      publishedAt: number | null;
      summary: string | null;
    }>;

    return results;
  } catch (error) {
    logger.error("Failed to get starred items", error);
    return [];
  }
}

/**
 * Set relevance rating for an item in the starred items table
 * (Rating the item's relevance, not the starred status)
 */
export async function rateItem(
  inoreaderItemId: string,
  rating: RelevanceRating,
  notes?: string
): Promise<void> {
  try {
    const sqlite = getSqlite();
    const now = Math.floor(Date.now() / 1000);

    sqlite
      .prepare(
        `UPDATE starred_items 
         SET relevance_rating = ?, notes = ?, rated_at = ?, updated_at = ? 
         WHERE inoreader_item_id = ?`
      )
      .run(rating, notes || null, now, now, inoreaderItemId);

    logger.info("Rated starred item", {
      inoreaderItemId,
      rating,
      label: rating !== null ? RATING_LABELS[rating] : "unset",
    });
  } catch (error) {
    logger.error("Failed to rate starred item", { inoreaderItemId, error });
    throw error;
  }
}

/**
 * Count starred items
 */
export async function countStarredItems(): Promise<number> {
  try {
    const sqlite = getSqlite();
    const result = sqlite
      .prepare(`SELECT COUNT(*) as count FROM starred_items`)
      .get() as { count: number };
    return result?.count ?? 0;
  } catch (error) {
    logger.error("Failed to count starred items", error);
    return 0;
  }
}

/**
 * Count unrated starred items
 */
export async function countUnratedStarredItems(): Promise<number> {
  try {
    const sqlite = getSqlite();
    const result = sqlite
      .prepare(`SELECT COUNT(*) as count FROM starred_items WHERE relevance_rating IS NULL`)
      .get() as { count: number };
    return result?.count ?? 0;
  } catch (error) {
    logger.error("Failed to count unrated starred items", error);
    return 0;
  }
}
