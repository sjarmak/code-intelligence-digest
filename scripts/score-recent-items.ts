/**
 * Score recent items (last N days) in the database
 * More practical than scoring all 14k+ items
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

// Default to last 30 days, can be overridden with command line arg
const DAYS = process.argv[2] ? parseInt(process.argv[2], 10) : 30;

async function main() {
  console.log(`\n=== Scoring Recent Items (Last ${DAYS} Days) ===\n`);

  // Initialize database
  await initializeDatabase();

  let totalScored = 0;
  const categoriesScored: Category[] = [];

  // Score each category
  for (const category of CATEGORIES) {
    console.log(`\n📊 ${category.toUpperCase()}`);

    // Load items for this category within the time window
    const items = await loadItemsByCategory(category, DAYS);

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

