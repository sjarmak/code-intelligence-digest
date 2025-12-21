/**
 * Admin API for full text management
 * 
 * GET /api/admin/fulltext/status
 *   Returns cache statistics
 * 
 * POST /api/admin/fulltext/fetch
 *   Fetch full text for items
 *   Body: { category?, limit?, skip_cached? }
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/src/lib/logger";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { saveFullText, getFullTextCacheStats } from "@/src/lib/db/items";
import { fetchFullTextBatch } from "@/src/lib/pipeline/fulltext";
import { Category } from "@/src/lib/model";

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
 * GET /api/admin/fulltext/status
 * Get cache statistics
 */
export async function GET(request: NextRequest) {
  try {
    const stats = await getFullTextCacheStats();

    return NextResponse.json({
      status: "ok",
      cache: stats,
      percentCached: stats.total > 0 ? Math.round((stats.cached / stats.total) * 100) : 0,
    });
  } catch (error) {
    logger.error("Failed to get full text stats", { error });
    return NextResponse.json(
      { error: "Failed to get full text stats" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/fulltext/fetch
 * Fetch full text for items
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const category = body.category as Category | undefined;
    const limit = Math.min(Math.max(parseInt(body.limit) || 10, 1), 50);
    const skipCached = body.skip_cached !== false;

    // Validate category if provided
    if (category && !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        {
          error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    logger.info(
      `Fetching full text for ${category || "all categories"}, limit: ${limit}, skip_cached: ${skipCached}`
    );

    // Load items
    let items = [];
    if (category) {
      items = await loadItemsByCategory(category, 7); // Last 7 days
    } else {
      // Load from all categories
      for (const cat of VALID_CATEGORIES) {
        const catItems = await loadItemsByCategory(cat, 7);
        items.push(...catItems);
      }
    }

    logger.info(`Loaded ${items.length} items from database`);

    // Filter out items that already have full text if skip_cached is true
    let itemsToFetch = items;
    if (skipCached) {
      itemsToFetch = items.filter(item => !(item as any).fullText);
      logger.info(
        `Filtered to ${itemsToFetch.length} items (${items.length - itemsToFetch.length} already cached)`
      );
    }

    // Take limit
    itemsToFetch = itemsToFetch.slice(0, limit);

    if (itemsToFetch.length === 0) {
      return NextResponse.json({
        status: "ok",
        message: "No items to fetch",
        itemsToFetch: 0,
        itemsFetched: 0,
        successful: 0,
        failed: 0,
      });
    }

    logger.info(`Fetching full text for ${itemsToFetch.length} items`);

    // Fetch full text in parallel with rate limiting
    const startTime = Date.now();
    const results = await fetchFullTextBatch(itemsToFetch, 3);
    const fetchDuration = Date.now() - startTime;

    // Save results to database
    let successful = 0;
    let failed = 0;

    for (const [itemId, result] of results.entries()) {
      try {
        await saveFullText(itemId, result.text, result.source);
        if (result.source !== "error") {
          successful++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error(`Failed to save full text for ${itemId}`, { error });
        failed++;
      }
    }

    const stats = await getFullTextCacheStats();

    logger.info(
      `Full text fetch complete: ${successful} successful, ${failed} failed in ${fetchDuration}ms`
    );

    return NextResponse.json({
      status: "ok",
      itemsToFetch: itemsToFetch.length,
      itemsFetched: results.size,
      successful,
      failed,
      duration: `${(fetchDuration / 1000).toFixed(1)}s`,
      cache: stats,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Full text fetch failed", { error: errorMsg });

    return NextResponse.json(
      {
        error: "Failed to fetch full text",
        message: errorMsg,
      },
      { status: 500 }
    );
  }
}
