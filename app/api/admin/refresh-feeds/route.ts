import { NextResponse } from "next/server";
import { getFeeds, clearFeedsCache } from "@/src/config/feeds";
import { logger } from "@/src/lib/logger";
import { getDbClient, detectDriver } from "@/src/lib/db/driver";
import { initializeDatabase } from "@/src/lib/db";

/**
 * Force refresh feeds from Inoreader, bypassing the database cache.
 * Works in both development and production.
 *
 * Usage: POST /api/admin/refresh-feeds
 */
export async function POST() {
  try {
    logger.info("[refresh-feeds] Starting forced feed refresh...");

    // Initialize database connection
    await initializeDatabase();

    // Clear the cache metadata and feeds table to force a fresh fetch from Inoreader
    const driver = detectDriver();
    const client = await getDbClient();

    if (driver === "postgres") {
      await client.run(`DELETE FROM cache_metadata WHERE key = $1`, ["feeds"]);
      await client.run(`DELETE FROM feeds`);
    } else {
      const { getSqlite } = await import("@/src/lib/db/index");
      const sqlite = getSqlite();
      sqlite.prepare(`DELETE FROM cache_metadata WHERE key = 'feeds'`).run();
      sqlite.prepare(`DELETE FROM feeds`).run();
    }

    logger.info("[refresh-feeds] DB cache invalidated, clearing in-memory cache...");

    // Clear in-memory cache so getFeeds() fetches fresh from Inoreader
    clearFeedsCache();

    const feeds = await getFeeds();

    logger.info(`[refresh-feeds] Refreshed ${feeds.length} feeds from Inoreader`);

    // Group by category for summary
    const byCategory: Record<string, number> = {};
    for (const feed of feeds) {
      byCategory[feed.defaultCategory] = (byCategory[feed.defaultCategory] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      feedCount: feeds.length,
      byCategory,
      message: "Feeds refreshed from Inoreader and cached",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[refresh-feeds] Feed refresh failed", { error });

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check current feed cache status
 */
export async function GET() {
  try {
    await initializeDatabase();

    const { getFeedsCacheMetadata, getFeedsCount } = await import("@/src/lib/db/feeds");

    const metadata = await getFeedsCacheMetadata();
    const count = await getFeedsCount();

    const now = Math.floor(Date.now() / 1000);
    const isExpired = !metadata?.expiresAt || metadata.expiresAt < now;
    const expiresIn = metadata?.expiresAt ? metadata.expiresAt - now : null;

    return NextResponse.json({
      feedCount: count,
      cacheMetadata: metadata,
      isExpired,
      expiresInSeconds: expiresIn,
      expiresInMinutes: expiresIn ? Math.round(expiresIn / 60) : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[refresh-feeds] Failed to get cache status", { error });

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 }
    );
  }
}
