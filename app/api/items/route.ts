/**
 * GET /api/items?category=tech_articles&period=week
 * Returns ranked items for a specific category and time period
 */

import { NextRequest, NextResponse } from "next/server";
import { loadItemsByCategory, loadItemsByCategoryWithDateRange } from "@/src/lib/db/items";
import { initializeDatabase } from "@/src/lib/db/index";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { selectWithDiversity } from "@/src/lib/pipeline/select";
import { Category } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";
import { getCategoryConfig } from "@/src/config/categories";

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
  day: 2, // 2 days to account for daily cron job running at 9 PM (2 AM UTC)
  week: 7,
  month: 30,
  all: 90,
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

    // Load items from database
    const items = loadOptions?.startDate && loadOptions?.endDate
      ? await loadItemsByCategoryWithDateRange(category, loadOptions.startDate, loadOptions.endDate)
      : await loadItemsByCategory(category, periodDays);
    logger.info(`Loaded ${items.length} items from database`);

    // Rank items
    const rankedItems = await rankCategory(items, category, periodDays);
    logger.info(`Ranked to ${rankedItems.length} items`);

    // Apply diversity selection based on period
    // Increased caps to allow ranking system to show quality results (not just diversity)
    const perSourceCaps = { day: 1, week: 4, month: 5, all: 6 };
    let maxPerSource = perSourceCaps[period as keyof typeof perSourceCaps] ?? 2;

    // Increase per-source caps proportionally if custom limit is higher
    if (customLimit && customLimit > getCategoryConfig(category).maxItems) {
      const expansionRatio = customLimit / getCategoryConfig(category).maxItems;
      maxPerSource = Math.ceil(maxPerSource * expansionRatio);
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
