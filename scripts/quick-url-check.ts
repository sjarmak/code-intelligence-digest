#!/usr/bin/env node
/**
 * Quick URL sanity check - minimal output version
 * Run: npx tsx scripts/quick-url-check.ts
 */

import Database from "better-sqlite3";
import { decomposeNewsletterItems } from "../src/lib/pipeline/decompose";
import { RankedItem } from "../src/lib/model";

const db = new Database(".data/digest.db");

async function test() {
  const sources = ["TLDR", "System Design", "Architecture Notes"];
  let allPass = true;

  for (const source of sources) {
    const stmt = db.prepare(`
      SELECT id, source_title, title, url, summary, content_snippet, category, author
      FROM items WHERE category='newsletters' AND source_title=? LIMIT 1
    `);
    const item = stmt.get(source) as any;
    
    if (!item) continue;

    const ranked: RankedItem = {
      id: item.id,
      streamId: "test",
      sourceTitle: item.source_title,
      title: item.title,
      url: item.url,
      author: item.author,
      publishedAt: new Date(),
      summary: item.summary || "",
      contentSnippet: item.content_snippet || "",
      categories: [item.category],
      category: item.category,
      raw: {},
      bm25Score: 0.8,
      llmScore: { relevance: 8, usefulness: 7, tags: ["test"] },
      recencyScore: 0.9,
      finalScore: 0.85,
      reasoning: "Test",
      fullText: item.summary,
    };

    const decomposed = decomposeNewsletterItems([ranked]);
    if (decomposed.length > 0 && !decomposed[0].url.includes("inoreader.com")) {
      console.log(`✅ ${source}: URLs extracted correctly`);
    } else {
      console.log(`❌ ${source}: Failed to extract URLs`);
      allPass = false;
    }
  }

  db.close();
  process.exit(allPass ? 0 : 1);
}

test();
