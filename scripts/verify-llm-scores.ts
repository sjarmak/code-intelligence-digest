/**
 * Verify LLM scores were stored correctly
 */

import { initializeDatabase, getSqlite } from "../src/lib/db/index";
import { logger } from "../src/lib/logger";

async function main() {
  console.log("\n=== Verifying LLM Scores ===\n");

  await initializeDatabase();
  const sqlite = getSqlite();

  // Overall stats
  const overallStats = sqlite
    .prepare(
      `
    SELECT 
      COUNT(*) as total_scores,
      SUM(CASE WHEN llm_relevance IS NOT NULL THEN 1 ELSE 0 END) as llm_scored,
      AVG(llm_relevance) as avg_relevance,
      AVG(llm_usefulness) as avg_usefulness,
      MAX(llm_relevance) as max_relevance
    FROM item_scores
  `
    )
    .get() as {
    total_scores: number;
    llm_scored: number;
    avg_relevance: number;
    avg_usefulness: number;
    max_relevance: number;
  };

  console.log("📊 LLM Scoring Statistics:");
  console.log(
    `  Total scores: ${overallStats.total_scores} (${overallStats.llm_scored} with LLM)`
  );
  console.log(
    `  Coverage: ${((overallStats.llm_scored / overallStats.total_scores) * 100).toFixed(1)}%`
  );
  console.log(`  Avg relevance: ${overallStats.avg_relevance.toFixed(1)}/10`);
  console.log(`  Avg usefulness: ${overallStats.avg_usefulness.toFixed(1)}/10`);
  console.log(`  Max relevance: ${overallStats.max_relevance}/10`);

  // By category
  console.log("\n📈 LLM Scores by Category:");
  const byCategory = sqlite
    .prepare(
      `
    SELECT 
      category,
      COUNT(*) as count,
      SUM(CASE WHEN llm_relevance IS NOT NULL THEN 1 ELSE 0 END) as llm_scored,
      AVG(llm_relevance) as avg_relevance,
      AVG(llm_usefulness) as avg_usefulness
    FROM item_scores
    GROUP BY category
    ORDER BY count DESC
  `
    )
    .all() as Array<{
    category: string;
    count: number;
    llm_scored: number;
    avg_relevance: number;
    avg_usefulness: number;
  }>;

  for (const row of byCategory) {
    const coverage = ((row.llm_scored / row.count) * 100).toFixed(0);
    console.log(
      `  ${row.category.padEnd(15)}: ${row.count.toString().padStart(5)} items | LLM: ${row.llm_scored} (${coverage}%) | rel: ${row.avg_relevance.toFixed(1)} | use: ${row.avg_usefulness.toFixed(1)}`
    );
  }

  // Sample high-scoring items
  console.log("\n⭐ Top 10 Items by LLM Relevance:");
  const topItems = sqlite
    .prepare(
      `
    SELECT 
      i.title,
      i.source_title,
      i.category,
      s.llm_relevance,
      s.llm_usefulness,
      s.llm_tags
    FROM item_scores s
    JOIN items i ON s.item_id = i.id
    WHERE s.llm_relevance IS NOT NULL
    ORDER BY s.llm_relevance DESC
    LIMIT 10
  `
    )
    .all() as Array<{
    title: string;
    source_title: string;
    category: string;
    llm_relevance: number;
    llm_usefulness: number;
    llm_tags: string;
  }>;

  for (let i = 0; i < topItems.length; i++) {
    const item = topItems[i];
    const tags = item.llm_tags ? JSON.parse(item.llm_tags) : [];
    console.log(
      `  ${i + 1}. [R:${item.llm_relevance.toFixed(1)}/U:${item.llm_usefulness.toFixed(1)}] ${item.category.padEnd(12)} | ${item.title.substring(0, 50)}`
    );
    console.log(`     Tags: ${tags.join(", ") || "none"}`);
  }

  console.log("\n✅ Verification complete!\n");
}

main().catch((error) => {
  logger.error("Verification failed", error);
  process.exit(1);
});
