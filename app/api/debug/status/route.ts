/**
 * Debug endpoint to check system status
 */

import { NextResponse } from "next/server";
import { initializeDatabase } from "@/src/lib/db/index";
import { getDbClient } from "@/src/lib/db/driver";
import { logger } from "@/src/lib/logger";
import { blockInProduction } from "@/src/lib/auth/guards";

export async function GET() {
  // Block in production
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    await initializeDatabase();
    const client = await getDbClient();

    const categoryCountsResult = await client.query(`
      SELECT category, COUNT(*)::bigint AS count
      FROM items
      GROUP BY category
      ORDER BY count DESC
    `);
    const categoryCounts = (categoryCountsResult.rows as Array<{ category: string; count: string }>).map((r) => ({
      category: r.category,
      count: Number(r.count),
    }));

    const embeddingsCountResult = await client.query("SELECT COUNT(*)::bigint AS count FROM item_embeddings");
    const embeddingsCount = embeddingsCountResult.rows[0] as { count: string } | undefined;

    const recentItemsResult = await client.query(`
      SELECT id, title, category, published_at
      FROM items
      ORDER BY published_at DESC
      LIMIT 10
    `);
    const recentItems = recentItemsResult.rows as Array<{
      id: string;
      title: string;
      category: string;
      published_at: number;
    }>;

    return NextResponse.json({
      status: "ok",
      itemsByCategory: categoryCounts,
      totalEmbeddings: embeddingsCount ? Number(embeddingsCount.count) : 0,
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
