/**
 * POST /api/admin/sync-starred
 * Syncs starred items from Inoreader and saves them to database
 * Can be integrated into daily sync or called manually for tuning
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchAllStarredItems } from "../../../../src/lib/inoreader/starred";
import { saveItems } from "../../../../src/lib/db/items";
import { saveStarredItems } from "../../../../src/lib/db/starredItems";
import { categorizeItems } from "../../../../src/lib/pipeline/categorize";
import { logger } from "../../../../src/lib/logger";
import { initializeDatabase } from "../../../../src/lib/db/index";
import { blockInProduction } from "../../../../src/lib/auth/guards";

export async function POST() {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {

    await initializeDatabase();

    logger.info("Starting sync-starred operation");

    // Fetch starred items from Inoreader
    const starredItemsMetadata = await fetchAllStarredItems();
    logger.info("Fetched starred items", { count: starredItemsMetadata.length });

    if (starredItemsMetadata.length === 0) {
      return NextResponse.json(
        {
          success: true,
          message: "No starred items found",
          stats: {
            fetched: 0,
            saved: 0,
            starred: 0,
          },
        },
        { status: 200 }
      );
    }

    // Manually create FeedItems from starred metadata
    // (bypass normalization which expects full Inoreader article structure)
    const feedItems = starredItemsMetadata.map((item) => ({
      id: item.id,
      streamId: "user/-/state/com.google/starred",
      sourceTitle: item.sourceTitle,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      summary: item.summary,
      contentSnippet: item.contentSnippet,
      categories: item.categories || [],
      category: "newsletters" as const, // Will be categorized next
      raw: {}, // Minimal raw data
    }));

    logger.info("Created FeedItems", { count: feedItems.length });

    // Categorize items
    const categorizedItems = categorizeItems(feedItems);
    logger.info("Categorized items", { count: categorizedItems.length });

    // Save items to database
    await saveItems(categorizedItems);
    logger.info("Saved items to database", { count: categorizedItems.length });

    // Track as starred items
    const starredRecords = categorizedItems.map((item, idx) => ({
      itemId: item.id,
      inoreaderItemId: starredItemsMetadata[idx].id,
      starredAt: starredItemsMetadata[idx].publishedAt,
    }));

    const starredCount = await saveStarredItems(starredRecords);
    logger.info("Marked items as starred", { count: starredCount });

    return NextResponse.json(
      {
        success: true,
        message: `Synced ${starredItemsMetadata.length} starred items`,
        stats: {
          fetched: starredItemsMetadata.length,
          saved: categorizedItems.length,
          starred: starredCount,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Failed to sync starred items", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    await initializeDatabase();

    // Return status of last sync
    // TODO: store sync state in database
    return NextResponse.json(
      {
        message: "Use POST to sync starred items",
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Failed to get sync-starred status", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
