/**
 * Refresh all papers with invalid/short body fields from ADS
 * Fixes papers that have body="M" or other invalid short bodies
 */

import { getSqlite } from '../src/lib/db/index';
import { getBibcodeMetadata } from '../src/lib/ads/client';
import { storePaper } from '../src/lib/db/ads-papers';
import { getADSUrl, getArxivUrl } from '../src/lib/ads/client';
import { logger } from '../src/lib/logger';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env.local
dotenv.config({ path: join(__dirname, '..', '.env.local') });

async function refreshInvalidBodies() {
  const token = process.env.ADS_API_TOKEN;
  if (!token) {
    console.error('❌ ADS_API_TOKEN not found in .env.local');
    process.exit(1);
  }

  console.log('=== Refreshing Invalid Body Fields ===\n');

  const db = getSqlite();

  // Find all papers with suspiciously short body fields (< 100 chars)
  const invalidPapers = db.prepare(`
    SELECT bibcode, LENGTH(body) as body_length, title
    FROM ads_papers
    WHERE body IS NOT NULL AND LENGTH(body) < 100
    ORDER BY bibcode
  `).all() as Array<{ bibcode: string; body_length: number; title?: string }>;

  console.log(`Found ${invalidPapers.length} papers with invalid body fields\n`);

  if (invalidPapers.length === 0) {
    console.log('✅ No papers need refreshing');
    return;
  }

  // Process in batches to avoid overwhelming the API
  const batchSize = 10;
  let refreshed = 0;
  let failed = 0;

  for (let i = 0; i < invalidPapers.length; i += batchSize) {
    const batch = invalidPapers.slice(i, i + batchSize);
    const bibcodes = batch.map(p => p.bibcode);

    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(invalidPapers.length / batchSize)} (${bibcodes.length} papers)...`);

    try {
      const metadata = await getBibcodeMetadata(bibcodes, token);

      for (const bibcode of bibcodes) {
        const paperData = metadata[bibcode];
        const originalPaper = batch.find(p => p.bibcode === bibcode);

        if (!paperData) {
          console.log(`  ⚠️  ${bibcode}: Not found in ADS`);
          failed++;
          continue;
        }

        const newBodyLength = paperData.body?.length || 0;
        const oldBodyLength = originalPaper?.body_length || 0;

        if (newBodyLength > oldBodyLength) {
          const paper = {
            bibcode,
            title: paperData.title,
            authors: paperData.authors ? JSON.stringify(paperData.authors) : undefined,
            pubdate: paperData.pubdate,
            abstract: paperData.abstract,
            body: paperData.body,
            adsUrl: getADSUrl(bibcode),
            arxivUrl: getArxivUrl(bibcode),
            fulltextSource: paperData.body ? 'ads_api' : undefined,
          };

          storePaper(paper);
          console.log(`  ✅ ${bibcode}: ${oldBodyLength} → ${newBodyLength} chars`);
          refreshed++;
        } else {
          console.log(`  ⚠️  ${bibcode}: Still no body (${newBodyLength} chars)`);
          if (newBodyLength === 0) {
            failed++;
          }
        }
      }

      // Small delay between batches to be nice to the API
      if (i + batchSize < invalidPapers.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`  ❌ Batch failed:`, error instanceof Error ? error.message : String(error));
      failed += batch.length;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`✅ Refreshed: ${refreshed}`);
  console.log(`⚠️  Failed/No body: ${failed}`);
  console.log(`📊 Total processed: ${invalidPapers.length}`);
}

refreshInvalidBodies().catch(console.error);

