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

const html = row.summary;
const articles: Array<{ title: string; url: string }> = [];
const seen = new Set<string>();

// Clean HTML entities
const cleanHtml = html
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

// Normalize and find HTML anchors
const normalizedHtml = cleanHtml.replace(/href=["']([^"'][\s\S]*?)["']/g, 'href="$1"').replace(/\n/g, '');
const htmlLinkRegex = /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;

let match;
let count = 0;
while ((match = htmlLinkRegex.exec(normalizedHtml)) !== null && count < 20) {
  const [, rawUrl, rawTitle] = match;
  const title = rawTitle.replace(/<[^>]*>/g, "").trim();
  let url = rawUrl;

  // For Substack redirect URLs
  if (rawUrl.includes("substack.com/redirect/2/")) {
    const base64Match = rawUrl.match(/substack\.com\/redirect\/2\/([A-Za-z0-9_-]+)/);
    if (base64Match) {
      try {
        const base64 = base64Match[1].replace(/-/g, "+").replace(/_/g, "/");
        const decoded = Buffer.from(base64, "base64").toString("utf-8");
        const payload = JSON.parse(decoded);
        if (payload.e && typeof payload.e === "string") {
          url = payload.e;
        }
      } catch {
        // Failed to decode
      }
    }
  }

  const normalizedUrl = url.replace(/&amp;/g, "&");
  const isSubstackDomain = normalizedUrl.includes(".substack.com/") ||
                           normalizedUrl.includes("substack.com/");
  const hasP = normalizedUrl.includes("/p/");
  const isOpen = normalizedUrl.includes("open.substack.com/");
  const isAction = normalizedUrl.includes("action=restack") ||
                   normalizedUrl.includes("action=share") ||
                   normalizedUrl.includes("redirect=app-store");
  const isSubstackPost = isSubstackDomain && hasP && !isOpen && !isAction;
  const isSubscribe = normalizedUrl.includes("/subscribe");

  if (isSubstackDomain && hasP && !seen.has(url)) {
    console.log(`\n[${++count}] Title: "${title.substring(0, 50)}..."`);
    console.log(`    Original URL: ${rawUrl.substring(0, 60)}...`);
    console.log(`    Decoded URL: ${url.substring(0, 80)}...`);
    console.log(`    isSubstackPost: ${isSubstackPost} (has/p/: ${hasP}, isOpen: ${isOpen}, isAction: ${isAction})`);
    console.log(`    isSubscribe: ${isSubscribe}`);

    if (isSubstackPost && !isSubscribe) {
      articles.push({ title, url });
      seen.add(url);
    }
  }
}

console.log(`\n=== Found ${articles.length} valid post URLs ===`);
articles.forEach((a, i) => {
  console.log(`${i + 1}. ${a.title.substring(0, 50)}...`);
  console.log(`   ${a.url}`);
});
