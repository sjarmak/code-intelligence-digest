#!/usr/bin/env node

/**
 * Sanity check: Full newsletter URL pipeline test
 * Loads a real newsletter item, decomposes it, extracts digest, checks URLs at each step
 */

import Database from "better-sqlite3";
import { decomposeNewsletterItems } from "../src/lib/pipeline/decompose";
import { extractBatchDigests } from "../src/lib/pipeline/extract";
import { RankedItem } from "../src/lib/model";

const db = new Database(".data/digest.db");

async function testPipeline() {
  console.log("\n🔍 Newsletter URL Pipeline Sanity Check\n");

  // Test each newsletter source
  const sources = [
    "TLDR",
    "Byte Byte Go",
    "Elevate",
    "System Design",
    "Architecture Notes",
    "Leadership in Tech",
    "Programming Digest",
    "Pointer",
  ];

  for (const source of sources) {
    const stmt = db.prepare(`
      SELECT 
        id, source_title, title, url, summary, content_snippet, category, author
      FROM items 
      WHERE category = 'newsletters'
      AND source_title = ?
      LIMIT 1
    `);

    const dbItem = stmt.get(source) as {
      id: string;
      source_title: string;
      title: string;
      url: string;
      summary: string;
      content_snippet: string;
      category: string;
      author: string | null;
    } | undefined;

    if (!dbItem) {
      console.log(`⚠️  ${source}: Not found\n`);
      continue;
    }

    const dbUrl = dbItem.url;
    const isInoreaderUrl = dbUrl.includes("inoreader.com");

    // Create RankedItem
    const rankedItem: RankedItem = {
      id: dbItem.id,
      streamId: "test",
      sourceTitle: dbItem.source_title,
      title: dbItem.title,
      url: dbItem.url,
      author: dbItem.author || undefined,
      publishedAt: new Date(),
      summary: dbItem.summary || "",
      contentSnippet: dbItem.content_snippet || "",
      categories: [dbItem.category as any],
      category: dbItem.category as any,
      raw: {},
      bm25Score: 0.8,
      llmScore: { relevance: 8, usefulness: 7, tags: ["test"] },
      recencyScore: 0.9,
      finalScore: 0.85,
      reasoning: "Test",
      fullText: dbItem.summary,
    };

    console.log(`📰 ${source}`);
    console.log(`   DB URL: ${dbUrl.substring(0, 80)}...`);

    // Step 1: Decomposition
    const decomposed = decomposeNewsletterItems([rankedItem]);
    console.log(`   Decomposed: ${decomposed.length} items`);

    if (decomposed.length > 0) {
      const firstDecomposed = decomposed[0];
      const decomposedUrl = firstDecomposed.url;
      const isDecomposedRealUrl = !decomposedUrl.includes("inoreader.com");

      console.log(`   [1] URL: ${decomposedUrl.substring(0, 80)}...`);
      console.log(`       Real URL: ${isDecomposedRealUrl ? "✅" : "❌"}`);

      // Step 2: Extraction
      try {
        const digests = await extractBatchDigests(decomposed, "");
        console.log(`   Extracted: ${digests.length} digests`);

        if (digests.length > 0) {
          const firstDigest = digests[0];
          const digestUrl = firstDigest.url;
          const isDigestRealUrl = !digestUrl.includes("inoreader.com");

          console.log(`   [1] Digest URL: ${digestUrl.substring(0, 80)}...`);
          console.log(`       Real URL: ${isDigestRealUrl ? "✅" : "❌"}`);

          // Check flow
          if (isInoreaderUrl && isDecomposedRealUrl && isDigestRealUrl) {
            console.log(`   ✅ Flow: Inoreader → Real URL → Real URL (GOOD)`);
          } else if (isInoreaderUrl && isDecomposedRealUrl && !isDigestRealUrl) {
            console.log(`   ❌ Flow: Inoreader → Real URL → Lost in extraction`);
          } else if (isInoreaderUrl && !isDecomposedRealUrl) {
            console.log(`   ❌ Flow: Inoreader → Failed to decompose`);
          }
        }
      } catch (e) {
        console.log(`   ❌ Extraction failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    console.log();
  }

  console.log("✅ Sanity check complete\n");
}

testPipeline().catch(console.error);
