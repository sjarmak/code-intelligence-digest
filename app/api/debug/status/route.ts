/**
 * Debug endpoint to check system status
 */

import { NextResponse } from "next/server";
import { initializeDatabase } from "@/src/lib/db/index";
import { getSqlite } from "@/src/lib/db/index";
import { logger } from "@/src/lib/logger";

export async function GET() {
  try {
    await initializeDatabase();
    const sqlite = getSqlite();

    // Get item counts by category
    const categoryCounts = sqlite
      .prepare(
        `
      SELECT category, COUNT(*) as count
      FROM items
      GROUP BY category
      ORDER BY count DESC
    `
      )
      .all() as Array<{ category: string; count: number }>;

    // Get total embeddings
    const embeddingsCount = sqlite
      .prepare("SELECT COUNT(*) as count FROM item_embeddings")
      .get() as { count: number } | undefined;

    // Get recent items
    const recentItems = sqlite
      .prepare(
        `
      SELECT id, title, category, published_at
      FROM items
      ORDER BY published_at DESC
      LIMIT 10
    `
      )
      .all() as Array<{
      id: string;
      title: string;
      category: string;
      published_at: number;
    }>;

    return NextResponse.json({
      status: "ok",
      itemsByCategory: categoryCounts,
      totalEmbeddings: embeddingsCount?.count ?? 0,
      recentItems: recentItems.map((item) => ({
        ...item,
        published_at: new Date(item.published_at * 1000).toISOString(),
      })),
    });
  } catch (error) {
    logger.error("[DEBUG] Status check failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
