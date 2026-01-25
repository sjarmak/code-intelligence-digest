/**
 * Test BM25 ranking
 * Scores cached items and displays top results by category
 */

import { initializeDatabase } from "../src/lib/db/index";
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
  console.log("\n=== BM25 Ranking Test ===\n");

  // Initialize database
  await initializeDatabase();

  // Test each category
  for (const category of CATEGORIES) {
    console.log(`\n📊 ${category.toUpperCase()}`);
    console.log("=".repeat(60));

    // Load items for this category
    const items = await loadItemsByCategory(category, 30);

    if (items.length === 0) {
      console.log("No items in this category");
      continue;
    }

    console.log(`Total items: ${items.length}`);

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

    // Create ranking
    const ranked = items
      .map((item) => ({
        item,
        score: bm25Normalized.get(item.id) || 0,
      }))
      .sort((a, b) => b.score - a.score);

    // Show top 5
    console.log("\nTop 5:");
    for (let i = 0; i < Math.min(5, ranked.length); i++) {
      const r = ranked[i];
      console.log(`\n  ${i + 1}. [${(r.score * 100).toFixed(1)}] ${r.item.sourceTitle}`);
      console.log(`     ${r.item.title.substring(0, 80)}`);
    }

    // Score distribution
    const scored = ranked.filter((r) => r.score > 0.1);
    const avg = ranked.length > 0 ? ranked.reduce((a, b) => a + b.score, 0) / ranked.length : 0;
    console.log(`\nScore stats:`);
    console.log(`  Items with score > 0.1: ${scored.length}/${items.length}`);
    console.log(`  Avg score: ${(avg * 100).toFixed(1)}`);
    console.log(`  Max score: ${(ranked[0]?.score * 100).toFixed(1)}`);
  }

  console.log("\n\n✅ BM25 test complete!\n");
}

main().catch((error) => {
  logger.error("Test failed", error);
  process.exit(1);
});
