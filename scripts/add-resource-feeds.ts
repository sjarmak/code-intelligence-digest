#!/usr/bin/env tsx
/**
 * One-off: subscribe the personal technical-blog/newsletter reading list
 * (see brain vault Resources/Resources Index.md) to Inoreader, filed into
 * the existing Tech Articles / Newsletters folders so the normal
 * categorize/score pipeline picks them up on the next sync.
 *
 * Run once: npx tsx scripts/add-resource-feeds.ts
 */
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { createInoreaderClient } from "../src/lib/inoreader/client";
import { forceRefreshFeedsCache } from "../src/config/feeds";

const NEW_FEEDS: { url: string; folder: string; title: string }[] = [
  { url: "https://brandur.org/articles.atom", folder: "Tech Articles", title: "brandur.org" },
  { url: "https://increment.com/feed.xml", folder: "Tech Articles", title: "Increment" },
  { url: "https://notes.eatonphil.com/rss.xml", folder: "Tech Articles", title: "Phil Eaton" },
  { url: "https://www.morling.dev/blog/index.xml", folder: "Tech Articles", title: "morling.dev" },
  { url: "https://www.seangoedecke.com/rss.xml", folder: "Tech Articles", title: "Sean Goedecke" },
  { url: "https://eli.thegreenplace.net/feeds/all.atom.xml", folder: "Tech Articles", title: "Eli Bendersky" },
  { url: "https://www.farnamstreetblog.com/feed/", folder: "Newsletters", title: "Farnam Street" },
  { url: "https://www.brendangregg.com/blog/rss.xml", folder: "Tech Articles", title: "Brendan Gregg" },
  { url: "https://www.allthingsdistributed.com/atom.xml", folder: "Tech Articles", title: "All Things Distributed" },
  { url: "https://blog.jgc.org/feeds/posts/default", folder: "Tech Articles", title: "John Graham-Cumming" },
  { url: "https://aphyr.com/posts.atom", folder: "Tech Articles", title: "Aphyr" },
];

async function main() {
  const client = createInoreaderClient();
  const results: { title: string; ok: boolean; error?: string }[] = [];

  for (const feed of NEW_FEEDS) {
    try {
      await client.subscribeFeed(feed.url, feed.folder, feed.title);
      results.push({ title: feed.title, ok: true });
      console.log(`✓ ${feed.title} → ${feed.folder}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ title: feed.title, ok: false, error: message });
      console.error(`✗ ${feed.title}: ${message}`);
    }
    // stay well clear of Inoreader's rate limits between writes
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\n--- Refreshing feeds cache ---");
  const refresh = await forceRefreshFeedsCache();
  console.log(`Feeds cache now has ${refresh.total} feeds (${refresh.newFeeds.length} new)`);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} subscription(s) failed:`, failed);
    process.exitCode = 1;
  }
}

main();
