/**
 * Verify BM25 scores were stored correctly
 */

import { initializeDatabase, getSqlite } from "../src/lib/db/index";
import { logger } from "../src/lib/logger";

async function main() {
  console.log("\n=== Verifying BM25 Scores ===\n");

  await initializeDatabase();
  const sqlite = getSqlite();

  // Overall stats
  const overallStats = sqlite
    .prepare(
      `
    SELECT 
      COUNT(*) as total_scores,
      COUNT(DISTINCT item_id) as unique_items,
      COUNT(DISTINCT category) as categories,
      AVG(bm25_score) as avg_bm25,
      MAX(bm25_score) as max_bm25,
      MIN(bm25_score) as min_bm25
    FROM item_scores
  `
    )
    .get() as { total_scores: number; unique_items: number; categories: number; avg_bm25: number; max_bm25: number; min_bm25: number };

  console.log("📊 Overall Statistics:");
  console.log(`  Total scores: ${overallStats.total_scores}`);
  console.log(`  Unique items: ${overallStats.unique_items}`);
  console.log(`  Categories: ${overallStats.categories}`);
  console.log(`  Avg BM25: ${(overallStats.avg_bm25 * 100).toFixed(1)}`);
  console.log(`  Max BM25: ${(overallStats.max_bm25 * 100).toFixed(1)}`);
  console.log(`  Min BM25: ${(overallStats.min_bm25 * 100).toFixed(1)}`);

  // By category
  console.log("\n📈 By Category:");
  const byCategory = sqlite
    .prepare(
      `
    SELECT 
      category,
      COUNT(*) as count,
      AVG(bm25_score) as avg_bm25,
      MAX(bm25_score) as max_bm25
    FROM item_scores
    GROUP BY category
    ORDER BY count DESC
  `
    )
    .all() as Array<{ category: string; count: number; avg_bm25: number; max_bm25: number }>;

  for (const row of byCategory) {
    console.log(
      `  ${row.category.padEnd(15)}: ${row.count.toString().padStart(5)} items | avg: ${(row.avg_bm25 * 100).toFixed(1).padStart(5)} | max: ${(row.max_bm25 * 100).toFixed(1).padStart(5)}`
    );
  }

  // Sample top-scored items
  console.log("\n⭐ Top 10 Items by BM25 Score:");
  const topItems = sqlite
    .prepare(
      `
    SELECT 
      i.title,
      i.source_title,
      i.category,
      s.bm25_score
    FROM item_scores s
    JOIN items i ON s.item_id = i.id
    ORDER BY s.bm25_score DESC
    LIMIT 10
  `
    )
    .all() as Array<{ title: string; source_title: string; category: string; bm25_score: number }>;

  for (let i = 0; i < topItems.length; i++) {
    const item = topItems[i];
    console.log(
      `  ${i + 1}. [${(item.bm25_score * 100).toFixed(1).padStart(5)}] ${item.category.padEnd(12)} | ${item.source_title.substring(0, 25).padEnd(25)} | ${item.title.substring(0, 50)}`
    );
  }

  console.log("\n✅ Verification complete!\n");
}

main().catch((error) => {
  logger.error("Verification failed", error);
  process.exit(1);
});
