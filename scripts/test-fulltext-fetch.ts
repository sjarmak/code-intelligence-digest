#!/usr/bin/env npx tsx

/**
 * Test full text fetching with a real URL
 * 
 * Run with: npx tsx scripts/test-fulltext-fetch.ts
 */

import { fetchFullText } from "../src/lib/pipeline/fulltext";
import { logger } from "../src/lib/logger";

async function test() {
  console.log("\n=== TESTING FULL TEXT FETCHING ===\n");

  // Test with a real simple article
  const testItem = {
    id: "test-item",
    title: "Test Article",
    url: "https://example.com",
    sourceTitle: "Example",
    summary: "Test",
    category: "tech_articles" as const,
    categories: [],
    publishedAt: new Date(),
    streamId: "test",
    raw: {},
  };

  try {
    console.log(`Fetching from: ${testItem.url}`);
    console.log("(Note: This is a simple test. Real articles will have more content)\n");

    const result = await fetchFullText(testItem);

    console.log(`✅ Fetch completed`);
    console.log(`  Source: ${result.source}`);
    console.log(`  Length: ${result.length} characters`);
    console.log(`  Fetched at: ${result.fetchedAt.toISOString()}`);

    if (result.length > 0) {
      console.log(`  Sample (first 200 chars):`);
      console.log(`  "${result.text.substring(0, 200)}..."\n`);
    } else {
      console.log(`  (No content extracted - this is expected for example.com)\n`);
    }

    console.log("=== TEST COMPLETE ===\n");
  } catch (error) {
    console.error("Error during fetch:", error instanceof Error ? error.message : String(error));
  }
}

test();
