/**
 * API route: GET /api/items
 * Fetch and rank items for a given category and time period
 * 
 * NOTE: This ONLY reads from the database cache.
 * Data is populated by periodic syncs from Inoreader (see /api/admin/sync)
 * This ensures the read path is decoupled from the API and avoids rate limits.
 */

import { NextRequest, NextResponse } from "next/server";
import { Category } from "@/src/lib/model";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { selectWithDiversity } from "@/src/lib/pipeline/select";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { saveItemScores } from "@/src/lib/db/scores";
import { saveDigestSelections } from "@/src/lib/db/selections";

/**
 * Validate query parameters
 */
function parseQueryParams(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const category = searchParams.get("category") as Category | null;
  const period = searchParams.get("period") || "week";

  const validCategories: Category[] = [
    "newsletters",
    "podcasts",
    "tech_articles",
    "ai_news",
    "product_news",
    "community",
    "research",
  ];

  if (!category || !validCategories.includes(category)) {
    throw new Error(
      `Invalid category: ${category}. Must be one of: ${validCategories.join(", ")}`
    );
  }

  const periodDays = period === "month" ? 30 : 7;

  return { category, period, periodDays };
}

/**
 * GET /api/items?category=newsletters&period=week
 * 
 * Reads from database cache only. No Inoreader API calls.
 * To refresh data, call POST /api/admin/sync/category?category=newsletters
 */
export async function GET(req: NextRequest) {
  try {
    const { category, periodDays } = parseQueryParams(req);

    logger.info(`[GET /api/items] Fetching items for category: ${category}, period: ${periodDays}d`);

    // Initialize database
    await initializeDatabase();

    // Load items from database cache
    logger.debug(`[GET /api/items] Loading items from database for category: ${category}`);
    const cachedItems = await loadItemsByCategory(category, periodDays);
    
    if (!cachedItems || cachedItems.length === 0) {
      logger.warn(`[GET /api/items] No items found in database for category: ${category}`);
      return NextResponse.json({
        items: [],
        category,
        period: periodDays === 7 ? "week" : "month",
        count: 0,
        message: `No cached items for category: ${category}. Run POST /api/admin/sync to fetch from Inoreader.`,
        hint: `curl -X POST http://localhost:3000/api/admin/sync/category?category=${category}`,
      });
    }

    logger.info(`[GET /api/items] Loaded ${cachedItems.length} items from database cache for category: ${category}`);
    
    // Rank items using scoring pipeline
    const rankedItems = await rankCategory(cachedItems, category, periodDays);
    const selectionResult = selectWithDiversity(rankedItems, category);
    const finalItems = selectionResult.items;
    
    // Save scores to database for analytics
    await saveItemScores(rankedItems, category);
    
    // Save digest selections with diversity reasons
    const period = periodDays === 7 ? "week" : "month";
    await saveDigestSelections(
      finalItems.map((item, rank) => ({
        itemId: item.id,
        category,
        period,
        rank: rank + 1,
        diversityReason: selectionResult.reasons.get(item.id),
      }))
    );
    
    logger.info(`[GET /api/items] Returning ${finalItems.length} final items (ranked from ${cachedItems.length} in cache)`);

    return NextResponse.json({
      items: finalItems.map((item: typeof finalItems[number]) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        sourceTitle: item.sourceTitle,
        publishedAt: item.publishedAt.toISOString(),
        summary: item.summary,
        contentSnippet: item.contentSnippet,
        category: item.category,
        bm25Score: item.bm25Score,
        llmScore: item.llmScore,
        recencyScore: item.recencyScore,
        finalScore: item.finalScore,
        reasoning: item.reasoning,
      })),
      category,
      period,
      count: finalItems.length,
      source: "database_cache",
      });
      } catch (error) {
      logger.error("[GET /api/items] Error", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch items",
      },
      { status: 400 }
    );
  }
}
