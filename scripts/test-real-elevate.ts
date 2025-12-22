import { decomposeNewsletterItem } from "../src/lib/pipeline/decompose";
import type { RankedItem } from "../src/lib/model";
import Database from "better-sqlite3";

const db = new Database(".data/digest.db");

// Get actual Elevate newsletter content
const row = db.prepare(`
  SELECT id, source_title, title, url, summary
  FROM items
  WHERE source_title = 'Elevate'
  ORDER BY published_at DESC LIMIT 1
`).get() as { id: string; source_title: string; title: string; url: string; summary: string } | undefined;

if (!row) {
  console.log("No Elevate newsletters found in database");
  process.exit(0);
}

const summaryLen = row.summary ? row.summary.length : 0;
console.log(`Testing with: "${row.title}" (${summaryLen} chars)`);

const mockItem: RankedItem = {
  id: row.id,
  streamId: "test",
  sourceTitle: row.source_title,
  title: row.title,
  url: row.url,
  author: undefined,
  publishedAt: new Date(),
  summary: row.summary,
  contentSnippet: "",
  categories: [],
  category: "newsletters",
  raw: {},
  bm25Score: 0.5,
  llmScore: { relevance: 7, usefulness: 6, tags: ["ai"] },
  recencyScore: 0.9,
  finalScore: 0.7,
  reasoning: "Test item"
};

const result = decomposeNewsletterItem(mockItem);
console.log(`\nDecomposed into ${result.length} articles:`);
result.slice(0, 10).forEach((r, i) => {
  console.log(`${i + 1}. ${r.title.substring(0, 60)}...`);
  console.log(`   URL: ${r.url}`);
  console.log(`   Valid shareable URL: ${r.url.includes('/p/') || !r.url.includes('inoreader.com')}`);
});

if (result.length > 10) {
  console.log(`... and ${result.length - 10} more`);
}
