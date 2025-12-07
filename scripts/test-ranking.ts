/**
 * Test script to verify hybrid ranking (BM25 + LLM + recency)
 * Loads items, ranks them, and verifies results are sensible
 */

import { loadItemsByCategory } from "../src/lib/db/items";
import { rankCategory } from "../src/lib/pipeline/rank";
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

async function testRanking() {
  logger.info("Starting ranking tests...");
  console.log("\n=== HYBRID RANKING TEST ===\n");

  const results: Record<
    string,
    {
      itemsLoaded: number;
      itemsRanked: number;
      topItems: Array<{
        title: string;
        finalScore: number;
        llmRelevance: number;
        bm25: number;
        recency: number;
      }>;
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

      // Extract top 5 for display
      const topItems = rankedItems.slice(0, 5).map((item) => ({
        title: item.title.substring(0, 60),
        finalScore: Number(item.finalScore.toFixed(3)),
        llmRelevance: item.llmScore.relevance,
        bm25: Number(item.bm25Score.toFixed(3)),
        recency: Number(item.recencyScore.toFixed(3)),
      }));

      results[category] = {
        itemsLoaded: items.length,
        itemsRanked: rankedItems.length,
        topItems,
      };
    } catch (error) {
      logger.error(`Failed to rank category ${category}`, { error });
    }
  }

  // Display results
  console.log("RANKING RESULTS BY CATEGORY");
  console.log("=============================\n");

  for (const category of CATEGORIES) {
    const result = results[category];
    if (!result) continue;

    console.log(`📁 ${category.toUpperCase()}`);
    console.log(
      `   Loaded: ${result.itemsLoaded} items | Ranked: ${result.itemsRanked} items`
    );
    console.log(`   Filtered: ${result.itemsLoaded - result.itemsRanked} (off-topic or low relevance)`);
    console.log(`\n   Top Items:`);

    result.topItems.forEach((item, idx) => {
      console.log(`   ${idx + 1}. ${item.title}...`);
      console.log(
        `      Final: ${item.finalScore.toFixed(3)} (LLM: ${item.llmRelevance}/10 | BM25: ${item.bm25.toFixed(3)} | Recency: ${item.recency.toFixed(3)})`
      );
    });

    console.log("");
  }

  // Verify score ranges
  console.log("\n=== SCORE VALIDATION ===\n");
  let totalItems = 0;
  let validScores = 0;

  for (const category of CATEGORIES) {
    const result = results[category];
    if (!result) continue;

    for (const item of result.topItems) {
      totalItems++;
      const isValid =
        item.finalScore >= 0 &&
        item.finalScore <= 1 &&
        item.llmRelevance >= 0 &&
        item.llmRelevance <= 10 &&
        item.bm25 >= 0 &&
        item.bm25 <= 1 &&
        item.recency >= 0.2 &&
        item.recency <= 1;

      if (isValid) {
        validScores++;
      } else {
        console.log(`❌ Invalid scores for: ${item.title}`);
        console.log(`   Final: ${item.finalScore}, LLM: ${item.llmRelevance}, BM25: ${item.bm25}, Recency: ${item.recency}`);
      }
    }
  }

  console.log(`✅ Score validation: ${validScores}/${totalItems} items have valid scores`);

  if (validScores === totalItems && totalItems > 0) {
    console.log("✅ All tests passed!");
    process.exit(0);
  } else {
    console.log("❌ Some tests failed");
    process.exit(1);
  }
}

testRanking();
