/**
 * Refresh cached paper content to apply new parsing improvements
 * Clears cache for papers so they'll be re-fetched with improved ar5iv parsing
 */

import { getSqlite } from '../src/lib/db/index';
import { logger } from '../src/lib/logger';

async function refreshPaperCache() {
  console.log('=== Refreshing Paper Cache ===\n');

  const db = getSqlite();

  // Get all cached papers
  const cached = db.prepare(`
    SELECT bibcode, html_fetched_at
    FROM ads_papers
    WHERE html_content IS NOT NULL
    ORDER BY html_fetched_at DESC
  `).all() as Array<{ bibcode: string; html_fetched_at: number }>;

  console.log(`Found ${cached.length} cached papers\n`);

  if (cached.length === 0) {
    console.log('No cached papers to refresh');
    return;
  }

  // Option 1: Clear all cache
  console.log('Clearing cache for all papers...');
  const result = db.prepare(`
    UPDATE ads_papers
    SET html_content = NULL,
        html_sections = NULL,
        html_figures = NULL,
        html_fetched_at = NULL
    WHERE html_content IS NOT NULL
  `).run();

  console.log(`✅ Cleared cache for ${result.changes} papers`);
  console.log('\nPapers will be re-fetched with improved parsing on next access');
  console.log('This includes:');
  console.log('  - Updated ar5iv URL (ar5iv.labs.arxiv.org)');
  console.log('  - Enhanced section extraction');
  console.log('  - Sections/figures stored in database');
}

refreshPaperCache().catch(console.error);

