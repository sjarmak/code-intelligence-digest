/**
 * Starred items management
 * Syncs and tracks items marked as starred in Inoreader for curation
 */

import { getDbClient, getFreshPostgresConnection } from "./driver";
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
    const client = await getDbClient();
    const id = `starred-${itemId}`;
    const now = Math.floor(Date.now() / 1000);
    const starredSeconds = Math.floor(starredAt.getTime() / 1000);

    await client.run(
      `
      INSERT INTO starred_items (
        id, item_id, inoreader_item_id, starred_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $5)
      ON CONFLICT (item_id) DO NOTHING
    `,
      [id, itemId, inoreaderItemId, starredSeconds, now]
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
  if (items.length === 0) {
    return 0;
  }

  const pg = await getFreshPostgresConnection();
  try {
    await pg.query("BEGIN");

    const sql = `
      INSERT INTO starred_items (
        id, item_id, inoreader_item_id, starred_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $5)
      ON CONFLICT (item_id) DO NOTHING
    `;

    let inserted = 0;
    for (const item of items) {
      const now = Math.floor(Date.now() / 1000);
      const starredSeconds = Math.floor(item.starredAt.getTime() / 1000);
      const id = `starred-${item.itemId}`;
      const res = await pg.query(sql, [id, item.itemId, item.inoreaderItemId, starredSeconds, now]);
      inserted += res.rowCount ?? 0;
    }

    await pg.query("COMMIT");

    logger.info("Saved starred items", { count: inserted });
    return inserted;
  } catch (error) {
    try {
      await pg.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    logger.error("Failed to save starred items", { count: items.length, error });
    throw error;
  } finally {
    pg.release();
  }
}

/**
 * Get all starred items with optional rating filter
 */
export async function getStarredItems(options?: {
  onlyUnrated?: boolean;
  limit?: number;
  offset?: number;
}) {
  try {
    const client = await getDbClient();

    let sql = `
      SELECT 
        si.id,
        si.item_id as "itemId",
        si.inoreader_item_id as "inoreaderItemId",
        si.relevance_rating as "relevanceRating",
        si.notes,
        si.starred_at as "starredAt",
        si.rated_at as "ratedAt",
        i.title,
        i.url,
        i.source_title as "sourceTitle",
        i.published_at as "publishedAt",
        i.summary
      FROM starred_items si
      LEFT JOIN items i ON si.item_id = i.id
    `;

    const params: unknown[] = [];
    if (options?.onlyUnrated) {
      sql += ` WHERE si.relevance_rating IS NULL`;
    }

    sql += ` ORDER BY si.starred_at ASC`;

    if (options?.limit !== undefined) {
      params.push(options.limit);
      sql += ` LIMIT $${params.length}`;
    }
    if (options?.offset !== undefined) {
      params.push(options.offset);
      sql += ` OFFSET $${params.length}`;
    }

    const result = await client.query(sql, params);

    return result.rows as Array<{
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
    const client = await getDbClient();
    const now = Math.floor(Date.now() / 1000);

    await client.run(
      `
      UPDATE starred_items
      SET relevance_rating = $1,
          notes = $2,
          rated_at = $3,
          updated_at = $3
      WHERE inoreader_item_id = $4
    `,
      [rating, notes ?? null, now, inoreaderItemId]
    );

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
    const client = await getDbClient();
    const result = await client.query(`SELECT COUNT(*)::bigint AS n FROM starred_items`);
    const row = result.rows[0] as { n: string } | undefined;
    return row ? parseInt(String(row.n), 10) : 0;
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
    const client = await getDbClient();
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS n FROM starred_items WHERE relevance_rating IS NULL`
    );
    const row = result.rows[0] as { n: string } | undefined;
    return row ? parseInt(String(row.n), 10) : 0;
  } catch (error) {
    logger.error("Failed to count unrated starred items", error);
    return 0;
  }
}
