/**
 * API route: GET /api/search
 * Semantic search over cached digest items
 */

import { NextRequest, NextResponse } from "next/server";
import { Category } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { semanticSearch } from "@/src/lib/pipeline/search";

const VALID_CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "product_news",
  "community",
  "research",
];

/**
 * GET /api/search?q=code+intelligence&category=research&period=week&limit=10
 * 
 * Query parameters:
 * - q (required): Search query string
 * - category (optional): Restrict to specific category
 * - period (optional): "week" or "month" (default: "week")
 * - limit (optional): Max results (default: 10, max: 100)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const query = searchParams.get("q");
    const category = searchParams.get("category") as Category | null;
    const period = searchParams.get("period") || "week";
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 100);

    // Validate required parameters
    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { error: "Search query (q parameter) is required" },
        { status: 400 }
      );
    }

    // Validate category if provided
    if (category && !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        {
          error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Map period to days
    const periodDaysMap: Record<string, number> = {
      day: 1,
      week: 7,
      month: 30,
      all: 90,
    };
    const periodDays = periodDaysMap[period] || 7;

    logger.info(
      `[SEARCH] Query: "${query}", category: ${category || "all"}, period: ${periodDays}d, limit: ${limit}`
    );

    // Initialize database
    await initializeDatabase();

    // Load items to search over
    let searchItems = [];

    if (category) {
      // Search in specific category
      const categoryItems = await loadItemsByCategory(category, periodDays);
      searchItems = categoryItems || [];
    } else {
      // Search across all categories
      const allCategories = VALID_CATEGORIES;
      for (const cat of allCategories) {
        const items = await loadItemsByCategory(cat, periodDays);
        if (items && items.length > 0) {
          searchItems.push(...items);
        }
      }
    }

    if (searchItems.length === 0) {
      logger.warn(
        `[SEARCH] No items found for ${category ? `category: ${category}` : "any category"}`
      );
      // Map periodDays back to period name
      const periodName = Object.entries(periodDaysMap).find(([, v]) => v === periodDays)?.[0] || "week";
      
      return NextResponse.json({
        query,
        category: category || "all",
        period: periodName,
        results: [],
        message: "No items found for search",
      });
    }

    logger.info(`[SEARCH] Searching over ${searchItems.length} items`);

    // Validate items have required fields
    const invalidItems = searchItems.filter((item) => !item.title || !item.url);
    if (invalidItems.length > 0) {
      logger.warn(`[SEARCH] Found ${invalidItems.length} items with missing title or url`);
    }

    // Perform semantic search
    const results = await semanticSearch(query, searchItems, limit);

    logger.info(`[SEARCH] Returned ${results.length} results`);

    // Map periodDays back to period name for response
    const periodName = Object.entries(periodDaysMap).find(([, v]) => v === periodDays)?.[0] || "week";
    
    return NextResponse.json({
      query,
      category: category || "all",
      period: periodName,
      itemsSearched: searchItems.length,
      resultsReturned: results.length,
      results,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error("[SEARCH] Error in /api/search", { error: errorMsg, stack: errorStack });

    return NextResponse.json(
      {
        error: errorMsg || "Search failed",
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
