/**
 * Process papers to extract sections, generate summaries, and store embeddings
 * Run this to build the section-based retrieval index for papers
 */

import { initializeDatabase } from '../src/lib/db/index';
import { getDbClient } from '../src/lib/db/driver';
import { processPaperSections } from '../src/lib/pipeline/section-summarization';
import { initializePaperSectionsTable } from '../src/lib/db/paper-sections';
import { logger } from '../src/lib/logger';

async function main() {
  console.log('=== Processing Paper Sections ===\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ ERROR: OPENAI_API_KEY environment variable is not set');
    console.error('   Section summarization requires OpenAI API access.');
    console.error('   Please set OPENAI_API_KEY in your .env.local file.\n');
    process.exit(1);
  }

  await initializeDatabase();
  initializePaperSectionsTable();

  const client = await getDbClient();

  const result = await client.query(`
    SELECT bibcode, title, LENGTH(body) as body_length
    FROM ads_papers
    WHERE body IS NOT NULL AND LENGTH(body) >= 100
    ORDER BY bibcode
  `);

  const papers = result.rows as Array<{ bibcode: string; title: string | null; body_length: number }>;

  console.log(`Found ${papers.length} papers with body text\n`);

  if (papers.length === 0) {
    console.log('No papers to process');
    return;
  }

  let processed = 0;
  let failed = 0;

  for (const paper of papers) {
    try {
      console.log(`Processing: ${paper.bibcode} (${paper.title?.substring(0, 60) || 'No title'}...)`);
      await processPaperSections(paper.bibcode);
      processed++;
      console.log(`  ✅ Processed\n`);
    } catch (error) {
      failed++;
      console.error(`  ❌ Failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total papers: ${papers.length}`);
  console.log(`Processed: ${processed}`);
  console.log(`Failed: ${failed}`);
}

main().catch((error) => {
  logger.error('process-paper-sections failed', error);
  console.error(error);
  process.exit(1);
});
