#!/usr/bin/env node

/**
 * Test decomposition for other newsletter sources (Architecture Notes, System Design, etc.)
 */

import Database from "better-sqlite3";
import { decomposeNewsletterItem } from "../src/lib/pipeline/decompose";
import { RankedItem } from "../src/lib/model";
import { logger } from "../src/lib/logger";

const db = new Database(".data/digest.db");

// Get one item from each newsletter source
const sources = ["Architecture Notes", "Leadership in Tech", "Programming Digest", "System Design"];

for (const source of sources) {
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
    console.log(`⚠️  ${source}: No items found\n`);
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
    reasoning: "Test",
    fullText: dbItem.summary,
  };

  console.log(`\n🔍 ${source}`);
  console.log(`   Original URL: ${rankedItem.url}`);
  console.log(`   Summary length: ${(rankedItem.summary || "").length} chars`);

  const decomposed = decomposeNewsletterItem(rankedItem);

  console.log(`   Decomposed into: ${decomposed.length} items`);
  
  if (decomposed.length > 1) {
    for (let i = 0; i < Math.min(2, decomposed.length); i++) {
      console.log(`   [${i+1}] ${decomposed[i].title.substring(0, 50)}... -> ${decomposed[i].url}`);
    }
  } else if (decomposed.length === 1 && decomposed[0].url !== rankedItem.url) {
    console.log(`   [1] ${decomposed[0].title.substring(0, 50)}... -> ${decomposed[0].url}`);
  }
}

console.log();
db.close();
