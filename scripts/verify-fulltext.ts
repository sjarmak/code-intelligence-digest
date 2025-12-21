#!/usr/bin/env npx tsx

/**
 * Verify full text infrastructure is properly set up
 * 
 * Run with: npx tsx scripts/verify-fulltext.ts
 */

import { getSqlite } from "../src/lib/db/index";
import { logger } from "../src/lib/logger";
import { getFullTextCacheStats } from "../src/lib/db/items";

async function verify() {
  try {
    console.log("\n=== FULL TEXT INFRASTRUCTURE VERIFICATION ===\n");

    const sqlite = getSqlite();

    // 1. Check schema
    console.log("✓ Checking database schema...");
    const tableInfo = sqlite
      .prepare(`PRAGMA table_info(items)`)
      .all() as Array<{ name: string; type: string }>;

    const columnNames = tableInfo.map(col => col.name);
    const hasFullText = columnNames.includes("full_text");
    const hasFullTextFetchedAt = columnNames.includes("full_text_fetched_at");
    const hasFullTextSource = columnNames.includes("full_text_source");

    console.log(`  • full_text: ${hasFullText ? "✅" : "❌"}`);
    console.log(`  • full_text_fetched_at: ${hasFullTextFetchedAt ? "✅" : "❌"}`);
    console.log(`  • full_text_source: ${hasFullTextSource ? "✅" : "❌"}`);

    if (!hasFullText || !hasFullTextFetchedAt || !hasFullTextSource) {
      throw new Error("Schema verification failed");
    }

    // 2. Check indexes
    console.log("\n✓ Checking indexes...");
    const indexes = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='items'`)
      .all() as Array<{ name: string }>;

    const indexNames = indexes.map(idx => idx.name);
    console.log(`  • Found ${indexNames.length} indexes on items table`);
    indexNames.forEach(name => console.log(`    - ${name}`));

    // 3. Check cache stats
    console.log("\n✓ Checking cache statistics...");
    const stats = await getFullTextCacheStats();
    console.log(`  • Total items: ${stats.total}`);
    console.log(`  • Cached items: ${stats.cached}`);
    console.log(`  • Cache percentage: ${stats.total > 0 ? Math.round((stats.cached / stats.total) * 100) : 0}%`);
    console.log(`  • By source:`);
    Object.entries(stats.bySource).forEach(([source, count]) => {
      console.log(`    - ${source}: ${count}`);
    });

    // 4. Test database operations
    console.log("\n✓ Testing database functions...");

    // Try a sample save/load
    const testItemId = "test-fulltext-verify-" + Date.now();
    const testText = "This is a test full text content for verification.";
    const testSource = "web_scrape";
    const now = Math.floor(Date.now() / 1000);

    // Save
    sqlite
      .prepare(
        `INSERT INTO items 
         (id, stream_id, source_title, title, url, category, published_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(testItemId, "test-stream", "Test Source", "Test Title", "https://test.com", "newsletters", now);

    sqlite
      .prepare(
        `UPDATE items 
         SET full_text = ?, full_text_fetched_at = ?, full_text_source = ? 
         WHERE id = ?`
      )
      .run(testText, Math.floor(Date.now() / 1000), testSource, testItemId);

    // Load
    const loaded = sqlite
      .prepare(`SELECT full_text, full_text_source FROM items WHERE id = ?`)
      .get(testItemId) as { full_text: string; full_text_source: string } | undefined;

    if (loaded && loaded.full_text === testText && loaded.full_text_source === testSource) {
      console.log(`  ✅ Save/load test passed`);
    } else {
      throw new Error("Save/load test failed");
    }

    // Cleanup test
    sqlite.prepare(`DELETE FROM items WHERE id = ?`).run(testItemId);
    console.log(`  ✅ Cleanup successful`);

    // 5. Summary
    console.log("\n=== VERIFICATION COMPLETE ===");
    console.log("✅ Full text infrastructure is properly configured and functional\n");

    return true;
  } catch (error) {
    console.error("\n❌ Verification failed:");
    console.error(error instanceof Error ? error.message : String(error));
    console.log("\nThe migration may not have completed successfully.");
    console.log("Try running: npx tsx scripts/migrate-add-fulltext.ts");
    process.exit(1);
  }
}

verify();
