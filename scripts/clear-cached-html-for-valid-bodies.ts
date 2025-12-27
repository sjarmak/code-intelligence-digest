/**
 * Clear cached HTML for papers that have valid body fields
 * This forces regeneration from the full body text instead of old cached HTML
 */

import { getSqlite } from '../src/lib/db/index';
import { logger } from '../src/lib/logger';

async function clearCachedHtmlForValidBodies() {
  console.log('=== Clearing Cached HTML for Papers with Valid Bodies ===\n');

  const db = getSqlite();

  // Find all papers with valid body fields (>= 100 chars) that have cached HTML
  const papersToClear = db.prepare(`
    SELECT bibcode, LENGTH(body) as body_length, LENGTH(html_content) as html_length
    FROM ads_papers
    WHERE body IS NOT NULL
      AND LENGTH(body) >= 100
      AND html_content IS NOT NULL
    ORDER BY bibcode
  `).all() as Array<{ bibcode: string; body_length: number; html_length: number }>;

  console.log(`Found ${papersToClear.length} papers with valid bodies and cached HTML\n`);

  if (papersToClear.length === 0) {
    console.log('✅ No papers need cache clearing');
    return;
  }

  // Clear cached HTML for all of them
  const result = db.prepare(`
    UPDATE ads_papers
    SET html_content = NULL,
        html_sections = NULL,
        html_figures = NULL,
        html_fetched_at = NULL
    WHERE body IS NOT NULL
      AND LENGTH(body) >= 100
      AND html_content IS NOT NULL
  `).run();

  console.log(`✅ Cleared cached HTML for ${result.changes} papers`);
  console.log('\nPapers will regenerate HTML from full body text on next access');
}

clearCachedHtmlForValidBodies().catch(console.error);

