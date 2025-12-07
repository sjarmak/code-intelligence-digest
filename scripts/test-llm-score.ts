/**
 * Test GPT-4o LLM scoring with a small sample
 * Evaluates 5-10 items to verify scoring works before processing all items
 */

import { initializeDatabase } from "../src/lib/db/index";
import { loadItemsByCategory } from "../src/lib/db/items";
import { scoreWithLLM, scoreWithHeuristics } from "../src/lib/pipeline/llmScore";
import { logger } from "../src/lib/logger";
import { Category } from "../src/lib/model";

async function main() {
  console.log("\n=== Testing LLM Scoring with GPT-4o ===\n");

  // Initialize database
  await initializeDatabase();

  // Load a small sample from each category
  const categories: Category[] = [
    "tech_articles",
    "newsletters",
    "research",
    "community",
  ];

  for (const category of categories) {
    console.log(`\n📊 ${category.toUpperCase()} (Sample of 3 items)`);
    console.log("=".repeat(70));

    // Load items for this category
    const allItems = await loadItemsByCategory(category, 30);

    if (allItems.length === 0) {
      console.log("No items in this category");
      continue;
    }

    // Take first 3 items for testing
    const sampleItems = allItems.slice(0, 3);
    console.log(`Testing with: ${sampleItems.map((i) => i.title.substring(0, 40)).join(" | ")}`);

    // Score with GPT-4o
    console.log("\n🤖 Scoring with GPT-4o...");
    const gptScores = await scoreWithLLM(sampleItems, 3);

    // Also show heuristic scores for comparison
    console.log("📋 Heuristic scores (fallback):");
    const heuristicScores = scoreWithHeuristics(sampleItems);

    // Display results
    console.log("\nResults:");
    for (const item of sampleItems) {
      const gpt = gptScores[item.id];
      const heur = heuristicScores[item.id];

      console.log(`\n  Title: ${item.title.substring(0, 60)}`);
      console.log(
        `  Source: ${item.sourceTitle} | Published: ${item.publishedAt.toISOString().split("T")[0]}`
      );

      if (gpt) {
        console.log(
          `  GPT-4o: relevance=${gpt.relevance}/10, usefulness=${gpt.usefulness}/10`
        );
        console.log(`  Tags: ${gpt.tags.join(", ") || "none"}`);
      } else {
        console.log("  GPT-4o: (failed to score)");
      }

      if (heur) {
        console.log(
          `  Heuristic: relevance=${heur.relevance}/10, usefulness=${heur.usefulness}/10`
        );
        console.log(`  Tags: ${heur.tags.join(", ") || "none"}`);
      }
    }
  }

  console.log("\n\n✅ LLM scoring test complete!\n");
}

main().catch((error) => {
  logger.error("Test failed", error);
  process.exit(1);
});
