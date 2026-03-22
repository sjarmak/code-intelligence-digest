/**
 * Debug endpoint to test ranking logic
 * GET /api/debug/rank-test?category=newsletters&period=day
 */

import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase, resetDbClient } from "@/src/lib/db/index";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { loadScoresForItems } from "@/src/lib/db/items";
import { logger } from "@/src/lib/logger";
import type { Category } from "@/src/lib/model";
import { getDatabaseUrl, getDbClient } from "@/src/lib/db/driver";

const PERIOD_DAYS: Record<string, number> = {
  day: 2,
  week: 7,
  month: 30,
  all: 90,
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const categoryParam = searchParams.get("category") || "newsletters";
    const category = categoryParam as Category;
    const period = searchParams.get("period") || "day";
    const periodDays = PERIOD_DAYS[period] || 2;

    await initializeDatabase();

    // Force reset Postgres pool to avoid stale singleton client
    await resetDbClient();

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
    const ranked = await rankCategory(items, category, periodDays);

    // Check problematic item
    const problematicId = 'tag:google.com,2005:reader/item/0000000b19763690-article-12';
    const problematicItem = ranked.find(i => i.id === problematicId);

    const client = await getDbClient();
    const dbUrl = getDatabaseUrl();
    const dbHost =
      dbUrl && (() => {
        try {
          return new URL(dbUrl).host;
        } catch {
          return "unparsed";
        }
      })();

    const totalItemsRow = await client.query(
      "SELECT COUNT(*)::bigint AS count FROM items WHERE category = $1",
      [category],
    );
    const totalItems = { count: Number((totalItemsRow.rows[0] as { count: string }).count) };

    const twoDaysAgo = Math.floor((Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000);
    const recentInDbRow = await client.query(
      "SELECT COUNT(*)::bigint AS count FROM items WHERE category = $1 AND created_at >= $2",
      [category, twoDaysAgo],
    );
    const recentInDb = { count: Number((recentInDbRow.rows[0] as { count: string }).count) };

    // DEBUG: Check what loadItemsByCategory is actually querying
    const { loadItemsByCategory: loadItems } = await import("@/src/lib/db/items");

    const testCutoffTime = Math.floor((Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000);
    const testQueryResultRow = await client.query(
      "SELECT COUNT(*)::bigint AS count FROM items WHERE category = $1 AND created_at >= $2",
      [category, testCutoffTime],
    );
    const testQueryResult = { count: Number((testQueryResultRow.rows[0] as { count: string }).count) };

    const testRowsResult = await client.query(
      `SELECT * FROM items WHERE category = $1 AND created_at >= $2 ORDER BY created_at DESC`,
      [category, testCutoffTime],
    );
    const testRows = testRowsResult.rows as Array<Record<string, unknown>>;

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
      dbHost,
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
