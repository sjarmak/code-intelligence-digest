/**
 * Test fetching TLDR items from Inoreader to see if Claude Code article is available
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local for environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createInoreaderClient } from "../src/lib/inoreader/client";
import { getStreamsByCategory } from "../src/config/feeds";
import { normalizeItems } from "../src/lib/pipeline/normalize";
import { decomposeFeedItems } from "../src/lib/pipeline/decompose";
import { categorizeItems } from "../src/lib/pipeline/categorize";

async function main() {
  console.log('=== Testing TLDR Fetch from Inoreader ===\n');

  try {
    const client = createInoreaderClient();
    const streamIds = await getStreamsByCategory('newsletters');

    console.log(`Found ${streamIds.length} newsletter streams\n`);

    // Find TLDR streams
    const tldrStreams = streamIds.filter(s => s.toLowerCase().includes('tldr'));
    console.log(`TLDR streams: ${tldrStreams.length}`);
    tldrStreams.forEach(s => console.log(`  ${s}`));
    console.log('');

    if (tldrStreams.length === 0) {
      console.log('❌ No TLDR streams found!');
      return;
    }

    // Fetch from first TLDR stream
    const tldrStream = tldrStreams[0];
    console.log(`Fetching from: ${tldrStream}\n`);

    // Fetch last 20 items (should include recent ones)
    const response = await client.getStreamContents(tldrStream, { n: 20 });
    console.log(`✅ Fetched ${response.items.length} raw items from Inoreader\n`);

    if (response.items.length === 0) {
      console.log('❌ No items found in Inoreader stream!');
      return;
    }

    // Show raw items first
    console.log('=== Raw Items from Inoreader ===\n');
    response.items.slice(0, 5).forEach((item: any, i: number) => {
      const published = item.published ? new Date(item.published * 1000).toISOString() : 'N/A';
      const hoursAgo = item.published ? ((Date.now() - item.published * 1000) / (1000 * 60 * 60)).toFixed(1) : 'N/A';
      console.log(`${i + 1}. ${item.title || '(Untitled)'}`);
      console.log(`   Published: ${published} (${hoursAgo}h ago)`);
      console.log(`   ID: ${item.id?.substring(0, 60)}...`);
      console.log('');
    });

    // Normalize
    console.log('=== Processing Items ===\n');
    let items = await normalizeItems(response.items);
    console.log(`✅ After normalize: ${items.length} items\n`);

    // Decompose
    items = decomposeFeedItems(items);
    console.log(`✅ After decomposition: ${items.length} items\n`);

    // Categorize
    items = categorizeItems(items);
    console.log(`✅ After categorize: ${items.length} items\n`);

    // Filter to newsletters
    const newsletterItems = items.filter(i => i.category === 'newsletters');
    console.log(`✅ Newsletter category items: ${newsletterItems.length}\n`);

    // Look for Claude Code article
    console.log('=== Searching for Claude Code Article ===\n');
    const claudeItems = newsletterItems.filter(i =>
      i.title.toLowerCase().includes('claude code') ||
      i.title.toLowerCase().includes('claude code 2.0') ||
      i.title.toLowerCase().includes('guide to claude') ||
      (i.title.toLowerCase().includes('claude') && i.title.toLowerCase().includes('coding agents'))
    );

    console.log(`Found ${claudeItems.length} items matching Claude Code keywords:\n`);

    if (claudeItems.length > 0) {
      claudeItems.forEach((item, i) => {
        const hoursAgo = ((Date.now() - item.publishedAt.getTime()) / (1000 * 60 * 60)).toFixed(1);
        console.log(`${i + 1}. ${item.title}`);
        console.log(`   ID: ${item.id.substring(0, 80)}...`);
        console.log(`   URL: ${item.url.substring(0, 100)}...`);
        console.log(`   Published: ${item.publishedAt.toISOString()} (${hoursAgo}h ago)`);
        console.log(`   Created: ${item.createdAt?.toISOString() || 'N/A'}`);
        console.log(`   Decomposed: ${item.id.includes('-article-') ? 'YES' : 'NO'}`);
        console.log('');
      });
    } else {
      console.log('❌ No Claude Code article found in newsletter items\n');

      // Show recent newsletter items to see what we got
      console.log('=== Recent Newsletter Items ===\n');
      const recent = newsletterItems
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(0, 10);

      recent.forEach((item, i) => {
        const hoursAgo = ((Date.now() - item.publishedAt.getTime()) / (1000 * 60 * 60)).toFixed(1);
        console.log(`${i + 1}. ${item.title.substring(0, 70)}...`);
        console.log(`   Published: ${item.publishedAt.toISOString()} (${hoursAgo}h ago)`);
        console.log(`   Decomposed: ${item.id.includes('-article-') ? 'YES' : 'NO'}`);
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      if (error.message.includes('429')) {
        console.error('\n⚠️  Rate limit error - API quota may be exhausted');
      }
    }
  }
}

main().catch(console.error);

