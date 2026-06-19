/**
 * Item database operations
 */

import { getDbClient } from "./driver";
import { FeedItem } from "../model";
import type { Category } from "../model";
import { logger } from "../logger";
import { tryResolveToArticleUrl } from "../url-curation";

/**
 * Curate items so only those with a valid article URL are saved.
 * Resolves subscription/plan URLs to article URLs when possible; drops items that cannot be resolved.
 */
function itemsWithArticleUrlsOnly(items: FeedItem[]): FeedItem[] {
  const out: FeedItem[] = [];
  for (const item of items) {
    const articleUrl = tryResolveToArticleUrl(item.url);
    if (!articleUrl) {
      logger.debug(
        `Skipping item (subscription/plan URL, no article): "${item.title}" url=${item.url?.substring(0, 60)}...`,
      );
      continue;
    }
    out.push(articleUrl !== item.url ? { ...item, url: articleUrl } : item);
  }
  if (out.length < items.length) {
    logger.info(
      `URL curation: ${items.length} → ${out.length} items (dropped ${items.length - out.length} with subscription/plan URLs only)`,
    );
  }
  return out;
}

/** Resolve URL to article URL for display; returns null if this is a subscription/plan-only URL (item should not be shown). */
function articleUrlForDisplay(url: string | undefined): string | null {
  if (!url) return null;
  return tryResolveToArticleUrl(url);
}

/** Shape of an `items` row as selected by the loaders below. */
export interface ItemRow {
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
  full_text: string | null;
  extracted_url: string | null;
}

/**
 * Map a DB row to a FeedItem, resolving the display/article URL. Returns null
 * when the URL cannot be resolved to a real article (the caller filters those
 * out). Single source of truth for the row->FeedItem shape used by every loader.
 */
export function mapItemRow(row: ItemRow): FeedItem | null {
  const finalUrl =
    row.url && !row.url.includes("inoreader.com") ? row.url : row.extracted_url || row.url;
  const articleUrl = articleUrlForDisplay(finalUrl);
  if (!articleUrl) return null;
  return {
    id: row.id,
    streamId: row.stream_id,
    sourceTitle: row.source_title,
    title: row.title,
    url: articleUrl,
    author: row.author ?? undefined,
    publishedAt: new Date(row.published_at * 1000),
    summary: row.summary ?? undefined,
    contentSnippet: row.content_snippet ?? undefined,
    categories: JSON.parse(row.categories),
    category: row.category as Category,
    raw: {},
    fullText: row.full_text ?? undefined,
  };
}

/** SELECT column list shared by the loaders (matches ItemRow). */
const ITEM_COLUMNS = `id, stream_id, source_title, title, url, author, published_at,
       summary, content_snippet, categories, category, full_text, extracted_url`;

/**
 * Save items to database.
 * Only items with a valid article URL are stored; subscription/plan-only URLs are skipped.
 */
export async function saveItems(items: FeedItem[]): Promise<void> {
  try {
    const toSave = itemsWithArticleUrlsOnly(items);
    if (toSave.length === 0) {
      logger.debug("saveItems: no items with valid article URLs to save");
      return;
    }

    

      const client = await getDbClient();
      for (const item of toSave) {
        await client.run(
          `
          INSERT INTO items
          (id, stream_id, source_title, title, url, author, published_at, summary, content_snippet, categories, category, full_text, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, EXTRACT(EPOCH FROM NOW())::INTEGER)
          ON CONFLICT (id) DO UPDATE SET
            stream_id = EXCLUDED.stream_id,
            source_title = EXCLUDED.source_title,
            title = EXCLUDED.title,
            url = EXCLUDED.url,
            author = EXCLUDED.author,
            published_at = EXCLUDED.published_at,
            summary = EXCLUDED.summary,
            content_snippet = EXCLUDED.content_snippet,
            categories = EXCLUDED.categories,
            category = EXCLUDED.category,
            full_text = COALESCE(EXCLUDED.full_text, items.full_text),
            updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
        `,
          [
            item.id,
            item.streamId,
            item.sourceTitle,
            item.title,
            item.url,
            item.author || null,
            Math.floor(item.publishedAt.getTime() / 1000),
            item.summary || null,
            item.contentSnippet || null,
            JSON.stringify(item.categories),
            item.category,
            item.fullText || null,
          ],
        );
      }
    

    logger.info(`Saved ${toSave.length} items to database`);
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
  periodDays: number,
  limit?: number,
): Promise<FeedItem[]> {
  try {
    const cutoffTime = Math.floor(
      (Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000,
    );

    const client = await getDbClient();
    const sql = typeof limit === "number" && limit > 0
      ? `SELECT ${ITEM_COLUMNS}
         FROM items
         WHERE category = $1 AND published_at >= $2
         ORDER BY published_at DESC
         LIMIT $3`
      : `SELECT ${ITEM_COLUMNS}
         FROM items
         WHERE category = $1 AND published_at >= $2
         ORDER BY published_at DESC`;
    const args = typeof limit === "number" && limit > 0
      ? [category, cutoffTime, limit]
      : [category, cutoffTime];
    const result = await client.query(sql, args);
    const rows = result.rows as unknown as ItemRow[];

    const items = rows
      .map(mapItemRow)
      .filter((item): item is FeedItem => item != null);

    return items;
  } catch (error) {
    logger.error(
      `Failed to load items for category ${category} with period ${periodDays}d`,
      error,
    );
    throw error;
  }
}

/**
 * Load items for a given category within a specific date range
 */
export async function loadItemsByCategoryWithDateRange(
  category: string,
  startDate: Date,
  endDate: Date,
): Promise<FeedItem[]> {
  try {
    const startTime = Math.floor(startDate.getTime() / 1000);
    const endTime = Math.floor(endDate.getTime() / 1000);

    const client = await getDbClient();
    const result = await client.query(
      `SELECT ${ITEM_COLUMNS}
       FROM items
       WHERE category = $1 AND published_at >= $2 AND published_at <= $3
       ORDER BY published_at DESC`,
      [category, startTime, endTime],
    );
    const rows = result.rows as unknown as ItemRow[];

    const items = rows
      .map(mapItemRow)
      .filter((item): item is FeedItem => item != null);

    return items;
  } catch (error) {
    logger.error(
      `Failed to load items for category ${category} with date range ${startDate.toISOString()} to ${endDate.toISOString()}`,
      error,
    );
    throw error;
  }
}

/**
 * Load a single item by ID
 */
export async function loadItem(itemId: string): Promise<FeedItem | null> {
  try {
    const client = await getDbClient();
    const result = await client.query(
      `SELECT ${ITEM_COLUMNS}
       FROM items WHERE id = $1`,
      [itemId],
    );
    const row = result.rows[0] as unknown as ItemRow | undefined;
    if (!row) {
      return null;
    }
    return mapItemRow(row);
  } catch (error) {
    logger.error(`Failed to load item ${itemId} from database`, error);
    throw error;
  }
}

/**
 * Load all items from database
 */
export async function loadAllItems(): Promise<FeedItem[]> {
  try {
    const client = await getDbClient();
    const result = await client.query(
      `SELECT ${ITEM_COLUMNS}
       FROM items
       ORDER BY published_at DESC`,
    );
    const items = (result.rows as unknown as ItemRow[])
      .map(mapItemRow)
      .filter((item): item is FeedItem => item != null);

    logger.info(`Loaded ${items.length} items from database`);
    return items;
  } catch (error) {
    logger.error("Failed to load all items from database", error);
    throw error;
  }
}

export interface ItemsPage {
  items: FeedItem[];
  /** Raw rows returned (before mapItemRow filtering) — for limit/progress accounting. */
  rawCount: number;
  /** Cursor for the next page (the last RAW row's id), or null when exhausted. */
  nextCursor: string | null;
}

/**
 * Keyset-paginated item loader, ordered by the `id` PK. Bounded memory: callers
 * page through the full corpus (`afterId = ""` to start, then `nextCursor`)
 * instead of `loadAllItems()`, which materializes all ~116K items at once.
 * Ordering by the PK gives a stable, total cursor (published_at is not unique).
 *
 * `nextCursor` is derived from the last RAW row, NOT the last mapped item — rows
 * dropped by mapItemRow (unresolvable URL) must still advance the cursor, or a
 * fully-filtered page would stall paging.
 *
 * Assumptions: (1) the `id > $1` ordering relies on the cluster's default TEXT
 * collation being stable across the run (true for a single backfill). (2) NOT
 * snapshot-consistent — the live cron writes items concurrently, and Inoreader
 * ids are not time-monotonic, so a single pass can miss late arrivals; re-run to
 * convergence and verify with getModelEmbeddingCoverage.
 */
export async function loadItemsPage(
  afterId: string,
  limit: number,
  sinceEpoch?: number,
): Promise<ItemsPage> {
  const client = await getDbClient();
  // Optional recency filter (published_at >= cutoff) for windowed backfills.
  // Still keyset-ordered by the id PK so paging stays stable.
  const params: unknown[] = [afterId];
  let recencyClause = "";
  if (sinceEpoch !== undefined) {
    params.push(sinceEpoch);
    recencyClause = ` AND published_at >= $${params.length}`;
  }
  params.push(limit);
  const result = await client.query(
    `SELECT ${ITEM_COLUMNS}
     FROM items
     WHERE id > $1${recencyClause}
     ORDER BY id
     LIMIT $${params.length}`,
    params,
  );
  const rows = result.rows as unknown as ItemRow[];
  const items = rows.map(mapItemRow).filter((item): item is FeedItem => item != null);
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
  return { items, rawCount: rows.length, nextCursor };
}

/**
 * Get the earliest published date in the database
 */
export async function getEarliestPublishedDate(): Promise<Date | null> {
  try {

    

      const client = await getDbClient();
      const result = await client.query(
        `SELECT MIN(published_at) as min_published FROM items`,
      );
      const minPublished = result.rows[0]?.min_published;
      return minPublished ? new Date(Number(minPublished) * 1000) : null;
    

  } catch (error) {
    logger.error("Failed to get earliest published date", error);
    throw error;
  }
}

/**
 * Get count of items in database
 */
export async function getItemsCount(): Promise<number> {
  try {

    

      const client = await getDbClient();
      const result = await client.query(`SELECT COUNT(*) as count FROM items`);
      return Number(result.rows[0]?.count ?? 0);
    

  } catch (error) {
    logger.error("Failed to get items count", error);
    throw error;
  }
}

/**
 * Get count of items for a specific category
 */
export async function getItemsCountByCategory(
  category: string,
): Promise<number> {
  try {

    

      const client = await getDbClient();
      const result = await client.query(
        `SELECT COUNT(*) as count FROM items WHERE category = $1`,
        [category],
      );
      return Number(result.rows[0]?.count ?? 0);
    

  } catch (error) {
    logger.error(`Failed to get items count for category ${category}`, error);
    throw error;
  }
}

/**
 * Load pre-computed scores for items from the item_scores table
 */
export async function loadScoresForItems(
  itemIds: string[],
): Promise<
  Record<
    string,
    {
      llm_relevance: number;
      llm_usefulness: number;
      llm_tags: string[];
      bm25_score?: number;
      final_score?: number;
    }
  >
> {
  try {
    if (itemIds.length === 0) {
      return {};
    }

    type ScoreRow = {
      item_id: string;
      llm_relevance: number;
      llm_usefulness: number;
      llm_tags: string | null;
      bm25_score: number | null;
      final_score: number | null;
    };

    const client = await getDbClient();
    const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(",");
    const result = await client.query(
      `SELECT item_id, llm_relevance, llm_usefulness, llm_tags, bm25_score, final_score
       FROM item_scores
       WHERE item_id IN (${placeholders})
       ORDER BY scored_at ASC`,
      itemIds,
    );
    const rows = result.rows as ScoreRow[];


    const scores: Record<
      string,
      {
        llm_relevance: number;
        llm_usefulness: number;
        llm_tags: string[];
        bm25_score?: number;
        final_score?: number;
      }
    > = {};
    const seen = new Set<string>();

    for (const row of rows) {
      if (!seen.has(row.item_id)) {
        seen.add(row.item_id);
        scores[row.item_id] = {
          llm_relevance: Number(row.llm_relevance),
          llm_usefulness: Number(row.llm_usefulness),
          llm_tags: row.llm_tags ? JSON.parse(row.llm_tags) : [],
          bm25_score:
            row.bm25_score !== null ? Number(row.bm25_score) : undefined,
          final_score:
            row.final_score !== null ? Number(row.final_score) : undefined,
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
 * Get the most recent created_at timestamp from Inoreader-sourced items in database.
 * Used by daily sync to determine the sync window for fetching newer items.
 *
 * Excludes research items (sourced from ADS, not Inoreader) because their
 * created_at reflects DB insertion time, not Inoreader crawl time. Including
 * them skews the sync window forward and causes the client-side filter to
 * discard all Inoreader items whose crawlTimeMsec is older.
 */
export async function getNewestItemTimestamp(): Promise<number | null> {
  try {

    

      const client = await getDbClient();
      const result = await client.query(
        `SELECT MAX(created_at) as max_created FROM items WHERE category != $1`,
        ["research"],
      );
      const val = result.rows[0]?.max_created;
      return typeof val === "number" ? val : null;
    

  } catch (error) {
    logger.warn("Failed to get newest item timestamp", { error });
    return null;
  }
}

/**
 * Get the most recent published_at timestamp from all items in database
 * Used by daily sync to fetch only newer items
 */
export async function getLastPublishedTimestamp(): Promise<number | null> {
  try {

    

      const client = await getDbClient();
      const result = await client.query(
        `SELECT MAX(published_at) as max_published FROM items`,
      );
      const val = result.rows[0]?.max_published;
      return typeof val === "number" ? val : null;
    

  } catch (error) {
    logger.warn("Failed to get last published timestamp", { error });
    return null;
  }
}

/**
 * Update cache metadata for items
 */
export async function updateItemsCacheMetadata(
  periodDays: number,
  count: number,
): Promise<void> {
  try {
    const client = await getDbClient();
    const cacheKey = `items_${periodDays}d`;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 1 * 3600;

    await client.run(
      `
      INSERT INTO cache_metadata (key, last_refresh_at, count, expires_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (key) DO UPDATE SET
        last_refresh_at = EXCLUDED.last_refresh_at,
        count = EXCLUDED.count,
        expires_at = EXCLUDED.expires_at
    `,
      [cacheKey, now, count, expiresAt],
    );

    logger.info(`Updated items cache metadata for ${periodDays}d period`);
  } catch (error) {
    logger.error("Failed to update items cache metadata", error);
    throw error;
  }
}

/**
 * Save full text for an item
 */
export async function saveFullText(
  itemId: string,
  fullText: string,
  source: "web_scrape" | "arxiv" | "ads_api" | "web_archive" | "error",
): Promise<void> {
  try {

    

      const client = await getDbClient();
      await client.run(
        `UPDATE items
         SET full_text = ?, full_text_fetched_at = EXTRACT(EPOCH FROM NOW())::INTEGER,
             full_text_source = ?, updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
         WHERE id = ?`,
        [fullText || null, source, itemId],
      );
    


    logger.info(
      `Saved full text for item ${itemId} (${fullText?.length || 0} chars, source: ${source})`,
    );
  } catch (error) {
    logger.error(`Failed to save full text for item ${itemId}`, error);
    throw error;
  }
}

/**
 * Load full text for an item
 */
export async function loadFullText(
  itemId: string,
): Promise<{ text: string; source: string } | null> {
  try {
      const client = await getDbClient();
      const result = await client.query(
        `SELECT full_text, full_text_source FROM items WHERE id = $1`,
        [itemId],
      );
      const row = result.rows[0] as
        | { full_text: string | null; full_text_source: string | null }
        | undefined;
      if (!row || !row.full_text) return null;
      return { text: row.full_text, source: row.full_text_source || "unknown" };
  } catch (error) {
    logger.error(`Failed to load full text for item ${itemId}`, error);
    return null;
  }
}

/**
 * Check how many items have cached full text
 */
export async function getFullTextCacheStats(): Promise<{
  total: number;
  cached: number;
  bySource: Record<string, number>;
}> {
  try {
      const client = await getDbClient();
      const [totalRes, cachedRes, bySourceRes] = await Promise.all([
        client.query(`SELECT COUNT(*) as count FROM items`),
        client.query(
          `SELECT COUNT(*) as count FROM items WHERE full_text IS NOT NULL`,
        ),
        client.query(
          `SELECT full_text_source, COUNT(*)::int as count FROM items
           WHERE full_text IS NOT NULL GROUP BY full_text_source`,
        ),
      ]);
      const total = Number((totalRes.rows[0] as { count: string | number }).count);
      const cached = Number((cachedRes.rows[0] as { count: string | number }).count);
      const bySource = bySourceRes.rows as Array<{
        full_text_source: string;
        count: number;
      }>;
      return {
        total,
        cached,
        bySource: Object.fromEntries(
          bySource.map((row) => [row.full_text_source, row.count]),
        ),
      };
  } catch (error) {
    logger.error("Failed to get full text cache stats", error);
    return { total: 0, cached: 0, bySource: {} };
  }
}

/**
 * Save extracted URL for an item (discovered via web search)
 */
export async function saveExtractedUrl(
  itemId: string,
  extractedUrl: string,
): Promise<void> {
  try {

    

      const client = await getDbClient();
      await client.run(
        `UPDATE items SET extracted_url = ?, updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?`,
        [extractedUrl, itemId],
      );
    


    logger.debug(`Saved extracted URL for item ${itemId}: ${extractedUrl}`);
  } catch (error) {
    logger.error(`Failed to save extracted URL for item ${itemId}`, error);
    throw error;
  }
}

/**
 * Save extracted URLs for multiple items
 */
export async function saveExtractedUrls(
  urlMap: Record<string, string>,
): Promise<void> {
  try {
    const client = await getDbClient();
    for (const [itemId, extractedUrl] of Object.entries(urlMap)) {
      await client.run(
        `UPDATE items
         SET extracted_url = $1,
             updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
         WHERE id = $2`,
        [extractedUrl, itemId],
      );
    }
    logger.info(`Saved extracted URLs for ${Object.keys(urlMap).length} items`);
  } catch (error) {
    logger.error("Failed to save extracted URLs", error);
    throw error;
  }
}

/**
 * Ensure an item exists in the database
 * If the item doesn't exist, creates a synthetic placeholder item
 */
export async function ensureItemExists(itemId: string): Promise<void> {
  try {
    const item = await loadItem(itemId);
    if (item) {
      return; // Item already exists
    }

    // Create a synthetic placeholder item
    const now = Math.floor(Date.now() / 1000);

    

      const client = await getDbClient();
      await client.run(
        `
        INSERT INTO items
        (id, stream_id, source_title, title, url, published_at, summary, content_snippet, categories, category, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO NOTHING
      `,
        [
          itemId,
          "synthetic",
          "Unknown",
          "Placeholder Item",
          "",
          now,
          null,
          null,
          "[]",
          "tech_articles",
          now,
        ],
      );
    


    logger.debug(`Created placeholder item for ${itemId}`);
  } catch (error) {
    logger.error(`Failed to ensure item exists: ${itemId}`, error);
    throw error;
  }
}

/**
 * Clear bad/invalid full text from an item (e.g., Inoreader login page)
 */
export async function clearBadFullText(itemId: string): Promise<void> {
  try {

    

      const client = await getDbClient();
      await client.run(
        `
        UPDATE items
        SET full_text = NULL,
            updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
        WHERE id = $1
      `,
        [itemId],
      );
    


    logger.info(`Cleared bad full text for item ${itemId}`);
  } catch (error) {
    logger.error(`Failed to clear bad full text for item ${itemId}`, error);
    throw error;
  }
}
