/**
 * GET /api/items?category=tech_articles&period=week
 * Returns ranked items for a specific category and time period
 */

import { NextRequest, NextResponse } from "next/server";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { rankCategory } from "@/src/lib/pipeline/rank";
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

    // Return response
    return NextResponse.json({
      category,
      period,
      periodDays,
      totalItems: rankedItems.length,
      items: rankedItems.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        sourceTitle: item.sourceTitle,
        publishedAt: item.publishedAt.toISOString(),
        summary: item.summary,
        author: item.author,
        categories: item.categories,
        bm25Score: Number(item.bm25Score.toFixed(3)),
        llmScore: {
          relevance: item.llmScore.relevance,
          usefulness: item.llmScore.usefulness,
          tags: item.llmScore.tags,
        },
        recencyScore: Number(item.recencyScore.toFixed(3)),
        finalScore: Number(item.finalScore.toFixed(3)),
        reasoning: item.reasoning,
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
