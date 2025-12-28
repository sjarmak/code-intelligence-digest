/**
 * GET /api/items?category=tech_articles&period=week
 * Returns ranked items for a specific category and time period
 */

import { NextRequest, NextResponse } from "next/server";
import { loadItemsByCategory, loadItemsByCategoryWithDateRange } from "@/src/lib/db/items";
import { initializeDatabase } from "@/src/lib/db/index";
import { getDbClient } from "@/src/lib/db/driver";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { selectWithDiversity } from "@/src/lib/pipeline/select";
import { Category, FeedItem } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";
import { getCategoryConfig } from "@/src/config/categories";
import { PERIOD_CONFIG } from "@/src/config/periods";
import { decodeHtmlEntities } from "@/src/lib/utils/html-entities";

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
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category") as Category | null;
    const period = searchParams.get("period") || "week";
    const limitParam = searchParams.get("limit");
    const excludeIdsParam = searchParams.get("excludeIds"); // Comma-separated list of item IDs to exclude
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");

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

      // Special handling for newsletters: use most recent item's timestamp as reference
      // Show items from the last 24 hours relative to the most recent item
      // This ensures that if it's Sunday and the most recent item is from Friday,
      // we'll show Friday's items (24 hours relative to Friday)
      if (category === "newsletters" && period === "day") {
        periodDays = 1; // Will be adjusted based on most recent item
      }

      // For research and product_news, use created_at for day period to show recently received items
      // This ensures items show up even if they were published earlier but received recently
      if ((category === "research" || category === "product_news") && period === "day") {
        // Use 3 days for day period to catch items that were synced recently
        periodDays = 3;
        logger.info(`[API] Using 3 day window for ${category} day period to show recently received items`);
      }
    }

    logger.info(
      `API request: category=${category}, period=${period}${period === "custom" ? ` (${startDateParam} to ${endDateParam})` : ` (${periodDays}d)`}`
    );

    // Initialize database (creates tables if needed)
    await initializeDatabase();

    // Force reset SQLite connection to avoid stale data in Next.js
    // Next.js may cache module instances, causing stale database connections
    const { resetSqliteConnection, getSqlite } = await import("@/src/lib/db/index");
    resetSqliteConnection();

    // Load items from database
    // Use direct database query to avoid Next.js module caching issues
    let items: FeedItem[];
    if (loadOptions?.startDate && loadOptions?.endDate) {
      items = await loadItemsByCategoryWithDateRange(category, loadOptions.startDate, loadOptions.endDate);
    } else {
      // Direct database query to ensure fresh data (using driver abstraction)
      const client = await getDbClient();

      // Special handling for newsletters day period: use most recent item's timestamp
      let cutoffTime: number;
      let useCreatedAt: boolean;
      let dateColumn: string;

      if (category === "newsletters" && period === "day") {
        // Find the most recent newsletter item
        const mostRecentResult = await client.query(
          `SELECT created_at FROM items WHERE category = ? AND id LIKE '%-article-%' ORDER BY created_at DESC LIMIT 1`,
          [category]
        );

        if (mostRecentResult.rows.length > 0) {
          const mostRecentCreatedAt = (mostRecentResult.rows[0] as any).created_at;
          // Use 24 hours before the most recent item
          cutoffTime = mostRecentCreatedAt - (24 * 60 * 60); // 24 hours in seconds
          useCreatedAt = true;
          dateColumn = 'created_at';
          logger.info(`[API] Newsletters day period: using most recent item timestamp (${new Date(mostRecentCreatedAt * 1000).toISOString()}), cutoff: ${new Date(cutoffTime * 1000).toISOString()}`);
        } else {
          // Fallback: use current time - 24 hours if no items found
          cutoffTime = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
          useCreatedAt = true;
          dateColumn = 'created_at';
          logger.info(`[API] Newsletters day period: no items found, using current time - 24 hours`);
        }
      } else {
        // Standard logic for other categories/periods
        cutoffTime = Math.floor((Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000);
        // For research:
        // - Daily/Weekly: Filter by created_at (new papers added after backfill)
        // - Monthly: Filter by published_at (current month) - shows all papers published this month
        // - All-time: Filter by published_at (last 3 years)
        if (category === 'research') {
          if (period === 'all') {
            // Research all-time: limit to last 3 years using published_at
            const threeYearsAgo = Math.floor((Date.now() - 3 * 365 * 24 * 60 * 60 * 1000) / 1000);
            cutoffTime = threeYearsAgo;
            useCreatedAt = false;
            dateColumn = 'published_at';
            logger.info(`[API] Research all-time: limiting to last 3 years using published_at`);
          } else if (period === 'month') {
            // Research monthly: filter by published_at (current month)
            // Get first day of current month
            const now = new Date();
            const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            cutoffTime = Math.floor(firstOfMonth.getTime() / 1000);
            useCreatedAt = false;
            dateColumn = 'published_at';
            logger.info(`[API] Research monthly: filtering by published_at >= ${new Date(cutoffTime * 1000).toISOString()} (first of current month)`);
          } else {
            // Research daily/weekly: filter by created_at (new papers added after backfill)
            useCreatedAt = true;
            dateColumn = 'created_at';
            logger.info(`[API] Research ${period} period: filtering by created_at (new papers added after backfill)`);
          }
        } else {
          // For other categories: use created_at for day period, published_at for others
          useCreatedAt = period === 'day';
          dateColumn = useCreatedAt ? 'created_at' : 'published_at';
        }
      }

      // For newsletters, only get decomposed articles (have -article- in ID)
      // For research: API route handles filtering (created_at for day/week, published_at for month/all)
      let whereClause: string;
      let queryParams: any[];

      if (category === "newsletters") {
        whereClause = `category = ? AND id LIKE '%-article-%' AND ${dateColumn} >= ?`;
        queryParams = [category, cutoffTime];
      } else {
        whereClause = `category = ? AND ${dateColumn} >= ?`;
        queryParams = [category, cutoffTime];
      }

      // Add LIMIT for research to prevent loading too many items (max 1000 for ranking)
      const limitClause = category === "research" ? " LIMIT 1000" : "";

      const result = await client.query(
        `SELECT * FROM items WHERE ${whereClause} ORDER BY ${dateColumn} DESC${limitClause}`,
        queryParams
      );
      const rawRows = result.rows as any[];

      logger.info(`[API] Direct query returned ${rawRows.length} rows for category=${category}, periodDays=${periodDays}, dateColumn=${dateColumn}`);

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
          } catch (e) {
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
            fullText: row.full_text || undefined,
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

    // Rank items (no filtering - it's fine for ai_news to show items from newsletters if they're relevant)
    const rankedItems = await rankCategory(items, category, periodDays, period);
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
