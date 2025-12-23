/**
 * API route: GET /api/admin/ranking-debug
 * Debug endpoint to show top 50 ranked items (before selection filtering)
 * Displays BM25, LLM, recency, and final scores
 */

import { NextRequest, NextResponse } from "next/server";
import { Category } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { getItemLatestScores } from "@/src/lib/db/scores";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { blockInProduction } from "@/src/lib/auth/guards";

/**
 * Validate query parameters
 */
function parseQueryParams(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const category = searchParams.get("category") as Category | null;
  const period = searchParams.get("period") || "week";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

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

  return { category, period, periodDays, limit };
}

/**
 * GET /api/admin/ranking-debug?category=research&period=week&limit=50
 */
export async function GET(req: NextRequest) {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    const { category, periodDays, limit } = parseQueryParams(req);

    logger.info(
      `[DEBUG] Ranking analysis for category: ${category}, period: ${periodDays}d, limit: ${limit}`
    );

    // Initialize database
    await initializeDatabase();

    // Load items from database cache
    const cachedItems = await loadItemsByCategory(category, periodDays);
    if (!cachedItems || cachedItems.length === 0) {
      logger.warn(`[DEBUG] No items found for category: ${category}`);
      return NextResponse.json({
        error: "No items found for this category",
        category,
        itemCount: 0,
      });
    }

    logger.info(`[DEBUG] Loaded ${cachedItems.length} items, ranking...`);

    // Rank all items
    const rankedItems = await rankCategory(cachedItems, category, periodDays);

    // Get top N items for debug display
    const topItems = rankedItems.slice(0, limit);

    // Enrich with stored score data if available
    const enrichedItems = await Promise.all(
      topItems.map(async (item) => {
        const storedScores = await getItemLatestScores(item.id);
        return {
          id: item.id,
          title: item.title,
          url: item.url,
          sourceTitle: item.sourceTitle,
          publishedAt: item.publishedAt.toISOString(),
          bm25Score: item.bm25Score,
          llmRelevance: item.llmScore.relevance,
          llmUsefulness: item.llmScore.usefulness,
          llmTags: item.llmScore.tags,
          recencyScore: item.recencyScore,
          finalScore: item.finalScore,
          reasoning: item.reasoning,
          storedAt: storedScores?.scoredAt,
        };
      })
    );

    logger.info(
      `[DEBUG] Returned top ${enrichedItems.length} ranked items for analysis`
    );

    return NextResponse.json({
      category,
      period: periodDays === 7 ? "week" : "month",
      totalRanked: rankedItems.length,
      topItems: enrichedItems,
      scoreRange: {
        min: enrichedItems.length > 0 ? Math.min(...enrichedItems.map((i) => i.finalScore)) : 0,
        max: enrichedItems.length > 0 ? Math.max(...enrichedItems.map((i) => i.finalScore)) : 0,
        avg:
          enrichedItems.length > 0
            ? enrichedItems.reduce((sum, i) => sum + i.finalScore, 0) / enrichedItems.length
            : 0,
      },
    });
  } catch (error) {
    logger.error("[DEBUG] Error in /api/admin/ranking-debug", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch ranking debug info",
      },
      { status: 400 }
    );
  }
}
