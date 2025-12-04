/**
 * API route: GET /api/items
 * Fetch and rank items for a given category and time period
 */

import { NextRequest, NextResponse } from "next/server";
import { Category } from "@/src/lib/model";
import { createInoreaderClient } from "@/src/lib/inoreader/client";
import { getStreamsByCategory } from "@/src/config/feeds";
import { normalizeItems } from "@/src/lib/pipeline/normalize";
import { categorizeItems } from "@/src/lib/pipeline/categorize";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { selectWithDiversity } from "@/src/lib/pipeline/select";
import { logger } from "@/src/lib/logger";

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
 */
export async function GET(req: NextRequest) {
  try {
    const { category, periodDays } = parseQueryParams(req);

    logger.info(`Fetching items for category: ${category}, period: ${periodDays}d`);

    // Create Inoreader client
    const client = createInoreaderClient();

    // Get all streams for this category (async)
    const streamIds = await getStreamsByCategory(category);
    if (streamIds.length === 0) {
      logger.warn(`No streams configured for category: ${category}`);
      return NextResponse.json({
        items: [],
        category,
        period: periodDays,
        message: "No streams configured for this category",
      });
    }

    logger.info(`Found ${streamIds.length} streams for category: ${category}`);

    // Fetch items from all streams
    const allItems = [];
    for (const streamId of streamIds) {
      try {
        logger.debug(`Fetching stream: ${streamId}`);
        const response = await client.getStreamContents(streamId, { n: 100 });
        allItems.push(...response.items);
        logger.info(`Fetched ${response.items.length} items from ${streamId}`);
      } catch (error) {
        logger.error(`Failed to fetch stream ${streamId}`, error);
        // Continue with other streams on error
      }
    }

    if (allItems.length === 0) {
      logger.warn(`No items fetched for category: ${category}`);
      return NextResponse.json({
        items: [],
        category,
        period: periodDays,
        message: "No items found",
      });
    }

    logger.info(`Fetched ${allItems.length} total items`);

    // Normalize items
    let items = await normalizeItems(allItems);
    logger.info(`Normalized ${items.length} items`);

    // Categorize items
    items = categorizeItems(items);

    // Filter to items in this category
    const categoryItems = items.filter((i: typeof items[number]) => i.category === category);
    logger.info(`${categoryItems.length} items match category: ${category}`);

    // Rank items
    const rankedItems = await rankCategory(categoryItems, category, periodDays);

    // Select top items with diversity constraints
    const finalItems = selectWithDiversity(rankedItems, category);

    logger.info(`Returning ${finalItems.length} final items`);

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
      period: periodDays === 7 ? "week" : "month",
      count: finalItems.length,
    });
  } catch (error) {
    logger.error("Error in /api/items", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch items",
      },
      { status: 400 }
    );
  }
}
