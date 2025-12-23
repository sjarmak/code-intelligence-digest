/**
 * API route: GET /api/admin/cache/status
 * Check cache status and expiration times
 */

import { NextResponse } from "next/server";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { getAllCacheMetadata, isCacheExpired } from "@/src/lib/db/cache";
import { blockInProduction } from "@/src/lib/auth/guards";

/**
 * GET /api/admin/cache/status
 */
export async function GET() {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    logger.info("[CACHE] Status check requested");

    // Initialize database
    await initializeDatabase();

    // Get all cache metadata
    const allMetadata = await getAllCacheMetadata();

    const now = Math.floor(Date.now() / 1000);
    const status = await Promise.all(
      allMetadata.map(async (meta) => {
        const isExpired = await isCacheExpired(meta.key);
        const timeUntilExpiry = meta.expiresAt ? meta.expiresAt - now : null;

        return {
          key: meta.key,
          count: meta.count,
          lastRefreshAt: meta.lastRefreshAt
            ? new Date(meta.lastRefreshAt * 1000).toISOString()
            : null,
          expiresAt: meta.expiresAt ? new Date(meta.expiresAt * 1000).toISOString() : null,
          timeUntilExpirySeconds: timeUntilExpiry,
          isExpired,
          status: isExpired
            ? "expired"
            : timeUntilExpiry && timeUntilExpiry < 300
              ? "expiring-soon"
              : "valid",
        };
      })
    );

    // Calculate summaries
    const validCount = status.filter((s) => s.status === "valid").length;
    const expiringCount = status.filter((s) => s.status === "expiring-soon").length;
    const expiredCount = status.filter((s) => s.status === "expired").length;
    const totalItems = status.reduce((sum, s) => sum + (s.count || 0), 0);

    logger.info(
      `[CACHE] Status: ${validCount} valid, ${expiringCount} expiring, ${expiredCount} expired`
    );

    return NextResponse.json({
      summary: {
        valid: validCount,
        expiringsoon: expiringCount,
        expired: expiredCount,
        totalCachedItems: totalItems,
      },
      caches: status,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("[CACHE] Error in cache status check", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to check cache status",
      },
      { status: 500 }
    );
  }
}
