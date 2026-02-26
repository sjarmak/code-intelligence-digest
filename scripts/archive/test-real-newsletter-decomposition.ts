#!/usr/bin/env node

/**
 * Test newsletter decomposition with real data from digest.db
 * Pulls actual TLDR/Elevate/Byte Byte Go items and tests URL extraction
 */

import Database from "better-sqlite3";
import { decomposeNewsletterItem } from "../src/lib/pipeline/decompose";
import { RankedItem } from "../src/lib/model";

const db = new Database(".data/digest.db");

// Fetch real newsletter items
const stmt = db.prepare(`
  SELECT 
    id, 
    source_title,
    title,
    url,
    summary,
    content_snippet,
    category,
    author
  FROM items 
  WHERE source_title IN ('TLDR', 'Byte Byte Go', 'Elevate', 'Pointer')
  LIMIT 5
`);

const items = stmt.all() as Array<{
  id: string;
  source_title: string;
  title: string;
  url: string;
  summary: string;
  content_snippet: string;
  category: string;
  author: string | null;
}>;

console.log(`\n📰 Testing decomposition on ${items.length} real newsletter items\n`);

for (const dbItem of items) {
  // Convert DB item to RankedItem format
  const rankedItem: RankedItem = {
    id: dbItem.id,
    streamId: "test-stream",
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
    llmScore: {
      relevance: 8,
      usefulness: 7,
      tags: ["test"],
    },
    recencyScore: 0.9,
    finalScore: 0.85,
    reasoning: "Test decomposition",
  };

  console.log(`\n${"=".repeat(80)}`);
  console.log(`📌 Source: ${dbItem.source_title}`);
  console.log(`📝 Title: ${dbItem.title.substring(0, 60)}...`);
  console.log(`📊 Summary length: ${(dbItem.summary || "").length} chars`);

  // Run decomposition
  const decomposed = decomposeNewsletterItem(rankedItem);

  console.log(`\n✨ Decomposition Results:`);
  console.log(`   Original: 1 item`);
  console.log(`   Decomposed: ${decomposed.length} items\n`);

  // Show extracted articles
  for (let i = 0; i < decomposed.length; i++) {
    const article = decomposed[i];
    const isValid =
      article.url && !article.url.includes("inoreader.com") && article.url.startsWith("http");

    console.log(`   [${i + 1}] "${article.title.substring(0, 50)}..."`);
    console.log(`       URL: ${article.url ? "✅" : "❌"} ${article.url}`);
    console.log(`       Valid: ${isValid ? "✅ YES" : "❌ NO"}`);
  }
}

console.log(`\n${"=".repeat(80)}\n`);

db.close();
