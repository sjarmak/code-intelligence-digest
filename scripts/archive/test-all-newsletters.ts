#!/usr/bin/env node

/**
 * Test URL extraction across ALL newsletter sources
 * Validates that decomposition and URL extraction works for every newsletter type
 */

import Database from "better-sqlite3";
import { decomposeNewsletterItem } from "../src/lib/pipeline/decompose";
import { RankedItem } from "../src/lib/model";

const db = new Database(".data/digest.db");

// Get all newsletter sources
const sourcesStmt = db.prepare(`
  SELECT DISTINCT source_title 
  FROM items 
  WHERE category='newsletters'
  ORDER BY source_title
`);

const sources = (sourcesStmt.all() as Array<{ source_title: string }>).map(r => r.source_title);

console.log(`\n📰 Testing URL extraction across ${sources.length} newsletter sources\n`);
console.log(`Sources: ${sources.join(", ")}\n`);

const results: Record<string, { total: number; decomposed: number; urlsExtracted: number; success: boolean }> = {};

for (const source of sources) {
  // Get one item from each newsletter
  const itemStmt = db.prepare(`
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
    WHERE source_title = ?
    LIMIT 1
  `);

  const dbItem = itemStmt.get(source) as {
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
    console.log(`⚠️  ${source}: No items found in database`);
    results[source] = { total: 0, decomposed: 0, urlsExtracted: 0, success: false };
    continue;
  }

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

  const decomposed = decomposeNewsletterItem(rankedItem);
  const urlsExtracted = decomposed.filter(item => item.url && item.url.length > 0).length;

  results[source] = {
    total: 1,
    decomposed: decomposed.length,
    urlsExtracted,
    success: decomposed.length > 0 && urlsExtracted > 0,
  };

  console.log(`✅ ${source}`);
  console.log(`   Decomposed: ${decomposed.length} articles`);
  console.log(`   URLs extracted: ${urlsExtracted}/${decomposed.length}`);
}

// Summary
console.log(`\n${"=".repeat(60)}\n📊 Summary\n`);

let allSuccess = true;
for (const source of sources) {
  const result = results[source];
  if (result.total === 0) {
    console.log(`⚠️  ${source}: No data`);
  } else {
    const status = result.success ? "✅" : "❌";
    console.log(`${status} ${source}: ${result.decomposed} articles, ${result.urlsExtracted} URLs`);
    if (!result.success) allSuccess = false;
  }
}

console.log(`\n${allSuccess ? "✅ All newsletters support URL extraction!" : "❌ Some newsletters need work"}\n`);
process.exit(allSuccess ? 0 : 1);
