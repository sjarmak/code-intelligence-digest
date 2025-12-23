/**
 * API route: POST /api/admin/cache/invalidate
 * Invalidate cache to force refresh from Inoreader API
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { invalidateFeeds, invalidateCategoryItems } from "@/src/lib/db/cache";
import { blockInProduction } from "@/src/lib/auth/guards";

/**
 * POST /api/admin/cache/invalidate
 * Body: { "scope": "feeds" | "items", "category"?: string }
 */
export async function POST(req: NextRequest) {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    const body = await req.json() as { scope?: string; category?: string };
    const { scope = "feeds", category } = body;

    logger.info(`[CACHE] Invalidation request: scope=${scope}, category=${category}`);

    // Initialize database
    await initializeDatabase();

    if (scope === "feeds") {
      await invalidateFeeds();
      return NextResponse.json({
        success: true,
        message: "Feeds cache invalidated",
        scope: "feeds",
      });
    }

    if (scope === "items") {
      if (!category) {
        return NextResponse.json(
          {
            error: "category required for items invalidation",
            scope: "items",
          },
          { status: 400 }
        );
      }

      await invalidateCategoryItems(category);
      return NextResponse.json({
        success: true,
        message: `Items cache invalidated for category: ${category}`,
        scope: "items",
        category,
      });
    }

    if (scope === "all") {
      await invalidateFeeds();
      const validCategories = [
        "newsletters",
        "podcasts",
        "tech_articles",
        "ai_news",
        "product_news",
        "community",
        "research",
      ];
      for (const cat of validCategories) {
        await invalidateCategoryItems(cat);
      }

      return NextResponse.json({
        success: true,
        message: "All caches invalidated (feeds + items)",
        scope: "all",
      });
    }

    return NextResponse.json(
      {
        error: `Invalid scope: ${scope}. Must be 'feeds', 'items', or 'all'`,
      },
      { status: 400 }
    );
  } catch (error) {
    logger.error("[CACHE] Error in cache invalidation", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to invalidate cache",
      },
      { status: 500 }
    );
  }
}
