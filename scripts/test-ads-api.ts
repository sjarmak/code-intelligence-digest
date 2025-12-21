#!/usr/bin/env node

import * as dotenv from 'dotenv';
import * as path from 'path';
import { listLibraries, getLibraryByName, getLibraryItems, getBibcodeMetadata } from '../src/lib/ads/client';

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

async function testADSAPI() {
  const token = process.env.ADS_API_TOKEN;

  if (!token) {
    console.error('Error: ADS_API_TOKEN environment variable not set');
    console.error('Get your token from: https://ui.adsabs.harvard.edu/settings/token');
    process.exit(1);
  }

  console.log('Testing ADS API connectivity...\n');

  try {
    // Test 1: List all libraries
    console.log('1. Fetching all libraries...');
    const libraries = await listLibraries(token);
    console.log(`   Found ${libraries.length} library(ies):`);
    libraries.forEach((lib) => {
      console.log(`   - "${lib.name}" (${lib.num_documents} documents)`);
    });
    console.log();

    // Test 2: Get Benchmarks library specifically
    console.log('2. Fetching "Benchmarks" library...');
    const benchmarksLib = await getLibraryByName('Benchmarks', token);
    if (benchmarksLib) {
      console.log(`   Found: "${benchmarksLib.name}"`);
      console.log(`   Documents: ${benchmarksLib.num_documents}`);
      console.log(`   Public: ${benchmarksLib.public}`);
      console.log();

      // Test 3: Get items from Benchmarks
      console.log('3. Fetching first 10 items from Benchmarks library...');
      const items = await getLibraryItems(benchmarksLib.id, token, {
        start: 0,
        rows: 10,
      });
      console.log(`   Retrieved ${items.length} bibcodes:`);
      items.slice(0, 5).forEach((bibcode) => {
        console.log(`   - ${bibcode}`);
      });
      if (items.length > 5) {
        console.log(`   ... and ${items.length - 5} more`);
      }
      console.log();

      // Test 4: Get metadata for bibcodes
      if (items.length > 0) {
        console.log('4. Fetching metadata for first 3 bibcodes...');
        const bibcodesToFetch = items.slice(0, 3);
        const metadata = await getBibcodeMetadata(bibcodesToFetch, token);
        Object.entries(metadata).forEach(([bibcode, data]) => {
          console.log(`   ${bibcode}:`);
          console.log(`     Title: ${data.title || 'N/A'}`);
          console.log(`     Date: ${data.pubdate || 'N/A'}`);
        });
        console.log();
      }

      console.log('✅ All ADS API tests passed!');
    } else {
      console.log('   ❌ "Benchmarks" library not found');
      console.log('   Available libraries:');
      libraries.forEach((lib) => console.log(`      - ${lib.name}`));
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testADSAPI();
