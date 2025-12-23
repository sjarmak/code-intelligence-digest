/**
 * Item database operations
 */

import { getSqlite } from "./index";
import { getDbClient, detectDriver } from "./driver";
import { FeedItem } from "../model";
import type { Category } from "../model";
import { logger } from "../logger";

/**
 * Save items to database
 */
export async function saveItems(items: FeedItem[]): Promise<void> {
  try {
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      for (const item of items) {
        await client.run(`
          INSERT INTO items
          (id, stream_id, source_title, title, url, author, published_at, summary, content_snippet, categories, category, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, EXTRACT(EPOCH FROM NOW())::INTEGER)
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
            updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
        `, [
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
          item.category
        ]);
      }
    } else {
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
            Math.floor(item.publishedAt.getTime() / 1000),
            item.summary || null,
            item.contentSnippet || null,
            JSON.stringify(item.categories),
            item.category
          );
        }
      });

      insertMany(items);
    }
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
    const driver = detectDriver();
    const cutoffTime = Math.floor((Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000);

    let rows: Array<{
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
    }>;

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(
        `SELECT id, stream_id, source_title, title, url, author, published_at,
                summary, content_snippet, categories, category, full_text, extracted_url
         FROM items
         WHERE category = $1 AND published_at >= $2
         ORDER BY published_at DESC`,
        [category, cutoffTime]
      );
      rows = result.rows as typeof rows;
    } else {
      const sqlite = getSqlite();
      rows = sqlite
        .prepare(
          `SELECT * FROM items
           WHERE category = ? AND published_at >= ?
           ORDER BY published_at DESC`
        )
        .all(category, cutoffTime) as typeof rows;
    }

    const items: FeedItem[] = rows.map((row) => {
      const cat = row.category as Category;
      const finalUrl = (row.url && !row.url.includes("inoreader.com"))
        ? row.url
        : (row.extracted_url || row.url);
      return {
        id: row.id,
        streamId: row.stream_id,
        sourceTitle: row.source_title,
        title: row.title,
        url: finalUrl,
        author: row.author || undefined,
        publishedAt: new Date(row.published_at * 1000),
        summary: row.summary || undefined,
        contentSnippet: row.content_snippet || undefined,
        categories: JSON.parse(row.categories),
        category: cat,
        raw: {},
        fullText: row.full_text || undefined,
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
 * Load all items from database (for batch processing)
 */
export async function loadAllItems(limit?: number): Promise<FeedItem[]> {
  try {
    const driver = detectDriver();

    let rows: Array<{
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
    }>;

    if (driver === 'postgres') {
      const client = await getDbClient();
      const limitClause = limit ? `LIMIT ${limit}` : '';
      const result = await client.query(
        `SELECT id, stream_id, source_title, title, url, author, published_at,
                summary, content_snippet, categories, category, full_text, extracted_url
         FROM items
         ORDER BY published_at DESC
         ${limitClause}`
      );
      rows = result.rows as typeof rows;
    } else {
      const sqlite = getSqlite();
      if (limit) {
        rows = sqlite
          .prepare(
            `SELECT * FROM items
             ORDER BY published_at DESC
             LIMIT ?`
          )
          .all(limit) as typeof rows;
      } else {
        rows = sqlite
          .prepare(
            `SELECT * FROM items
             ORDER BY published_at DESC`
          )
          .all() as typeof rows;
      }
    }

    const items: FeedItem[] = rows.map((row) => {
      const cat = row.category as Category;
      const finalUrl = (row.url && !row.url.includes("inoreader.com"))
        ? row.url
        : (row.extracted_url || row.url);
      return {
        id: row.id,
        streamId: row.stream_id,
        sourceTitle: row.source_title,
        title: row.title,
        url: finalUrl,
        author: row.author || undefined,
        publishedAt: new Date(row.published_at * 1000),
        summary: row.summary || undefined,
        contentSnippet: row.content_snippet || undefined,
        categories: JSON.parse(row.categories),
        category: cat,
        raw: {},
        fullText: row.full_text || undefined,
      };
    });

    return items;
  } catch (error) {
    logger.error('Failed to load all items', error);
    throw error;
  }
}

/**
 * Load a single item by ID
 */
export async function loadItem(itemId: string): Promise<FeedItem | null> {
  try {
    const driver = detectDriver();

    type ItemRow = {
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
      extracted_url: string | null;
    };

    let row: ItemRow | undefined;

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(
        `SELECT id, stream_id, source_title, title, url, author, published_at,
                summary, content_snippet, categories, category, extracted_url
         FROM items WHERE id = $1`,
        [itemId]
      );
      row = result.rows[0] as ItemRow | undefined;
    } else {
      const sqlite = getSqlite();
      row = sqlite
        .prepare(`SELECT * FROM items WHERE id = ?`)
        .get(itemId) as ItemRow | undefined;
    }

    if (!row) {
      return null;
    }

    const category = row.category as Category;
    const finalUrl = (row.url && !row.url.includes("inoreader.com"))
      ? row.url
      : (row.extracted_url || row.url);
    return {
      id: row.id,
      streamId: row.stream_id,
      sourceTitle: row.source_title,
      title: row.title,
      url: finalUrl,
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
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(`SELECT COUNT(*) as count FROM items`);
      return Number(result.rows[0]?.count ?? 0);
    } else {
      const sqlite = getSqlite();
      const result = sqlite.prepare(`SELECT COUNT(*) as count FROM items`).get() as { count: number } | undefined;
      return result?.count ?? 0;
    }
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
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(
        `SELECT COUNT(*) as count FROM items WHERE category = $1`,
        [category]
      );
      return Number(result.rows[0]?.count ?? 0);
    } else {
      const sqlite = getSqlite();
      const result = sqlite
        .prepare(`SELECT COUNT(*) as count FROM items WHERE category = ?`)
        .get(category) as { count: number } | undefined;
      return result?.count ?? 0;
    }
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

    const driver = detectDriver();

    type ScoreRow = {
      item_id: string;
      llm_relevance: number;
      llm_usefulness: number;
      llm_tags: string | null;
    };

    let rows: ScoreRow[];

    if (driver === 'postgres') {
      const client = await getDbClient();
      const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await client.query(
        `SELECT item_id, llm_relevance, llm_usefulness, llm_tags
         FROM item_scores
         WHERE item_id IN (${placeholders})
         ORDER BY scored_at ASC`,
        itemIds
      );
      rows = result.rows as ScoreRow[];
    } else {
      const sqlite = getSqlite();
      const placeholders = itemIds.map(() => "?").join(",");
      rows = sqlite
        .prepare(
          `SELECT item_id, llm_relevance, llm_usefulness, llm_tags
           FROM item_scores
           WHERE item_id IN (${placeholders})
           ORDER BY scored_at ASC`
        )
        .all(...itemIds) as ScoreRow[];
    }

    const scores: Record<string, { llm_relevance: number; llm_usefulness: number; llm_tags: string[] }> = {};
    const seen = new Set<string>();

    for (const row of rows) {
      if (!seen.has(row.item_id)) {
        seen.add(row.item_id);
        scores[row.item_id] = {
          llm_relevance: Number(row.llm_relevance),
          llm_usefulness: Number(row.llm_usefulness),
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
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(`SELECT MAX(published_at) as max_published FROM items`);
      const val = result.rows[0]?.max_published;
      return typeof val === 'number' ? val : null;
    } else {
      const sqlite = getSqlite();
      const result = sqlite
        .prepare(`SELECT MAX(published_at) as max_published FROM items`)
        .get() as { max_published: number | null } | undefined;
      return result?.max_published ?? null;
    }
  } catch (error) {
    logger.warn("Failed to get last published timestamp", { error });
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

/**
 * Save full text for an item
 */
export async function saveFullText(
  itemId: string,
  fullText: string,
  source: "web_scrape" | "arxiv" | "error"
): Promise<void> {
  try {
    const sqlite = getSqlite();

    sqlite.prepare(`
      UPDATE items
      SET full_text = ?,
          full_text_fetched_at = strftime('%s', 'now'),
          full_text_source = ?,
          updated_at = strftime('%s', 'now')
      WHERE id = ?
    `).run(fullText || null, source, itemId);

    logger.info(`Saved full text for item ${itemId} (${fullText?.length || 0} chars, source: ${source})`);
  } catch (error) {
    logger.error(`Failed to save full text for item ${itemId}`, error);
    throw error;
  }
}

/**
 * Load full text for an item
 */
export async function loadFullText(itemId: string): Promise<{ text: string; source: string } | null> {
  try {
    const sqlite = getSqlite();

    const row = sqlite
      .prepare(`SELECT full_text, full_text_source FROM items WHERE id = ?`)
      .get(itemId) as { full_text: string | null; full_text_source: string | null } | undefined;

    if (!row || !row.full_text) {
      return null;
    }

    return {
      text: row.full_text,
      source: row.full_text_source || "unknown",
    };
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
    const sqlite = getSqlite();

    const total = (
      sqlite.prepare(`SELECT COUNT(*) as count FROM items`).get() as { count: number }
    ).count;

    const cached = (
      sqlite
        .prepare(`SELECT COUNT(*) as count FROM items WHERE full_text IS NOT NULL`)
        .get() as { count: number }
    ).count;

    const bySource = sqlite
      .prepare(
        `SELECT full_text_source, COUNT(*) as count FROM items
         WHERE full_text IS NOT NULL GROUP BY full_text_source`
      )
      .all() as Array<{ full_text_source: string; count: number }>;

    return {
      total,
      cached,
      bySource: Object.fromEntries(bySource.map(row => [row.full_text_source, row.count])),
    };
  } catch (error) {
    logger.error("Failed to get full text cache stats", error);
    return { total: 0, cached: 0, bySource: {} };
  }
}

/**
 * Save extracted URL for an item (discovered via web search)
 */
export async function saveExtractedUrl(itemId: string, extractedUrl: string): Promise<void> {
  try {
    const sqlite = getSqlite();

    sqlite.prepare(`
      UPDATE items
      SET extracted_url = ?,
          updated_at = strftime('%s', 'now')
      WHERE id = ?
    `).run(extractedUrl, itemId);

    logger.debug(`Saved extracted URL for item ${itemId}: ${extractedUrl}`);
  } catch (error) {
    logger.error(`Failed to save extracted URL for item ${itemId}`, error);
    throw error;
  }
}

/**
 * Save extracted URLs for multiple items
 */
export async function saveExtractedUrls(urlMap: Record<string, string>): Promise<void> {
  try {
    const sqlite = getSqlite();
    const stmt = sqlite.prepare(`
      UPDATE items
      SET extracted_url = ?,
          updated_at = strftime('%s', 'now')
      WHERE id = ?
    `);

    const updateMany = sqlite.transaction((urlMap: Record<string, string>) => {
      for (const [itemId, url] of Object.entries(urlMap)) {
        stmt.run(url, itemId);
      }
    });

    updateMany(urlMap);
    logger.info(`Saved extracted URLs for ${Object.keys(urlMap).length} items`);
  } catch (error) {
    logger.error("Failed to save extracted URLs", error);
    throw error;
  }
}
