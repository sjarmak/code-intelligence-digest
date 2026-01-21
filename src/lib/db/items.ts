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
        const now = Math.floor(Date.now() / 1000);
        // Determine full_text_source based on item properties
        let fullTextSource: string | null = null;
        if (item.fullText) {
          if (item.category === 'research') {
            fullTextSource = 'ads_api';
          } else if (item.url?.includes('arxiv.org')) {
            fullTextSource = 'arxiv';
          } else {
            fullTextSource = 'web_scrape';
          }
        }

        await client.run(`
          INSERT INTO items
          (id, stream_id, source_title, title, url, author, published_at, created_at, summary, content_snippet, categories, category, full_text, full_text_fetched_at, full_text_source, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, EXTRACT(EPOCH FROM NOW())::INTEGER)
          ON CONFLICT (id) DO UPDATE SET
            stream_id = EXCLUDED.stream_id,
            source_title = EXCLUDED.source_title,
            title = EXCLUDED.title,
            url = EXCLUDED.url,
            author = EXCLUDED.author,
            published_at = EXCLUDED.published_at,
            created_at = COALESCE(EXCLUDED.created_at, items.created_at),
            summary = EXCLUDED.summary,
            content_snippet = EXCLUDED.content_snippet,
            categories = EXCLUDED.categories,
            category = EXCLUDED.category,
            full_text = COALESCE(EXCLUDED.full_text, items.full_text),
            full_text_fetched_at = COALESCE(EXCLUDED.full_text_fetched_at, items.full_text_fetched_at),
            full_text_source = COALESCE(EXCLUDED.full_text_source, items.full_text_source),
            updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
        `, [
          item.id,
          item.streamId,
          item.sourceTitle,
          item.title,
          item.url,
          item.author || null,
          Math.floor(item.publishedAt.getTime() / 1000),
          item.createdAt ? Math.floor(item.createdAt.getTime() / 1000) : Math.floor(item.publishedAt.getTime() / 1000),
          item.summary || null,
          item.contentSnippet || null,
          JSON.stringify(item.categories),
          item.category,
          item.fullText || null,
          item.fullText ? now : null,
          fullTextSource
        ]);
      }
    } else {
      const sqlite = getSqlite();

      const stmt = sqlite.prepare(`
        INSERT INTO items
        (id, stream_id, source_title, title, url, author, published_at, created_at, summary, content_snippet, categories, category, full_text, full_text_fetched_at, full_text_source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
        ON CONFLICT (id) DO UPDATE SET
          stream_id = EXCLUDED.stream_id,
          source_title = EXCLUDED.source_title,
          title = EXCLUDED.title,
          url = EXCLUDED.url,
          author = EXCLUDED.author,
          published_at = EXCLUDED.published_at,
          created_at = COALESCE(EXCLUDED.created_at, items.created_at),
          summary = EXCLUDED.summary,
          content_snippet = EXCLUDED.content_snippet,
          categories = EXCLUDED.categories,
          category = EXCLUDED.category,
          full_text = COALESCE(EXCLUDED.full_text, items.full_text),
          full_text_fetched_at = COALESCE(EXCLUDED.full_text_fetched_at, items.full_text_fetched_at),
          full_text_source = COALESCE(EXCLUDED.full_text_source, items.full_text_source),
          updated_at = strftime('%s', 'now')
      `);

      const insertMany = sqlite.transaction((items: FeedItem[]) => {
        for (const item of items) {
          const now = Math.floor(Date.now() / 1000);
          // Determine full_text_source based on item properties
          let fullTextSource: string | null = null;
          if (item.fullText) {
            if (item.category === 'research') {
              fullTextSource = 'ads_api';
            } else if (item.url?.includes('arxiv.org')) {
              fullTextSource = 'arxiv';
            } else {
              fullTextSource = 'web_scrape';
            }
          }

          stmt.run(
            item.id,
            item.streamId,
            item.sourceTitle,
            item.title,
            item.url,
            item.author || null,
            Math.floor(item.publishedAt.getTime() / 1000),
            item.createdAt ? Math.floor(item.createdAt.getTime() / 1000) : Math.floor(item.publishedAt.getTime() / 1000),
            item.summary || null,
            item.contentSnippet || null,
            JSON.stringify(item.categories),
            item.category,
            item.fullText || null,
            item.fullText ? now : null,
            fullTextSource
          );
        }
      });

      insertMany(items);
    }
    logger.info(`Saved ${items.length} items to database`);

    // Trigger async full text extraction for new items (background processing)
    if (process.env.ENABLE_AUTO_FULLTEXT !== 'false') {
      extractFullTextForNewItems(items).catch(error => {
        logger.error('Background full text extraction failed', { error });
      });
    }
  } catch (error) {
    logger.error("Failed to save items to database", error);
    throw error;
  }
}

/**
 * Load items for a given category within a time window
 *
 * For the "day" period (2 days), uses created_at instead of published_at
 * to show items added in the last 2 days, regardless of their original publication date.
 * This ensures decomposed newsletter articles appear in the daily view.
 */
export async function loadItemsByCategory(
  category: string,
  periodDays: number,
  limit?: number
): Promise<FeedItem[]> {
  try {
    const driver = detectDriver();
    const cutoffTime = Math.floor((Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000);

    // For "day" period, use created_at (when Inoreader received it) to show recently received items
    // For other periods, use published_at to show items by their original publication date
    // For newsletters: periodDays will be 1 (weekdays) or 2 (weekends)
    // For research and product_news: periodDays will be 3
    // Always use created_at for day period (periodDays <= 3) to show items by when Inoreader received them
    const useCreatedAt = periodDays <= 3;
    const dateColumn = useCreatedAt ? 'created_at' : 'published_at';

    // Calculate effective limit based on period
    // For "all" (60d): limit to 500 most recent items per category
    // For "month" (30d): limit to 300
    // For "week"/"day": no limit (naturally small)
    const effectiveLimit = limit ?? (
      periodDays >= 60 ? 500 :
      periodDays >= 30 ? 300 :
      undefined
    );

    let rows: Array<{
      id: string;
      stream_id: string;
      source_title: string;
      title: string;
      url: string;
      author: string | null;
      published_at: number;
      created_at: number;
      summary: string | null;
      content_snippet: string | null;
      categories: string;
      category: string;
      full_text: string | null;
      extracted_url: string | null;
    }>;

    if (driver === 'postgres') {
      const client = await getDbClient();
      const limitClause = effectiveLimit ? `LIMIT $3` : '';
      const params = effectiveLimit
        ? [category, cutoffTime, effectiveLimit]
        : [category, cutoffTime];

      const result = await client.query(
        `SELECT id, stream_id, source_title, title, url, author, published_at, created_at,
                summary, content_snippet, categories, category, full_text, extracted_url
         FROM items
         WHERE category = $1 AND ${dateColumn} >= $2
         ORDER BY ${dateColumn} DESC ${limitClause}`,
        params
      );
      rows = result.rows as typeof rows;
    } else {
      const sqlite = getSqlite();
      const limitClause = effectiveLimit ? `LIMIT ${effectiveLimit}` : '';
      const query = `SELECT * FROM items
           WHERE category = ? AND ${dateColumn} >= ?
           ORDER BY ${dateColumn} DESC ${limitClause}`;
      logger.debug(`[loadItemsByCategory] SQLite query: category='${category}', cutoffTime=${cutoffTime}, dateColumn=${dateColumn}, limit=${effectiveLimit || 'none'}`);
      rows = sqlite.prepare(query).all(category, cutoffTime) as typeof rows;
      logger.info(`[loadItemsByCategory] SQLite returned ${rows.length} rows for category='${category}', periodDays=${periodDays}, cutoffTime=${cutoffTime} (${new Date(cutoffTime * 1000).toISOString()})`);

      // Verify the query is correct by doing a direct count
      const verifyCount = sqlite.prepare(`SELECT COUNT(*) as count FROM items WHERE category = ? AND ${dateColumn} >= ?`).get(category, cutoffTime) as { count: number };
      if (rows.length !== verifyCount.count) {
        logger.error(`[loadItemsByCategory] MISMATCH: rows.length=${rows.length} but COUNT query returns ${verifyCount.count}`);
      }
    }

    const items: FeedItem[] = [];
    let errorCount = 0;

    logger.info(`[loadItemsByCategory] Starting to map ${rows.length} rows`);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const cat = row.category as Category;
        const finalUrl = (row.url && !row.url.includes("inoreader.com"))
          ? row.url
          : (row.extracted_url || row.url);
        items.push({
          id: row.id,
          streamId: row.stream_id,
          sourceTitle: row.source_title,
          title: row.title,
          url: finalUrl,
          author: row.author || undefined,
          publishedAt: new Date(row.published_at * 1000),
          createdAt: new Date(row.created_at * 1000),
          summary: row.summary || undefined,
          contentSnippet: row.content_snippet || undefined,
          categories: JSON.parse(row.categories),
          category: cat,
          raw: {},
          fullText: row.full_text || undefined,
        });
      } catch (error) {
        errorCount++;
        if (errorCount <= 3) {
          logger.error(`[loadItemsByCategory] Error mapping row ${i}/${rows.length} (id: ${row.id}): ${error}`, { row: { id: row.id, category: row.category, title: row.title?.substring(0, 50) } });
        }
      }
    }

    logger.info(`[loadItemsByCategory] Mapped ${items.length} items from ${rows.length} rows (${errorCount} errors)`);

    if (errorCount > 0) {
      logger.error(`[loadItemsByCategory] Failed to map ${errorCount} rows out of ${rows.length} - this is a critical issue!`);
    }

    if (items.length !== rows.length && errorCount === 0) {
      logger.error(`[loadItemsByCategory] CRITICAL: items.length (${items.length}) !== rows.length (${rows.length}) but no errors were thrown!`);
    }

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
 * Load items for a given category within a custom date range
 */
export async function loadItemsByCategoryWithDateRange(
  category: string,
  startDate: Date,
  endDate: Date
): Promise<FeedItem[]> {
  try {
    const driver = detectDriver();
    const startTime = Math.floor(startDate.getTime() / 1000);
    const endTime = Math.floor(endDate.getTime() / 1000);

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
         WHERE category = $1 AND published_at >= $2 AND published_at <= $3
         ORDER BY published_at DESC`,
        [category, startTime, endTime]
      );
      rows = result.rows as typeof rows;
    } else {
      const sqlite = getSqlite();
      rows = sqlite
        .prepare(
          `SELECT * FROM items
           WHERE category = ? AND published_at >= ? AND published_at <= ?
           ORDER BY published_at DESC`
        )
        .all(category, startTime, endTime) as typeof rows;
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
      `Failed to load items for category ${category} with date range ${startDate.toISOString()} to ${endDate.toISOString()}`,
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
      full_text: string | null;
    };

    let row: ItemRow | undefined;

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(
        `SELECT id, stream_id, source_title, title, url, author, published_at,
                summary, content_snippet, categories, category, extracted_url, full_text
         FROM items WHERE id = $1`,
        [itemId]
      );
      const rawRow = result.rows[0] as Record<string, unknown> | undefined;
      // Explicitly map the row to ensure full_text is preserved
      // CRITICAL: Handle PostgreSQL TEXT columns which may be returned as strings, null, or objects
      if (rawRow) {
        let fullTextValue: string | null = null;
        const rawFullText = rawRow['full_text'] ?? rawRow.full_text;

        // Handle null/undefined first (typeof null === 'object' in JavaScript!)
        if (rawFullText === null || rawFullText === undefined) {
          fullTextValue = null;
        } else if (typeof rawFullText === 'string') {
          // Already a string, use it directly
          fullTextValue = rawFullText.length > 0 ? rawFullText : null;
        } else {
          // PostgreSQL TEXT columns can be returned as objects (Buffers, etc.)
          // Convert to string using toString() or String()
          try {
            if (typeof rawFullText === 'object' && rawFullText !== null) {
              // Check if it's a Buffer-like object
              if ('toString' in rawFullText && typeof rawFullText.toString === 'function') {
                const converted = rawFullText.toString();
                fullTextValue = converted.length > 0 ? converted : null;
              } else {
                const converted = String(rawFullText);
                fullTextValue = converted.length > 0 && converted !== 'null' ? converted : null;
              }
            } else {
              const converted = String(rawFullText);
              fullTextValue = converted.length > 0 && converted !== 'null' ? converted : null;
            }
          } catch (e) {
            fullTextValue = null;
          }
        }
        row = {
          id: rawRow.id as string,
          stream_id: rawRow.stream_id as string,
          source_title: rawRow.source_title as string,
          title: rawRow.title as string,
          url: rawRow.url as string,
          author: rawRow.author as string | null,
          published_at: rawRow.published_at as number,
          summary: rawRow.summary as string | null,
          content_snippet: rawRow.content_snippet as string | null,
          categories: rawRow.categories as string,
          category: rawRow.category as string,
          extracted_url: rawRow.extracted_url as string | null,
          full_text: fullTextValue,
        } as ItemRow;
      } else {
        row = undefined;
      }
    } else {
      const sqlite = getSqlite();
      // CRITICAL FIX: Use explicit column selection and access raw row properties directly
      // better-sqlite3 returns column names exactly as they appear in the SELECT
      const rawRow = sqlite.prepare(`SELECT id, stream_id, source_title, title, url, author, published_at, created_at, summary, content_snippet, categories, category, extracted_url, full_text, full_text_fetched_at, full_text_source FROM items WHERE id = ?`).get(itemId) as Record<string, unknown> | undefined;

      // Map raw row to ItemRow, ensuring full_text is properly extracted
      if (rawRow) {
        // CRITICAL: Extract full_text using multiple methods to ensure we get it
        const fullTextValue = rawRow['full_text'] ?? rawRow.full_text ?? null;

        row = {
          id: rawRow.id as string,
          stream_id: rawRow.stream_id as string,
          source_title: rawRow.source_title as string,
          title: rawRow.title as string,
          url: rawRow.url as string,
          author: rawRow.author as string | null,
          published_at: rawRow.published_at as number,
          summary: rawRow.summary as string | null,
          content_snippet: rawRow.content_snippet as string | null,
          categories: rawRow.categories as string,
          category: rawRow.category as string,
          extracted_url: rawRow.extracted_url as string | null,
          full_text: typeof fullTextValue === 'string' && fullTextValue.length > 0 ? fullTextValue : (fullTextValue === null ? null : (typeof fullTextValue === 'string' ? fullTextValue : null)), // Ensure we preserve the value
        } as ItemRow;
      } else {
        row = undefined;
      }
    }

    if (!row) {
      return null;
    }

    const category = row.category as Category;
    const finalUrl = (row.url && !row.url.includes("inoreader.com"))
      ? row.url
      : (row.extracted_url || row.url);
    let parsedCategories: string[];
    try {
      parsedCategories = JSON.parse(row.categories);
    } catch (e) {
      parsedCategories = ['research']; // Default for synthetic items
    }
    const feedItem = {
      id: row.id,
      streamId: row.stream_id,
      sourceTitle: row.source_title,
      title: row.title,
      url: finalUrl,
      author: row.author || undefined,
      publishedAt: new Date(row.published_at * 1000),
      createdAt: new Date(row.published_at * 1000), // Use published_at as fallback
      summary: row.summary || undefined,
      contentSnippet: row.content_snippet || undefined,
      fullText: (row.full_text && typeof row.full_text === 'string' && row.full_text.length > 0) ? row.full_text : undefined,
      categories: parsedCategories,
      category,
      raw: {},
    };
    return feedItem;
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
): Promise<Record<string, { llm_relevance: number; llm_usefulness: number; llm_tags: string[]; bm25_score?: number; recency_score?: number; final_score?: number }>> {
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
      bm25_score?: number;
      recency_score?: number;
      final_score?: number;
    };

    let rows: ScoreRow[];

    if (driver === 'postgres') {
      const client = await getDbClient();
      const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(',');
      // For Postgres, use DISTINCT ON to get latest score per item
      // DISTINCT ON requires the column to be first in ORDER BY
      const result = await client.query(
        `SELECT DISTINCT ON (item_id) item_id, llm_relevance, llm_usefulness, llm_tags, bm25_score, recency_score, final_score
         FROM item_scores
         WHERE item_id IN (${placeholders})
         ORDER BY item_id, scored_at DESC`,
        itemIds
      );
      rows = result.rows as ScoreRow[];
    } else {
      const sqlite = getSqlite();
      const placeholders = itemIds.map(() => "?").join(",");
      // Get latest scores for each item (ORDER BY scored_at DESC, then deduplicate by item_id)
      rows = sqlite
        .prepare(
          `SELECT item_id, llm_relevance, llm_usefulness, llm_tags, bm25_score, recency_score, final_score
           FROM item_scores
           WHERE item_id IN (${placeholders})
           ORDER BY scored_at DESC`
        )
        .all(...itemIds) as ScoreRow[];
    }

    const scores: Record<string, { llm_relevance: number; llm_usefulness: number; llm_tags: string[]; bm25_score?: number; recency_score?: number; final_score?: number }> = {};
    const seen = new Set<string>();

    for (const row of rows) {
      if (!seen.has(row.item_id)) {
        seen.add(row.item_id);
        scores[row.item_id] = {
          llm_relevance: Number(row.llm_relevance),
          llm_usefulness: Number(row.llm_usefulness),
          llm_tags: row.llm_tags ? JSON.parse(row.llm_tags) : [],
          bm25_score: row.bm25_score !== undefined ? Number(row.bm25_score) : undefined,
          recency_score: row.recency_score !== undefined ? Number(row.recency_score) : undefined,
          final_score: row.final_score !== undefined ? Number(row.final_score) : undefined,
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
 * Get the earliest published date from the database
 * Returns a Date object or null if no items exist
 */
export async function getEarliestPublishedDate(): Promise<Date | null> {
  try {
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(`SELECT MIN(published_at) as min_published FROM items`);
      const val = result.rows[0]?.min_published;
      if (typeof val === 'number') {
        return new Date(val * 1000);
      }
      return null;
    } else {
      const sqlite = getSqlite();
      const result = sqlite
        .prepare(`SELECT MIN(published_at) as min_published FROM items`)
        .get() as { min_published: number | null } | undefined;
      if (result?.min_published) {
        return new Date(result.min_published * 1000);
      }
      return null;
    }
  } catch (error) {
    logger.warn("Failed to get earliest published date", { error });
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
 * Background full text extraction for new items
 * Runs asynchronously after items are saved
 */
async function extractFullTextForNewItems(items: FeedItem[]): Promise<void> {
  // Only extract if enabled
  if (process.env.ENABLE_AUTO_FULLTEXT === 'false') {
    return;
  }

  // Filter items that need full text
  const needsText = items.filter(item =>
    !item.fullText || (item.fullText?.length ?? 0) < 100
  );

  if (needsText.length === 0) {
    return;
  }

  logger.info(`[AUTO-FULLTEXT] Extracting full text for ${needsText.length} items`);

  try {
    // Import here to avoid circular dependencies
    const { fetchFullTextBatch } = await import('../pipeline/fulltext');

    // Process in small batches to avoid overwhelming
    const batchSize = parseInt(process.env.FULLTEXT_BATCH_SIZE || '10', 10);
    const maxConcurrent = parseInt(process.env.FULLTEXT_MAX_CONCURRENT || '3', 10);

    for (let i = 0; i < needsText.length; i += batchSize) {
      const batch = needsText.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(needsText.length / batchSize);

      logger.info(`[AUTO-FULLTEXT] Processing batch ${batchNum}/${totalBatches} (${batch.length} items)`);

      const results = await fetchFullTextBatch(batch, maxConcurrent);

      // Save results
      for (const [itemId, result] of results.entries()) {
        if (result.source !== 'error' && result.text.length > 100) {
          await saveFullText(itemId, result.text, result.source);
        }
      }

      // Rate limit between batches
      if (i + batchSize < needsText.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    logger.info(`[AUTO-FULLTEXT] Completed extraction for ${needsText.length} items`);
  } catch (error) {
    logger.error('[AUTO-FULLTEXT] Background extraction failed', { error });
    // Don't throw - this is background processing
  }
}

/**
 * Clear bad cached full text (e.g., Inoreader login page content)
 */
export async function clearBadFullText(itemId: string): Promise<void> {
  try {
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      await client.run(`
        UPDATE items
        SET full_text = NULL,
            full_text_fetched_at = NULL,
            full_text_source = NULL,
            updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
        WHERE id = $1
      `, [itemId]);
    } else {
      const sqlite = getSqlite();
      sqlite.prepare(`
        UPDATE items
        SET full_text = NULL,
            full_text_fetched_at = NULL,
            full_text_source = NULL,
            updated_at = strftime('%s', 'now')
        WHERE id = ?
      `).run(itemId);
    }

    logger.info(`Cleared bad cached full text for item ${itemId}`);
  } catch (error) {
    logger.error(`Failed to clear bad full text for item ${itemId}`, { error });
    throw error;
  }
}

/**
 * Save full text for an item
 * Validates that full text doesn't contain Inoreader login page content
 */
export async function saveFullText(
  itemId: string,
  fullText: string,
  source: "web_scrape" | "arxiv" | "ads_api" | "error"
): Promise<void> {
  // Don't save if full text contains Inoreader login page content
  if (fullText && (fullText.includes('Sign in | Inoreader') || fullText.includes('inoreader-logo'))) {
    logger.warn(`Rejecting full text for item ${itemId} - contains Inoreader login page content`);
    return; // Don't save bad content
  }

  try {
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      await client.run(`
        UPDATE items
        SET full_text = $1,
            full_text_fetched_at = EXTRACT(EPOCH FROM NOW())::INTEGER,
            full_text_source = $2,
            updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
        WHERE id = $3
      `, [fullText || null, source, itemId]);
    } else {
      const sqlite = getSqlite();
      sqlite.prepare(`
        UPDATE items
        SET full_text = ?,
            full_text_fetched_at = strftime('%s', 'now'),
            full_text_source = ?,
            updated_at = strftime('%s', 'now')
        WHERE id = ?
      `).run(fullText || null, source, itemId);
    }

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
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      await client.run(`
        UPDATE items
        SET extracted_url = $1,
            updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
        WHERE id = $2
      `, [extractedUrl, itemId]);
    } else {
      const sqlite = getSqlite();
      sqlite.prepare(`
        UPDATE items
        SET extracted_url = ?,
            updated_at = strftime('%s', 'now')
        WHERE id = ?
      `).run(extractedUrl, itemId);
    }

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

/**
 * Ensure an item exists in the items table
 * For synthetic itemIds (ads:bibcode), creates a minimal item from ADS papers table
 */
export async function ensureItemExists(itemId: string): Promise<void> {
  // Check if item already exists
  const driver = detectDriver();
  let exists = false;

  if (driver === 'postgres') {
    const client = await getDbClient();
    const result = await client.query(
      'SELECT 1 FROM items WHERE id = $1 LIMIT 1',
      [itemId]
    );
    exists = result.rows.length > 0;
  } else {
    const sqlite = getSqlite();
    const result = sqlite.prepare('SELECT 1 FROM items WHERE id = ? LIMIT 1').get(itemId);
    exists = !!result;
  }

  if (exists) {
    return; // Item already exists
  }

  // For synthetic itemIds (ads:bibcode), try to create from ADS papers
  if (itemId.startsWith('ads:')) {
    const bibcode = itemId.substring(4); // Remove 'ads:' prefix
    await createItemFromBibcode(bibcode, itemId);
  }
}

/**
 * Create a minimal item from a bibcode using ADS papers table
 */
async function createItemFromBibcode(bibcode: string, itemId: string): Promise<void> {
  try {
    const driver = detectDriver();
    const now = Math.floor(Date.now() / 1000);

    if (driver === 'postgres') {
      const client = await getDbClient();
      // Try to get paper metadata from ads_papers
      const paperResult = await client.query(
        'SELECT title, arxiv_url, ads_url, pubdate, abstract FROM ads_papers WHERE bibcode = $1 LIMIT 1',
        [bibcode]
      );

      if (paperResult.rows.length > 0) {
        const paper = paperResult.rows[0] as {
          title?: string;
          arxiv_url?: string;
          ads_url?: string;
          pubdate?: string;
          abstract?: string;
        };

        const url = paper.arxiv_url || paper.ads_url || `https://ui.adsabs.harvard.edu/abs/${bibcode}`;
        const title = paper.title || bibcode;
        // Parse pubdate safely - handle various formats and invalid dates
        let publishedAt = now;
        if (paper.pubdate) {
          try {
            const date = new Date(paper.pubdate);
            if (!isNaN(date.getTime())) {
              publishedAt = date.getTime() / 1000;
            }
          } catch (e) {
            // Invalid date format, use current time
          }
        }

        // Create minimal item
        await client.run(`
          INSERT INTO items
          (id, stream_id, source_title, title, url, published_at, created_at, summary, categories, category, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $7)
          ON CONFLICT (id) DO NOTHING
        `, [
          itemId,
          'ads:research', // Synthetic stream ID
          'ADS Research Library',
          title,
          url,
          Math.floor(publishedAt),
          now,
          paper.abstract || null,
          JSON.stringify(['research']),
          'research'
        ]);
      } else {
        // Paper not in database, create minimal item with just bibcode
        const url = `https://ui.adsabs.harvard.edu/abs/${bibcode}`;
        await client.run(`
          INSERT INTO items
          (id, stream_id, source_title, title, url, published_at, created_at, categories, category, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $7)
          ON CONFLICT (id) DO NOTHING
        `, [
          itemId,
          'ads:research',
          'ADS Research Library',
          bibcode,
          url,
          now,
          now,
          JSON.stringify(['research']),
          'research'
        ]);
      }
    } else {
      const sqlite = getSqlite();
      // Try to get paper metadata from ads_papers
      const paper = sqlite.prepare(
        'SELECT title, arxiv_url, ads_url, pubdate, abstract FROM ads_papers WHERE bibcode = ? LIMIT 1'
      ).get(bibcode) as {
        title?: string;
        arxiv_url?: string;
        ads_url?: string;
        pubdate?: string;
        abstract?: string;
      } | undefined;

      if (paper) {
        const url = paper.arxiv_url || paper.ads_url || `https://ui.adsabs.harvard.edu/abs/${bibcode}`;
        const title = paper.title || bibcode;
        // Parse pubdate safely - handle various formats and invalid dates
        let publishedAt = now;
        if (paper.pubdate) {
          try {
            const date = new Date(paper.pubdate);
            if (!isNaN(date.getTime())) {
              publishedAt = date.getTime() / 1000;
            }
          } catch (e) {
            // Invalid date format, use current time
          }
        }

        sqlite.prepare(`
          INSERT INTO items
          (id, stream_id, source_title, title, url, published_at, created_at, summary, categories, category, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO NOTHING
        `).run(
          itemId,
          'ads:research',
          'ADS Research Library',
          title,
          url,
          Math.floor(publishedAt),
          now,
          paper.abstract || null,
          JSON.stringify(['research']),
          'research',
          now
        );
      } else {
        // Paper not in database, create minimal item
        const url = `https://ui.adsabs.harvard.edu/abs/${bibcode}`;
        sqlite.prepare(`
          INSERT INTO items
          (id, stream_id, source_title, title, url, published_at, created_at, categories, category, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO NOTHING
        `).run(
          itemId,
          'ads:research',
          'ADS Research Library',
          bibcode,
          url,
          now,
          now,
          JSON.stringify(['research']),
          'research',
          now
        );
      }
    }

    logger.debug(`Created synthetic item ${itemId} from bibcode ${bibcode}`);
  } catch (error) {
    logger.error(`Failed to create item from bibcode ${bibcode}`, error);
    // Don't throw - allow the operation to continue even if item creation fails
    // The foreign key constraint will catch it if needed
  }
}

/**
 * Get the timestamp of the newest item in the database (based on created_at).
 * This is used to determine the sync window - we only need to fetch items
 * newer than this timestamp to avoid gaps when syncs are delayed.
 *
 * Returns null if no items exist (first sync).
 */
export async function getNewestItemTimestamp(): Promise<number | null> {
  try {
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(
        'SELECT MAX(created_at) as newest FROM items'
      );
      const row = result.rows[0] as { newest: number | null } | undefined;
      return row?.newest ?? null;
    } else {
      const sqlite = getSqlite();
      const result = sqlite.prepare('SELECT MAX(created_at) as newest FROM items').get() as { newest: number | null } | undefined;
      return result?.newest ?? null;
    }
  } catch (error) {
    logger.error('Failed to get newest item timestamp', error);
    return null;
  }
}
