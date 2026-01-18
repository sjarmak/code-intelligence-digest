/**
 * GET /api/items?category=tech_articles&period=week
 * Returns ranked items for a specific category and time period
 */

import { NextRequest, NextResponse } from "next/server";
import { loadItemsByCategoryWithDateRange } from "@/src/lib/db/items";
import { initializeDatabase } from "@/src/lib/db/index";
import { getDbClient } from "@/src/lib/db/driver";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { selectWithDiversity } from "@/src/lib/pipeline/select";
import { Category, FeedItem } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";
import { getCategoryConfig } from "@/src/config/categories";
import { PERIOD_CONFIG } from "@/src/config/periods";
import { decodeHtmlEntities } from "@/src/lib/utils/html-entities";

// Local auto-catchup sync (dev-only)
// If the local DB is stale (no items within requested time window),
// kick off an async catch-up sync so the UI becomes "self-healing".
let autoCatchupInFlight = false;
let lastAutoCatchupAttemptAtMs = 0;
const AUTO_CATCHUP_COOLDOWN_MS = 10 * 60 * 1000;
const AUTO_CATCHUP_LOOKBACK_DAYS = 30;

async function maybeKickoffLocalCatchupSync(args: {
  category: Category;
  period: string;
  reason: "cutoff_fallback" | "no_items_in_window";
  maxTimestampISO: string | null;
}) {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  if (nodeEnv === "production") return;

  const localUrl = process.env.LOCAL_DATABASE_URL;
  if (!localUrl?.startsWith("postgres")) return;

  let host: string | null = null;
  let port: string | null = null;
  try {
    const u = new URL(localUrl);
    host = u.hostname;
    port = u.port || null;
  } catch {
    // ignore
  }

  const isLocalHost =
    host === "localhost" || host === "127.0.0.1" || host?.endsWith(".local") === true;
  if (!isLocalHost) return;

  const nowMs = Date.now();
  const cooldownRemainingMs = Math.max(
    0,
    AUTO_CATCHUP_COOLDOWN_MS - (nowMs - lastAutoCatchupAttemptAtMs)
  );

  if (autoCatchupInFlight) return;
  if (cooldownRemainingMs > 0) return;

  autoCatchupInFlight = true;
  lastAutoCatchupAttemptAtMs = nowMs;

  logger.info("[AUTO-CATCHUP] starting prod->local sync", {
    category: args.category,
    period: args.period,
    reason: args.reason,
    maxTimestampISO: args.maxTimestampISO,
    host,
    port,
  });

  // Fire-and-forget; never block /api/items on sync
  void (async () => {
    try {
      const { syncProdToLocalPostgres } = await import("@/src/lib/db/sync-prod-to-local");
      const result = await syncProdToLocalPostgres(AUTO_CATCHUP_LOOKBACK_DAYS);
      logger.info("[AUTO-CATCHUP] prod->local sync finished", result);
    } catch (e) {
      logger.warn("[AUTO-CATCHUP] prod->local sync failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      autoCatchupInFlight = false;
    }
  })();
}

const VALID_CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "product_news",
  "community",
  "research",
];

const PERIOD_DAYS: Record<string, number> = {
  day: PERIOD_CONFIG.day.days!,
  week: PERIOD_CONFIG.week.days!,
  month: PERIOD_CONFIG.month.days!,
  all: PERIOD_CONFIG.all.days!,
};

export async function GET(request: NextRequest) {
  // Extract parameters early so they're available in error handler
  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get("category") as Category | null;
  const period = searchParams.get("period") || "week";
  const limitParam = searchParams.get("limit");
  const excludeIdsParam = searchParams.get("excludeIds"); // Comma-separated list of item IDs to exclude
  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");

  try {

    // Parse limit, clamp to [1, 50]
    let customLimit: number | undefined;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed)) {
        customLimit = Math.min(Math.max(parsed, 1), 50);
      }
    }

    // Parse excludeIds for pagination
    const excludeIds = excludeIdsParam
      ? new Set(excludeIdsParam.split(',').filter(id => id.trim().length > 0))
      : undefined;

    // Validate category
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        {
          error: "Invalid or missing category",
          validCategories: VALID_CATEGORIES,
        },
        { status: 400 }
      );
    }

    // Validate period
    if (period === "custom") {
      if (!startDateParam || !endDateParam) {
        return NextResponse.json(
          {
            error: "Custom period requires startDate and endDate parameters",
          },
          { status: 400 }
        );
      }
      const startDate = new Date(startDateParam);
      const endDate = new Date(endDateParam);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return NextResponse.json(
          {
            error: "Invalid date format. Use YYYY-MM-DD",
          },
          { status: 400 }
        );
      }
      if (startDate > endDate) {
        return NextResponse.json(
          {
            error: "Start date must be before end date",
          },
          { status: 400 }
        );
      }
    } else if (!PERIOD_DAYS[period]) {
      return NextResponse.json(
        {
          error: "Invalid period",
          validPeriods: [...Object.keys(PERIOD_DAYS), "custom"],
        },
        { status: 400 }
      );
    }

    // Calculate periodDays for custom or use predefined
    let periodDays: number;
    let loadOptions: { startDate?: Date; endDate?: Date } | undefined;

    if (period === "custom") {
      const startDate = new Date(startDateParam!);
      const endDate = new Date(endDateParam!);
      // Set to start of day for start, end of day for end
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      loadOptions = { startDate, endDate };
      // Calculate approximate days for logging/config
      periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    } else {
      periodDays = PERIOD_DAYS[period];

      // For research and product_news, use created_at for day period to show recently received items
      // This ensures items show up even if they were published earlier but received recently
      if ((category === "research" || category === "product_news") && period === "day") {
        // Use 1 day for day period (today only)
        periodDays = 1;
        logger.info(`[API] Using 1 day window for ${category} day period to show recently received items`);
      }
    }

    logger.info(
      `API request: category=${category}, period=${period}${period === "custom" ? ` (${startDateParam} to ${endDateParam})` : ` (${periodDays}d)`}`
    );

    // Initialize database (creates tables if needed)
    await initializeDatabase();

    // Force reset SQLite connection to avoid stale data in Next.js
    // Next.js may cache module instances, causing stale database connections
    const { resetSqliteConnection } = await import("@/src/lib/db/index");
    resetSqliteConnection();

    // Load items from database
    // Use direct database query to avoid Next.js module caching issues
    let items: FeedItem[];
    let usedCutoffFallback = false;
    if (loadOptions?.startDate && loadOptions?.endDate) {
      items = await loadItemsByCategoryWithDateRange(category, loadOptions.startDate, loadOptions.endDate);
    } else {
      // Direct database query to ensure fresh data (using driver abstraction)
      const client = await getDbClient();
      type ItemRow = {
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
        extracted_url?: string | null;
        full_text?: string | null;
      } & Record<string, unknown>;

      // Calculate cutoff time and date column based on category and period
      let cutoffTime: number;
      let useCreatedAt: boolean;
      let dateColumn: string;

      // Standard logic for all categories/periods
      const nowMs = Date.now();
      cutoffTime = Math.floor((nowMs - periodDays * 24 * 60 * 60 * 1000) / 1000);

      // For research:
      // - Daily/Weekly/Monthly: All show top-ranked results (no date filtering for backfilled papers)
      //   New papers added after backfill will have recent created_at and show in daily/weekly
      // - All-time: Filter by published_at (last 3 years)
      if (category === 'research') {
        if (period === 'all') {
          // Research all-time: limit to last 3 years using published_at
          const threeYearsAgo = Math.floor((Date.now() - 3 * 365 * 24 * 60 * 60 * 1000) / 1000);
          cutoffTime = threeYearsAgo;
          useCreatedAt = false;
          dateColumn = 'published_at';
          logger.info(`[API] Research all-time: limiting to last 3 years using published_at`);
        } else {
          // Research daily/weekly/monthly: no date filtering, just show top ranked results
          // This treats all backfilled papers as "current" and shows most relevant
          // New papers added after backfill will have recent created_at and show in daily/weekly
          useCreatedAt = false; // Not used since we're not filtering
          dateColumn = 'created_at'; // For ordering, but no cutoff
          logger.info(`[API] Research ${period} period: no date filtering, showing top ranked results`);
        }
      } else {
        // For newsletters and other categories: use created_at for day period, published_at for others
        // This ensures items show up based on when they were received (created_at) for daily view
        useCreatedAt = period === 'day';
        dateColumn = useCreatedAt ? 'created_at' : 'published_at';
        if (category === "newsletters" && period === "day") {
          logger.info(`[API] Newsletters day period: using ${periodDays} day window (${new Date(cutoffTime * 1000).toISOString()}), dateColumn=${dateColumn}`);
        }
      }

      // For newsletters, get both decomposed articles (have -article- in ID) and single-article newsletters (no -article-)
      // Single-article newsletters don't get the -article- suffix during decomposition
      // For research day/week/month: no date filtering, just get top items by relevance (via ranking)
      let whereClause: string;
      let queryParams: unknown[];

      if (category === "newsletters") {
        // Include both decomposed articles (with -article- in ID) and single-article newsletters (without -article-)
        // Single-article newsletters don't get the -article- suffix, so we need to include items that either
        // have -article- in ID OR are from newsletter sources without -article- in ID
        whereClause = `category = ? AND ${dateColumn} >= ?`;
        queryParams = [category, cutoffTime];
      } else if (category === "research" && period !== "all") {
        // Research day/week/month: no date filter, just get all research items (limited for performance)
        whereClause = `category = ?`;
        queryParams = [category];
      } else {
        whereClause = `category = ? AND ${dateColumn} >= ?`;
        queryParams = [category, cutoffTime];
      }

      // Add LIMIT for research to prevent loading too many items and causing memory issues
      // Research items have full_text which can be very large, so use smaller limit
      // Also exclude full_text from initial query to reduce memory usage (load it only if needed)
      const limitClause = category === "research" ? " LIMIT 500" : "";

      // For research, include full_text in query so we can check if it exists (but don't return it in response)
      // This allows the frontend to know which items have full_text available
      const selectColumns = category === "research"
        ? "id, stream_id, source_title, title, url, author, published_at, summary, content_snippet, categories, category, created_at, updated_at, extracted_url, full_text, full_text_fetched_at, full_text_source"
        : "*";

      const sqlQuery = `SELECT ${selectColumns} FROM items WHERE ${whereClause} ORDER BY ${dateColumn} DESC${limitClause}`;
      logger.info(`[API] Executing query: ${sqlQuery} with params: [${queryParams.map(p => typeof p === 'number' ? p : `'${p}'`).join(', ')}]`);
      const maxTimestampISO: string | null = null;
      
      const result = await client.query(
        sqlQuery,
        queryParams
      );
      let rawRows = result.rows as ItemRow[];

      // Fallback: if no items match the date cutoff, return the most recent items instead
      // This ensures the API returns data even when the database hasn't been synced recently
      if (rawRows.length === 0 && category !== "research" && period !== "all") {
        // Day should be strict: if nothing in last 24h, return 0 items (no fallback).
        // Weekly/monthly can still fall back to avoid "nothing ever loads" when local DB is stale.
        const skipFallback = period === "day";
        if (!skipFallback) {
          logger.info(
            `[API] No items found within cutoff window (${new Date(cutoffTime * 1000).toISOString()}), falling back to most recent items`
          );
          const fallbackQuery = `SELECT ${selectColumns} FROM items WHERE category = ? ORDER BY ${dateColumn} DESC${limitClause}`;
          const fallbackResult = await client.query(fallbackQuery, [category]);
          rawRows = fallbackResult.rows as ItemRow[];
          usedCutoffFallback = true;

          await maybeKickoffLocalCatchupSync({
            category,
            period,
            reason: "cutoff_fallback",
            maxTimestampISO,
          });
        }
      }

      logger.info(`[API] Direct query returned ${rawRows.length} rows for category=${category}, periodDays=${periodDays}, dateColumn=${dateColumn}, cutoffTime=${cutoffTime} (${new Date(cutoffTime * 1000).toISOString()})`);

      // Helper function to extract real URL from tracking links
      function extractUrlFromTracking(trackingUrl: string): string | null {
        // awstrack.me format: https://...awstrack.me/L0/https:%2F%2F...
        const awstrackMatch = trackingUrl.match(/\/L0\/(https?[^\/\s]+)/);
        if (awstrackMatch) {
          try {
            const encoded = awstrackMatch[1];
            const decoded = decodeURIComponent(encoded);
            if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
              return decoded;
            }
          } catch {
            // URL decode failed
          }
        }
        return null;
      }

      // Map rows to FeedItem format, using extracted_url when URL is Inoreader/tracking
      const mappedItems = rawRows.map((row): FeedItem | null => {
        const cat = row.category as Category;
        // Use extracted_url if URL is Inoreader/tracking, otherwise use url
        let finalUrl = row.url;

        // Check if URL is a tracking/Inoreader link
        if (row.url && (row.url.includes("inoreader.com") || row.url.includes("google.com/reader") ||
            row.url.includes("awstrack.me") || row.url.includes("tracking"))) {
          // First try extracted_url from database
          if (row.extracted_url && !row.extracted_url.includes("inoreader.com") && !row.extracted_url.includes("google.com/reader")) {
            finalUrl = row.extracted_url;
          } else {
            // Try to extract URL from tracking link
            const extracted = extractUrlFromTracking(row.url);
            if (extracted) {
              finalUrl = extracted;
            } else {
              // Skip items with tracking URLs and no way to extract real URL
              return null;
            }
          }
        }

        try {
          return {
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
            fullText: row.full_text || undefined, // May be null if excluded from SELECT to reduce memory
          };
        } catch (error) {
          logger.warn(`[API] Error mapping row ${row.id}: ${error}`);
          return null;
        }
      });

      items = mappedItems.filter((item): item is FeedItem => item !== null);

      logger.info(`[API] Mapped to ${items.length} items (filtered out ${rawRows.length - items.length} invalid items)`);
    }

    logger.info(`[API] Loaded ${items.length} items from database for category=${category}, periodDays=${periodDays}`);

    // Dev-only safety: Twitter/X feed items shouldn't appear in Newsletters; they're Community.
    // We filter them out of the newsletters response and (in dev/local only) recategorize them in the DB
    // so they show up under the Community tab on subsequent loads.
    if (category === "newsletters") {
      const isTwitterFeedItem = (it: FeedItem) =>
        typeof it.sourceTitle === "string" &&
        it.sourceTitle.toLowerCase().includes("twitter") &&
        typeof it.url === "string" &&
        (it.url.includes("twitter.com/") || it.url.includes("x.com/"));

      const twitterFeedItems = items.filter(isTwitterFeedItem);
      if (twitterFeedItems.length > 0) {
        items = items.filter((it) => !isTwitterFeedItem(it));

        // Fire-and-forget local recategorization (dev + localhost only)
        void (async () => {
          try {
            const nodeEnv = process.env.NODE_ENV ?? "development";
            if (nodeEnv === "production") return;
            const localUrl = process.env.LOCAL_DATABASE_URL;
            if (!localUrl?.startsWith("postgres")) return;
            const u = new URL(localUrl);
            const isLocalHost = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname.endsWith(".local");
            if (!isLocalHost) return;

            const { getDbClient } = await import("@/src/lib/db/driver");
            const db = await getDbClient();
            // Only recategorize clearly-Twitter sources that are currently miscategorized as newsletters
            await db.run(
              `
              UPDATE items
              SET category = 'community'
              WHERE category = 'newsletters'
                AND (url ILIKE '%twitter.com/%' OR url ILIKE '%x.com/%')
                AND source_title ILIKE '%twitter%'
            `
            );
          } catch (e) {
            logger.warn("[API] Recategorize twitter feed items failed", {
              error: e instanceof Error ? e.message : String(e),
            });
          }
        })();
      }
    }

    // Rank items (no filtering - it's fine for ai_news to show items from newsletters if they're relevant)
    // If we had to fall back (no items in-window), skip the internal date filter in rankCategory
    // so that "week" doesn't become empty after we already chose to display stale data.
    const rankedItems = await rankCategory(items, category, periodDays, period, { skipDateFilter: usedCutoffFallback });
    logger.info(`[API] Ranked to ${rankedItems.length} items (input was ${items.length} items)`);

    // Debug: Check if scores are loading
    if (rankedItems.length > 0) {
      const firstItem = rankedItems[0];
      logger.info(`[API] First ranked item: title="${firstItem.title.substring(0, 50)}...", finalScore=${firstItem.finalScore.toFixed(3)}, llmRelevance=${firstItem.llmScore.relevance}, llmUsefulness=${firstItem.llmScore.usefulness}`);
    }

    // Apply diversity selection based on period
    // For newsletters, use stricter per-source caps to ensure diversity (max 2-3 per source)
    // For other categories, allow more items per source
    const isNewsletters = category === "newsletters";
    const perSourceCaps = isNewsletters
      ? { day: 2, week: 2, month: 3, all: 4 }  // Stricter for newsletters
      : { day: 5, week: 4, month: 5, all: 6 };
    let maxPerSource = perSourceCaps[period as keyof typeof perSourceCaps] ?? 2;

    // Increase per-source caps proportionally if custom limit is higher
    // But for newsletters, still keep it relatively strict to maintain diversity
    if (customLimit && customLimit > getCategoryConfig(category).maxItems) {
      const expansionRatio = customLimit / getCategoryConfig(category).maxItems;
      if (isNewsletters) {
        // For newsletters, increase more conservatively to maintain diversity
        maxPerSource = Math.min(Math.ceil(maxPerSource * Math.sqrt(expansionRatio)), 6);
      } else {
        maxPerSource = Math.ceil(maxPerSource * expansionRatio);
      }
    }

    const selectionResult = selectWithDiversity(
      rankedItems,
      category,
      maxPerSource,
      customLimit, // Pass custom limit to override category config
      excludeIds // Exclude already-loaded items for pagination
    );
    logger.info(
      `Applied diversity selection: ${selectionResult.items.length} items selected from ${rankedItems.length}`
    );

    // Check if there are more items available beyond the current selection
    // We need to check if there are any items in rankedItems that weren't selected
    // and that meet the quality threshold (finalScore >= 0.05)
    const selectedIds = new Set(selectionResult.items.map(item => item.id));
    const remainingItems = rankedItems.filter(
      item => !selectedIds.has(item.id) && item.finalScore >= 0.05
    );
    const hasMore = remainingItems.length > 0;

    // Return response with cache control headers to prevent Next.js caching
    const response = NextResponse.json({
      category,
      period,
      periodDays,
      totalItems: selectionResult.items.length,
      itemsRanked: rankedItems.length,
      itemsFiltered: rankedItems.length - selectionResult.items.length,
      hasMore, // Indicate if more items are available
      items: selectionResult.items.map((item) => ({
          id: item.id,
          title: decodeHtmlEntities(item.title), // Decode HTML entities in title
          url: item.url,
          sourceTitle: item.sourceTitle,
          publishedAt: item.publishedAt.toISOString(),
          createdAt: item.createdAt?.toISOString() || null,
          summary: item.summary,
          author: item.author,
          categories: item.categories,
          category: item.category,
          bm25Score: Number(item.bm25Score.toFixed(3)),
          llmScore: {
            relevance: item.llmScore.relevance,
            usefulness: item.llmScore.usefulness,
            tags: item.llmScore.tags,
          },
          recencyScore: Number(item.recencyScore.toFixed(3)),
          finalScore: Number(item.finalScore.toFixed(3)),
          reasoning: item.reasoning,
          diversityReason: selectionResult.reasons.get(item.id),
        })),
    });

    // Set cache control headers to prevent Next.js from caching API responses
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error("GET /api/items failed", {
      error: errorMessage,
      stack: errorStack,
      category,
      period,
      limitParam,
      excludeIdsParam,
    });
    return NextResponse.json(
      {
        error: "Failed to fetch items",
        message: errorMessage,
        category,
        period,
      },
      { status: 500 }
    );
  }
}
