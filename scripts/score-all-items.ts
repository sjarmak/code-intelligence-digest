/**
 * One-time script to score all existing items in the database
 * Uses the new computeAndSaveScoresForItems function to score items by category
 */

import { initializeDatabase } from "../src/lib/db/index";
import { loadItemsByCategory } from "../src/lib/db/items";
import { computeAndSaveScoresForCategory } from "../src/lib/pipeline/compute-scores";
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
  console.log("\n=== Scoring All Existing Items ===\n");

  // Initialize database
  await initializeDatabase();

  let totalScored = 0;
  const categoriesScored: Category[] = [];

  // Score each category
  for (const category of CATEGORIES) {
    console.log(`\n📊 ${category.toUpperCase()}`);

    // Load ALL items for this category (no time limit for one-time scoring)
    // Use a large window to get all items
    const items = await loadItemsByCategory(category, 365); // 1 year window

    if (items.length === 0) {
      console.log("  No items in this category");
      continue;
    }

    console.log(`  Found ${items.length} items to score...`);

    try {
      const scored = await computeAndSaveScoresForCategory(items, category);
      totalScored += scored;
      if (scored > 0) {
        categoriesScored.push(category);
      }
      console.log(`  ✓ Scored ${scored} items`);
    } catch (error) {
      logger.error(`Failed to score items for category ${category}`, error);
      console.log(`  ✗ Failed to score items: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n\n✅ Complete: Scored ${totalScored} items across ${categoriesScored.length} categories\n`);
  console.log(`Categories scored: ${categoriesScored.join(", ")}\n`);
}

main().catch((error) => {
  logger.error("Scoring failed", error);
  console.error("Scoring failed:", error);
  process.exit(1);
});

