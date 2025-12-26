/**
 * Debug endpoint to test ranking logic
 * GET /api/debug/rank-test?category=newsletters&period=day
 */

import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/src/lib/db/index";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { loadScoresForItems } from "@/src/lib/db/items";
import { logger } from "@/src/lib/logger";

const PERIOD_DAYS: Record<string, number> = {
  day: 2,
  week: 7,
  month: 30,
  all: 90,
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category") || "newsletters";
    const period = searchParams.get("period") || "day";
    const periodDays = PERIOD_DAYS[period] || 2;

    await initializeDatabase();

    // Force reset SQLite connection to avoid stale data
    const { resetSqliteConnection } = await import("@/src/lib/db/index");
    resetSqliteConnection();

    // Load items
    const items = await loadItemsByCategory(category, periodDays);

    // Check date filtering
    const now = Date.now();
    const windowMs = periodDays * 24 * 60 * 60 * 1000;
    const useCreatedAt = periodDays === 2;

    const recentItems = items.filter((item) => {
      const dateToUse = useCreatedAt && item.createdAt ? item.createdAt : item.publishedAt;
      const ageMs = now - dateToUse.getTime();
      return ageMs <= windowMs;
    });

    // Check scores
    const itemIds = recentItems.map(i => i.id);
    const scores = await loadScoresForItems(itemIds);
    const itemsWithScores = recentItems.filter(item => scores[item.id]);

    // Actually rank
    const ranked = await rankCategory(items, category as any, periodDays);

    // Check problematic item
    const problematicId = 'tag:google.com,2005:reader/item/0000000b19763690-article-12';
    const problematicItem = ranked.find(i => i.id === problematicId);

    // Check database path and connection info
    const { getSqlite } = await import("@/src/lib/db/index");
    const sqlite = getSqlite();
    const dbInfo = sqlite.prepare("PRAGMA database_list").all() as any[];
    const dbPath = dbInfo[0]?.file || "unknown";

    // Check total items in database
    const totalItems = sqlite.prepare("SELECT COUNT(*) as count FROM items WHERE category = ?").get(category) as { count: number };
    const twoDaysAgo = Math.floor((Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000);
    const recentInDb = sqlite.prepare("SELECT COUNT(*) as count FROM items WHERE category = ? AND created_at >= ?").get(category, twoDaysAgo) as { count: number };

    // DEBUG: Check what loadItemsByCategory is actually querying
    const { loadItemsByCategory: loadItems } = await import("@/src/lib/db/items");

    // Get fresh SQLite connection
    const { getSqlite: getFreshSqlite } = await import("@/src/lib/db/index");
    const freshSqlite = getFreshSqlite();

    const testCutoffTime = Math.floor((Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000);
    const testQueryResult = freshSqlite.prepare("SELECT COUNT(*) as count FROM items WHERE category = ? AND created_at >= ?").get(category, testCutoffTime) as { count: number };

    // Also test the exact query that loadItemsByCategory uses
    const testRows = freshSqlite.prepare(`SELECT * FROM items WHERE category = ? AND created_at >= ? ORDER BY created_at DESC`).all(category, testCutoffTime) as any[];

    const testItems = await loadItems(category, periodDays);

    return NextResponse.json({
      category,
      period,
      periodDays,
      loadedItems: items.length,
      recentItems: recentItems.length,
      itemsWithScores: itemsWithScores.length,
      rankedItems: ranked.length,
      problematicItem: problematicItem ? {
        id: problematicItem.id,
        title: problematicItem.title,
        finalScore: problematicItem.finalScore,
        llmRelevance: problematicItem.llmScore.relevance,
        llmUsefulness: problematicItem.llmScore.usefulness,
        hasScore: !!scores[problematicId],
        scoreData: scores[problematicId] ? {
          relevance: scores[problematicId].llm_relevance,
          usefulness: scores[problematicId].llm_usefulness,
        } : null,
      } : null,
      now: new Date(now).toISOString(),
      cutoffTime: new Date(now - windowMs).toISOString(),
      dbPath,
      totalItemsInDb: totalItems.count,
      recentItemsInDb: recentInDb.count,
      processCwd: process.cwd(),
      testQueryResult: testQueryResult.count,
      testRowsCount: testRows.length,
      testItemsCount: testItems.length,
      cutoffTimeUsed: testCutoffTime,
      cutoffDateUsed: new Date(testCutoffTime * 1000).toISOString(),
      mismatch: testRows.length !== testItems.length ? `SQL returned ${testRows.length} but loadItemsByCategory returned ${testItems.length}` : null,
    });
  } catch (error) {
    logger.error("Debug rank test failed", { error });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

