/**
 * Process papers to extract sections, generate summaries, and store embeddings
 * Run this to build the section-based retrieval index for papers
 */

import { getSqlite } from '../src/lib/db/index';
import { processPaperSections } from '../src/lib/pipeline/section-summarization';
import { initializePaperSectionsTable } from '../src/lib/db/paper-sections';
import { logger } from '../src/lib/logger';

async function main() {
  console.log('=== Processing Paper Sections ===\n');

  // Check for OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ ERROR: OPENAI_API_KEY environment variable is not set');
    console.error('   Section summarization requires OpenAI API access.');
    console.error('   Please set OPENAI_API_KEY in your .env.local file.\n');
    process.exit(1);
  }

  // Initialize tables
  initializePaperSectionsTable();

  const db = getSqlite();

  // Get all papers with body text
  const papers = db.prepare(`
    SELECT bibcode, title, LENGTH(body) as body_length
    FROM ads_papers
    WHERE body IS NOT NULL AND LENGTH(body) >= 100
    ORDER BY bibcode
  `).all() as Array<{ bibcode: string; title: string | null; body_length: number }>;

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

main().catch(console.error);

