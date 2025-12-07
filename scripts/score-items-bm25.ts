/**
 * Score all cached items using BM25
 * Stores results in item_scores table
 */

import { initializeDatabase, getSqlite } from "../src/lib/db/index";
import { loadItemsByCategory } from "../src/lib/db/items";
import { BM25Index } from "../src/lib/pipeline/bm25";
import { getCategoryConfig } from "../src/config/categories";
import { logger } from "../src/lib/logger";
import { Category } from "../src/lib/model";

const CATEGORIES: Category[] = [
  "newsletters",
  "tech_articles",
  "product_news",
  "community",
  "research",
  "ai_news",
  "podcasts",
];

async function main() {
  console.log("\n=== Scoring Items with BM25 ===\n");

  // Initialize database
  await initializeDatabase();
  const sqlite = getSqlite();

  let totalScored = 0;

  // Score each category
  for (const category of CATEGORIES) {
    console.log(`\n📊 ${category.toUpperCase()}`);

    // Load items for this category (30-day window)
    const items = await loadItemsByCategory(category, 30);

    if (items.length === 0) {
      console.log("  No items in this category");
      continue;
    }

    console.log(`  Scoring ${items.length} items...`);

    // Build BM25 index and score
    const bm25 = new BM25Index();
    bm25.addDocuments(items);

    const config = getCategoryConfig(category);
    const queryTerms = config.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    const bm25Scores = bm25.score(queryTerms);
    const bm25Normalized = bm25.normalizeScores(bm25Scores);

    // Store scores in database
    const insertStmt = sqlite.prepare(`
      INSERT OR REPLACE INTO item_scores 
      (item_id, category, bm25_score, llm_relevance, llm_usefulness, recency_score, final_score, scored_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `);

    const transaction = sqlite.transaction((scoredItems: typeof items) => {
      for (const item of scoredItems) {
        const bm25Score = bm25Normalized.get(item.id) || 0;

        insertStmt.run(
          item.id,
          category,
          bm25Score,
          5, // Placeholder LLM relevance (will be filled by LLM scoring)
          5, // Placeholder LLM usefulness
          0.5, // Placeholder recency score (will be computed properly in rank.ts)
          bm25Score // For now, final score = BM25 score
        );
      }
    });

    transaction(items);
    totalScored += items.length;

    console.log(`  ✓ Stored ${items.length} scores`);
  }

  console.log(`\n\n✅ Scored ${totalScored} total items with BM25\n`);
}

main().catch((error) => {
  logger.error("Scoring failed", error);
  process.exit(1);
});
