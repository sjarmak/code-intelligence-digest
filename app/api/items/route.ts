/**
 * GET /api/items?category=tech_articles&period=week
 * Returns ranked items for a specific category and time period
 */

import { NextRequest, NextResponse } from "next/server";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { selectWithDiversity } from "@/src/lib/pipeline/select";
import { Category } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";

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
  day: 1,
  week: 7,
  month: 30,
  all: 90,
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category") as Category | null;
    const period = searchParams.get("period") || "week";

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
    if (!PERIOD_DAYS[period]) {
      return NextResponse.json(
        {
          error: "Invalid period",
          validPeriods: Object.keys(PERIOD_DAYS),
        },
        { status: 400 }
      );
    }

    const periodDays = PERIOD_DAYS[period];

    logger.info(`API request: category=${category}, period=${period} (${periodDays}d)`);

    // Load items from database
    const items = await loadItemsByCategory(category, periodDays);
    logger.info(`Loaded ${items.length} items from database`);

    // Rank items
    const rankedItems = await rankCategory(items, category, periodDays);
    logger.info(`Ranked to ${rankedItems.length} items`);

    // Apply diversity selection based on period
    const perSourceCaps = { day: 1, week: 2, month: 3, all: 4 };
    const maxPerSource = perSourceCaps[period as keyof typeof perSourceCaps] ?? 2;
    const selectionResult = selectWithDiversity(rankedItems, category, maxPerSource);
    logger.info(
      `Applied diversity selection: ${selectionResult.items.length} items selected from ${rankedItems.length}`
    );

    // Return response
    return NextResponse.json({
      category,
      period,
      periodDays,
      totalItems: selectionResult.items.length,
      itemsRanked: rankedItems.length,
      itemsFiltered: rankedItems.length - selectionResult.items.length,
      items: selectionResult.items.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        sourceTitle: item.sourceTitle,
        publishedAt: item.publishedAt.toISOString(),
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
