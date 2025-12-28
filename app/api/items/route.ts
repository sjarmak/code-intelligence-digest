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
      const cutoffTime = Math.floor((Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000);
      // For "day" period, use created_at (when Inoreader received it) to show recently received items
      // For other periods, use published_at to show items by their original publication date
      const useCreatedAt = period === 'day';
      const dateColumn = useCreatedAt ? 'created_at' : 'published_at';

      // For newsletters, only get decomposed articles (have -article- in ID)
      const whereClause = category === "newsletters"
        ? `category = ? AND id LIKE '%-article-%' AND ${dateColumn} >= ?`
        : `category = ? AND ${dateColumn} >= ?`;

      const result = await client.query(
        `SELECT * FROM items WHERE ${whereClause} ORDER BY ${dateColumn} DESC`,
        [category, cutoffTime]
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

    // Rank items
    const rankedItems = await rankCategory(items, category, periodDays);
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
      customLimit // Pass custom limit to override category config
    );
    logger.info(
      `Applied diversity selection: ${selectionResult.items.length} items selected from ${rankedItems.length}`
    );

    // Return response with cache control headers to prevent Next.js caching
    const response = NextResponse.json({
      category,
      period,
      periodDays,
      totalItems: selectionResult.items.length,
      itemsRanked: rankedItems.length,
      itemsFiltered: rankedItems.length - selectionResult.items.length,
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
    logger.error("GET /api/items failed", { error });
    return NextResponse.json(
      {
        error: "Failed to fetch items",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
