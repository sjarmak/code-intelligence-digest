/**
 * Backfill section processing for all papers in the database
 * Processes sections for papers that have body text but no section summaries
 */

import { getPaper } from '../src/lib/db/ads-papers';
import { getSectionSummaries } from '../src/lib/db/paper-sections';
import { processPaperSections } from '../src/lib/pipeline/section-summarization';
import { detectDriver, getDbClient } from '../src/lib/db/driver';
import { logger } from '../src/lib/logger';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env.local
dotenv.config({ path: join(__dirname, '..', '.env.local') });

async function backfillPaperSections() {
  const driver = detectDriver();
  logger.info('Starting section processing backfill', { driver });

  // Get all papers
  let papers: Array<{ bibcode: string; body?: string }>;
  
  if (driver === 'postgres') {
    const client = await getDbClient();
    const result = await client.query(`
      SELECT bibcode, body 
      FROM ads_papers 
      WHERE body IS NOT NULL AND LENGTH(body) >= 100
      ORDER BY created_at DESC
    `);
    papers = result.rows.map((row: Record<string, unknown>) => ({
      bibcode: row.bibcode as string,
      body: (row.body as string | null) || undefined,
    }));
  } else {
    const { getSqlite } = await import('../src/lib/db/index');
    const db = getSqlite();
    const stmt = db.prepare(`
      SELECT bibcode, body 
      FROM ads_papers 
      WHERE body IS NOT NULL AND LENGTH(body) >= 100
      ORDER BY created_at DESC
    `);
    const rawPapers = stmt.all() as Array<Record<string, unknown>>;
    papers = rawPapers.map(p => ({
      bibcode: p.bibcode as string,
      body: (p.body as string | null) || undefined,
    }));
  }

  logger.info('Found papers to process', { count: papers.length });

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const paper of papers) {
    try {
      // Check if sections already exist
      const existingSections = await getSectionSummaries(paper.bibcode);
      
      if (existingSections.length > 0) {
        logger.debug('Sections already exist, skipping', { 
          bibcode: paper.bibcode, 
          sectionCount: existingSections.length 
        });
        skipped++;
        continue;
      }

      logger.info('Processing sections', { 
        bibcode: paper.bibcode,
        bodyLength: paper.body?.length || 0,
      });

      // Process sections (force regenerate to use new extraction logic)
      await processPaperSections(paper.bibcode, true);
      
      processed++;
      
      if (processed % 10 === 0) {
        logger.info('Progress', { processed, skipped, failed, total: papers.length });
      }
    } catch (error) {
      logger.error('Failed to process sections', {
        bibcode: paper.bibcode,
        error: error instanceof Error ? error.message : String(error),
      });
      failed++;
    }
  }

  logger.info('Backfill complete', {
    total: papers.length,
    processed,
    skipped,
    failed,
  });
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillPaperSections()
    .then(() => {
      logger.info('Backfill script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Backfill script failed', { error });
      process.exit(1);
    });
}

export { backfillPaperSections };

