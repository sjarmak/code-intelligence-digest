/**
 * API route: POST /api/admin/sync
 *
 * @deprecated This endpoint is DEPRECATED and BLOCKED.
 * Use /api/admin/sync-daily instead - it's much more efficient.
 *
 * This old endpoint makes 1 API call per stream (~100+ calls for a full sync)
 * vs sync-daily which uses 1-2 calls total with server-side filtering.
 */

import { NextRequest, NextResponse } from "next/server";
import { Category } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { syncAllCategories, syncCategory } from "@/src/lib/sync/inoreader-sync";
import { blockInProduction } from "@/src/lib/auth/guards";

const VALID_CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "ai_dev",
  "product_news",
  "community",
  "research",
  "marketing",
];

/**
 * POST /api/admin/sync/all
 * Sync all categories from Inoreader
 */
export async function POST(req: NextRequest) {
  // Block in production - this endpoint is deprecated and too expensive
  const blocked = blockInProduction();
  if (blocked) {
    logger.warn(
      "[DEPRECATED] /api/admin/sync endpoint called but blocked in production",
    );
    return NextResponse.json(
      {
        error:
          "This endpoint is deprecated and blocked. Use /api/admin/sync-daily instead.",
        reason:
          "This endpoint makes 100+ API calls. sync-daily uses only 1-2 calls.",
        alternative: "POST /api/admin/sync-daily",
      },
      { status: 410 }, // 410 Gone - indicates deprecated/removed
    );
  }

  // Even in dev, warn about the inefficiency
  logger.warn(
    "[DEPRECATED] /api/admin/sync called - this uses 100+ API calls. Use /api/admin/sync-daily instead.",
  );

  try {
    const { pathname } = new URL(req.url);
    const isAllSync = pathname.includes("/all");

    logger.info(
      `Sync request: ${isAllSync ? "all categories" : "specific category"}`,
    );

    // Initialize database
    await initializeDatabase();

    if (isAllSync) {
      // Sync all categories
      const result = await syncAllCategories();

      logger.info(`Sync completed: ${result.itemsAdded} items added`);

      return NextResponse.json({
        success: result.success,
        categoriesProcessed: result.categoriesProcessed,
        itemsAdded: result.itemsAdded,
        errors: result.errors,
        timestamp: new Date().toISOString(),
      });
    } else {
      // Sync specific category
      const { searchParams } = new URL(req.url);
      const category = searchParams.get("category") as Category | null;

      if (!category || !VALID_CATEGORIES.includes(category)) {
        return NextResponse.json(
          {
            error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
          },
          { status: 400 },
        );
      }

      const result = await syncCategory(category);

      logger.info(
        `Synced category: ${category}, added: ${result.itemsAdded} items`,
      );

      return NextResponse.json({
        success: true,
        category,
        itemsAdded: result.itemsAdded,
        itemsSkipped: result.itemsSkipped,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logger.error("Sync failed", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Sync failed",
      },
      { status: 500 },
    );
  }
}
