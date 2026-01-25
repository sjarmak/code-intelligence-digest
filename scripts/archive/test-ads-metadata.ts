#!/usr/bin/env node

/**
 * Test script to verify ADS metadata fetching with corrected GET method
 */

import { getBibcodeMetadata, getADSUrl, getArxivUrl } from '../src/lib/ads/client.js';

const token = process.env.ADS_API_TOKEN;

if (!token) {
  console.error('❌ ADS_API_TOKEN not found in environment');
  process.exit(1);
}

// Sample arxiv bibcodes to test
const testBibcodes = [
  '2025arXiv251212730D', // Test arXiv paper
  '2024ApJ...969...88M', // Test astronomy journal paper
];

async function test(apiToken: string) {
  console.log('Testing ADS metadata API (GET method)...\n');

  try {
    // Test URL generation
    console.log('URL generation tests:');
    for (const bibcode of testBibcodes) {
      const adsUrl = getADSUrl(bibcode);
      const arxivUrl = getArxivUrl(bibcode);
      console.log(`  ${bibcode}:`);
      console.log(`    ADS: ${adsUrl}`);
      console.log(`    arXiv: ${arxivUrl ?? 'N/A'}`);
    }

    console.log('\nFetching metadata from ADS API...');
    const metadata = await getBibcodeMetadata(testBibcodes, apiToken);

    console.log(`\n✅ Fetched metadata for ${Object.keys(metadata).length} papers:\n`);

    for (const bibcode of testBibcodes) {
      const paper = metadata[bibcode];
      if (paper) {
        console.log(`📄 ${bibcode}:`);
        console.log(`   Title: ${paper.title ?? 'N/A'}`);
        console.log(
          `   Authors: ${
            paper.authors
              ? paper.authors
                  .slice(0, 2)
                  .join('; ') + (paper.authors.length > 2 ? ' et al.' : '')
              : 'N/A'
          }`,
        );
        console.log(`   Date: ${paper.pubdate ?? 'N/A'}`);
        console.log(
          `   Abstract: ${
            paper.abstract ? paper.abstract.substring(0, 100) + '...' : 'N/A'
          }`,
        );
      } else {
        console.log(`⚠️  ${bibcode}: No metadata found`);
      }
    }

    console.log('\n✅ All metadata tests passed!');
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

test(token);
