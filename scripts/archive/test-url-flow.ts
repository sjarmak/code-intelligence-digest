#!/usr/bin/env node

/**
 * Test URL flow through decomposition and extraction
 * Simulates what happens in newsletter generation pipeline
 */

import Database from "better-sqlite3";
import { decomposeNewsletterItems } from "../src/lib/pipeline/decompose";
import { RankedItem } from "../src/lib/model";
import { logger } from "../src/lib/logger";

const db = new Database(".data/digest.db");

// Get one newsletter item
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
  WHERE category = 'newsletters'
  AND source_title IN ('TLDR', 'Byte Byte Go', 'Elevate')
  LIMIT 1
`);

const dbItem = stmt.get() as {
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
  console.log("No newsletter items found");
  process.exit(1);
}

// Convert to RankedItem
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
  reasoning: "Test URL flow",
  fullText: dbItem.summary,
};

console.log(`\n🔍 Testing URL flow for: ${dbItem.source_title}`);
console.log(`Original item URL: ${rankedItem.url}`);
console.log(`Summary length: ${(rankedItem.summary || "").length} chars\n`);

// Decompose
console.log("Calling decomposeNewsletterItems()...\n");
const decomposed = decomposeNewsletterItems([rankedItem]);

console.log(`\n📊 Decomposition Results:`);
console.log(`Original items: 1`);
console.log(`Decomposed items: ${decomposed.length}`);

for (let i = 0; i < Math.min(3, decomposed.length); i++) {
  const item = decomposed[i];
  console.log(`\n[${i+1}] ${item.title.substring(0, 50)}...`);
  console.log(`    ID: ${item.id}`);
  console.log(`    URL: ${item.url}`);
  console.log(`    Has fullText: ${!!(item.fullText)}`);
}

console.log(`\n✅ Check above URLs - they should NOT be Inoreader URLs\n`);

db.close();
