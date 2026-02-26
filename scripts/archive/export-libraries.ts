#!/usr/bin/env node

import * as dotenv from 'dotenv';
import * as path from 'path';
import { listLibraries, getLibraryByName, getLibraryItems, getBibcodeMetadata } from '../src/lib/ads/client';

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

function getADSUrl(bibcode: string): string {
  return `https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(bibcode)}`;
}

function getArxivUrl(bibcode: string): string | null {
  const match = bibcode.match(/^(\d{4})arXiv(\d{2})(\d{5})([A-Z])$/);
  if (!match) {
    return null;
  }
  const [, , part1, part2, part3] = match;
  const arxivId = `${part1}${part2}.${part3}`;
  return `https://arxiv.org/abs/${arxivId}`;
}

async function exportLibrary(libraryName: string, token: string) {
  try {
    const lib = await getLibraryByName(libraryName, token);
    
    if (!lib) {
      console.log(`\n❌ Library "${libraryName}" not found`);
      return;
    }

    console.log(`\n📚 ${libraryName} (${lib.num_documents} documents)`);
    console.log('='.repeat(90));

    // Get all items from library (fetch in batches)
    const pageSize = 100;
    let allBibcodes: string[] = [];
    let start = 0;

    while (true) {
      const response = await getLibraryItems(lib.id, token, {
        rows: pageSize,
        start,
      });

      if (!response || response.length === 0) break;
      allBibcodes = allBibcodes.concat(response);
      start += pageSize;
    }

    // Fetch metadata for all bibcodes
    const metadata = await getBibcodeMetadata(allBibcodes, token);

    // Print links
    let idx = 1;
    for (const bibcode of allBibcodes) {
      const meta = metadata[bibcode];
      const adsUrl = getADSUrl(bibcode);
      const arxivUrl = getArxivUrl(bibcode);
      
      const title = meta?.title || bibcode;
      const url = arxivUrl || adsUrl;
      
      console.log(`${idx}. ${title}`);
      console.log(`   ${url}`);
      console.log();
      idx++;
    }

  } catch (error) {
    console.error(`Error fetching ${libraryName}:`, error);
  }
}

async function main() {
  const token = process.env.ADS_API_TOKEN;

  if (!token) {
    console.error('Error: ADS_API_TOKEN environment variable not set');
    console.error('Get your token from: https://ui.adsabs.harvard.edu/settings/token');
    process.exit(1);
  }

  await exportLibrary('Benchmarks', token);
  await exportLibrary('Agents', token);
  await exportLibrary('Code Search', token);
}

main().catch(console.error);
