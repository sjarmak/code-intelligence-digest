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

    const periodDays = period === "month" ? 30 : 7;

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
      return NextResponse.json({
        query,
        category: category || "all",
        period: periodDays === 7 ? "week" : "month",
        results: [],
        message: "No items found for search",
      });
    }

    logger.info(`[SEARCH] Searching over ${searchItems.length} items`);

    // Perform semantic search
    const results = await semanticSearch(query, searchItems, limit);

    logger.info(`[SEARCH] Returned ${results.length} results`);

    return NextResponse.json({
      query,
      category: category || "all",
      period: periodDays === 7 ? "week" : "month",
      itemsSearched: searchItems.length,
      resultsReturned: results.length,
      results,
    });
  } catch (error) {
    logger.error("[SEARCH] Error in /api/search", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Search failed",
      },
      { status: 500 }
    );
  }
}
