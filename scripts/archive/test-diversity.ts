/**
 * Test script for diversity selection
 * Validates per-source caps and greedy selection algorithm
 */

import { loadItemsByCategory } from "../src/lib/db/items";
import { rankCategory } from "../src/lib/pipeline/rank";
import { selectWithDiversity } from "../src/lib/pipeline/select";
import { Category } from "../src/lib/model";
import { logger } from "../src/lib/logger";

const CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "product_news",
  "community",
  "research",
];

async function testDiversity() {
  logger.info("Testing diversity selection...");
  console.log("\n=== DIVERSITY SELECTION TEST ===\n");

  const results: Record<
    string,
    {
      itemsLoaded: number;
      itemsRanked: number;
      itemsSelected: number;
      sourceDistribution: Array<{ source: string; count: number }>;
      maxPerSource: number;
      topSelectedItems: Array<{ title: string; source: string; finalScore: number }>;
    }
  > = {};

  for (const category of CATEGORIES) {
    try {
      // Load items from database
      const items = await loadItemsByCategory(category, 7); // Weekly window

      if (items.length === 0) {
        logger.warn(`No items for category: ${category}`);
        continue;
      }

      // Rank items
      const rankedItems = await rankCategory(items, category, 7);

      // Apply diversity selection (2 per source for weekly)
      const selectionResult = selectWithDiversity(rankedItems, category, 2);
      const selectedItems = selectionResult.items;

      // Analyze source distribution
      const sourceCount = new Map<string, number>();
      for (const item of selectedItems) {
        const count = sourceCount.get(item.sourceTitle) ?? 0;
        sourceCount.set(item.sourceTitle, count + 1);
      }

      // Get top selected items
      const topSelectedItems = selectedItems.slice(0, 3).map((item) => ({
        title: item.title.substring(0, 50),
        source: item.sourceTitle,
        finalScore: Number(item.finalScore.toFixed(3)),
      }));

      // Sort sources by count
      const sourceDistribution = Array.from(sourceCount.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count);

      const maxCount = Math.max(...Array.from(sourceCount.values()), 0);

      results[category] = {
        itemsLoaded: items.length,
        itemsRanked: rankedItems.length,
        itemsSelected: selectedItems.length,
        sourceDistribution,
        maxPerSource: maxCount,
        topSelectedItems,
      };
    } catch (error) {
      logger.error(`Failed to test category ${category}`, { error });
    }
  }

  // Display results
  console.log("DIVERSITY SELECTION RESULTS BY CATEGORY");
  console.log("========================================\n");

  for (const category of CATEGORIES) {
    const result = results[category];
    if (!result) continue;

    console.log(`📁 ${category.toUpperCase()}`);
    console.log(
      `   Loaded: ${result.itemsLoaded} | Ranked: ${result.itemsRanked} | Selected: ${result.itemsSelected}`
    );
    console.log(`   Filtered by diversity: ${result.itemsRanked - result.itemsSelected}`);
    console.log(`   Max items per source: ${result.maxPerSource} (cap: 2)\n`);

    console.log(`   Top Selected Items:`);
    result.topSelectedItems.forEach((item, idx) => {
      console.log(`   ${idx + 1}. ${item.title}...`);
      console.log(`      Source: ${item.source} | Score: ${item.finalScore}`);
    });

    console.log(`\n   Source Distribution (top 5):`);
    result.sourceDistribution.slice(0, 5).forEach((src) => {
      console.log(`      ${src.source}: ${src.count} items`);
    });

    console.log("");
  }

  // Verify caps enforced
  console.log("\n=== CAP ENFORCEMENT VALIDATION ===\n");
  let totalCategories = 0;
  let capsEnforced = 0;

  for (const category of CATEGORIES) {
    const result = results[category];
    if (!result || result.itemsSelected === 0) continue;

    totalCategories++;
    const isEnforced = result.maxPerSource <= 2;

    console.log(
      `${isEnforced ? "✅" : "❌"} ${category}: max ${result.maxPerSource} per source (cap: 2)`
    );

    if (isEnforced) {
      capsEnforced++;
    }
  }

  console.log(`\n✅ Caps enforced: ${capsEnforced}/${totalCategories} categories`);

  if (capsEnforced === totalCategories && totalCategories > 0) {
    console.log("✅ All tests passed!");
    process.exit(0);
  } else {
    console.log("❌ Some tests failed");
    process.exit(1);
  }
}

testDiversity();
