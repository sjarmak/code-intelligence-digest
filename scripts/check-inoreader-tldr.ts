/**
 * Check if TLDR items are available in Inoreader
 */

import { createInoreaderClient } from "../src/lib/inoreader/client";
import { getStreamsByCategory } from "../src/config/feeds";
import { normalizeItems } from "../src/lib/pipeline/normalize";
import { decomposeFeedItems } from "../src/lib/pipeline/decompose";
import { categorizeItems } from "../src/lib/pipeline/categorize";

async function main() {
  console.log('=== Checking Inoreader for TLDR items ===\n');

  try {
    const client = createInoreaderClient();
    const streamIds = await getStreamsByCategory('newsletters');

    console.log(`Found ${streamIds.length} newsletter streams\n`);

    // Find TLDR stream
    const tldrStreams = streamIds.filter(s => s.toLowerCase().includes('tldr'));
    console.log(`TLDR streams: ${tldrStreams.length}`);
    tldrStreams.forEach(s => console.log(`  ${s}`));
    console.log('');

    if (tldrStreams.length === 0) {
      console.log('❌ No TLDR streams found in newsletter category!');
      return;
    }

    // Fetch from first TLDR stream
    const tldrStream = tldrStreams[0];
    console.log(`Fetching from: ${tldrStream}\n`);

    const response = await client.getStreamContents(tldrStream, { n: 20 });
    console.log(`Fetched ${response.items.length} raw items from Inoreader\n`);

    if (response.items.length === 0) {
      console.log('❌ No items found in Inoreader stream!');
      return;
    }

    // Normalize
    let items = await normalizeItems(response.items);
    console.log(`After normalize: ${items.length} items\n`);

    // Decompose
    items = decomposeFeedItems(items);
    console.log(`After decomposition: ${items.length} items\n`);

    // Categorize
    items = categorizeItems(items);
    console.log(`After categorize: ${items.length} items\n`);

    // Filter to newsletters
    const newsletterItems = items.filter(i => i.category === 'newsletters');
    console.log(`Newsletter category items: ${newsletterItems.length}\n`);

    // Find Claude Code article
    const claudeItems = newsletterItems.filter(i =>
      i.title.toLowerCase().includes('claude code') ||
      i.title.toLowerCase().includes('claude')
    );

    console.log(`Items matching "Claude Code": ${claudeItems.length}\n`);

    claudeItems.forEach(item => {
      console.log(`Title: ${item.title}`);
      console.log(`  ID: ${item.id.substring(0, 80)}...`);
      console.log(`  URL: ${item.url.substring(0, 100)}...`);
      console.log(`  Published: ${item.publishedAt.toISOString()}`);
      console.log(`  Created: ${item.createdAt?.toISOString() || 'N/A'}`);
      console.log('');
    });

    // Show recent items
    console.log('\n=== Recent Newsletter Items (last 5) ===\n');
    const recent = newsletterItems
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, 5);

    recent.forEach((item, i) => {
      const hoursAgo = ((Date.now() - item.publishedAt.getTime()) / (1000 * 60 * 60)).toFixed(1);
      console.log(`${i + 1}. ${item.title.substring(0, 70)}...`);
      console.log(`   Published: ${item.publishedAt.toISOString()} (${hoursAgo} hours ago)`);
      console.log(`   ID: ${item.id.substring(0, 60)}...`);
      console.log(`   Decomposed: ${item.id.includes('-article-') ? 'YES' : 'NO'}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      if (error.message.includes('429')) {
        console.error('\n❌ Rate limit error - need to wait or check quota');
      }
    }
  }
}

main().catch(console.error);

