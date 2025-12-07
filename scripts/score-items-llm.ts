/**
 * Score all cached items using GPT-4o
 * Stores results in item_scores table
 * Falls back to heuristics if OPENAI_API_KEY is not set
 */

import { initializeDatabase, getSqlite } from "../src/lib/db/index";
import { loadItemsByCategory } from "../src/lib/db/items";
import { scoreWithLLM } from "../src/lib/pipeline/llmScore";
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

const BATCH_SIZE = 30; // Items per API call

async function main() {
  console.log("\n=== Scoring Items with GPT-4o ===\n");

  // Check API key
  if (!process.env.OPENAI_API_KEY) {
    console.log("⚠️  OPENAI_API_KEY not set - using heuristic scoring fallback\n");
  }

  // Initialize database
  await initializeDatabase();
  const sqlite = getSqlite();

  let totalScored = 0;
  let totalBatches = 0;

  // Score each category
  for (const category of CATEGORIES) {
    console.log(`\n📊 ${category.toUpperCase()}`);

    // Load items for this category (30-day window)
    const items = await loadItemsByCategory(category, 30);

    if (items.length === 0) {
      console.log("  No items in this category");
      continue;
    }

    console.log(`  Scoring ${items.length} items in ${Math.ceil(items.length / BATCH_SIZE)} batches...`);

    // Score all items in this category
    const results = await scoreWithLLM(items, BATCH_SIZE);
    totalBatches += Math.ceil(items.length / BATCH_SIZE);

    // Store scores in database
    const updateStmt = sqlite.prepare(`
      UPDATE item_scores
      SET llm_relevance = ?, llm_usefulness = ?, llm_tags = ?
      WHERE item_id = ?
    `);

    const transaction = sqlite.transaction((itemsToUpdate: typeof items) => {
      for (const item of itemsToUpdate) {
        const result = results[item.id];
        if (result) {
          updateStmt.run(
            result.relevance,
            result.usefulness,
            JSON.stringify(result.tags),
            item.id
          );
        }
      }
    });

    transaction(items);
    totalScored += items.length;

    console.log(`  ✓ Stored ${items.length} LLM scores`);
  }

  console.log(`\n\n✅ Scored ${totalScored} items with GPT-4o in ${totalBatches} batches\n`);
}

main().catch((error) => {
  logger.error("Scoring failed", error);
  process.exit(1);
});
