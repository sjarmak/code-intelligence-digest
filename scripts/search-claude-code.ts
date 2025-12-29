/**
 * Search for Claude Code article more thoroughly
 */

import { initializeDatabase } from "../src/lib/db/index";
import { getDbClient, detectDriver } from "../src/lib/db/driver";

async function main() {
  await initializeDatabase();
  const client = await getDbClient();
  const driver = detectDriver();

  console.log('=== Searching for Claude Code Article ===\n');

  // Search variations
  const searchTerms = [
    'Claude Code 2.0',
    'Claude Code',
    'Coding Agents',
    'Getting Better at Using Coding Agents',
    'claude code',
    'coding agents',
  ];

  for (const term of searchTerms) {
    console.log(`\nSearching for: "${term}"\n`);

    const searchQuery = driver === 'postgres'
      ? `SELECT id, title, url, source_title, category, created_at, published_at,
                CASE WHEN id LIKE '%-article-%' THEN 1 ELSE 0 END as is_decomposed
         FROM items
         WHERE (title ILIKE $1 OR summary ILIKE $1 OR content_snippet ILIKE $1)
         ORDER BY created_at DESC
         LIMIT 10`
      : `SELECT id, title, url, source_title, category, created_at, published_at,
                CASE WHEN id LIKE '%-article-%' THEN 1 ELSE 0 END as is_decomposed
         FROM items
         WHERE (title LIKE ? OR summary LIKE ? OR content_snippet LIKE ?)
         ORDER BY created_at DESC
         LIMIT 10`;

    const searchParam = `%${term}%`;
    const params = driver === 'postgres' ? [searchParam] : [searchParam, searchParam, searchParam];

    const results = await client.query(searchQuery, params);

    if (results.rows.length > 0) {
      results.rows.forEach((row: any) => {
        const createdDate = new Date(row.created_at * 1000).toISOString();
        const publishedDate = new Date(row.published_at * 1000).toISOString();
        console.log(`Title: ${row.title}`);
        console.log(`  Source: ${row.source_title}`);
        console.log(`  Category: ${row.category}`);
        console.log(`  Decomposed: ${row.is_decomposed ? 'YES' : 'NO'}`);
        console.log(`  Created: ${createdDate}`);
        console.log(`  Published: ${publishedDate}`);
        console.log(`  URL: ${row.url.substring(0, 100)}...`);
        console.log('');
      });
    } else {
      console.log(`  No results found for "${term}"`);
    }
  }

  // Also check recent TLDR newsletter items specifically
  console.log('\n=== Recent TLDR Newsletter Items (last 3 days) ===\n');
  const threeDaysAgo = Math.floor((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);

  const tldrQuery = driver === 'postgres'
    ? `SELECT id, title, url, source_title, category, created_at, published_at,
              CASE WHEN id LIKE '%-article-%' THEN 1 ELSE 0 END as is_decomposed
       FROM items
       WHERE source_title ILIKE '%TLDR%'
         AND category = 'newsletters'
         AND created_at >= $1
       ORDER BY created_at DESC
       LIMIT 50`
    : `SELECT id, title, url, source_title, category, created_at, published_at,
              CASE WHEN id LIKE '%-article-%' THEN 1 ELSE 0 END as is_decomposed
       FROM items
       WHERE source_title LIKE '%TLDR%'
         AND category = 'newsletters'
         AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT 50`;

  const tldrResults = await client.query(tldrQuery, [threeDaysAgo]);
  console.log(`Found ${tldrResults.rows.length} TLDR newsletter items in last 3 days\n`);

  if (tldrResults.rows.length > 0) {
    // Look for Claude Code in titles
    const claudeMatches = tldrResults.rows.filter((row: any) =>
      row.title.toLowerCase().includes('claude') ||
      row.title.toLowerCase().includes('coding agent')
    );

    if (claudeMatches.length > 0) {
      console.log(`Found ${claudeMatches.length} items matching "claude" or "coding agent":\n`);
      claudeMatches.forEach((row: any) => {
        const createdDate = new Date(row.created_at * 1000).toISOString();
        console.log(`Title: ${row.title}`);
        console.log(`  Decomposed: ${row.is_decomposed ? 'YES' : 'NO'}`);
        console.log(`  Created: ${createdDate}`);
        console.log(`  ID: ${row.id.substring(0, 80)}...`);
        console.log('');
      });
    } else {
      console.log('No Claude Code articles found in recent TLDR newsletters\n');
      console.log('Sample of recent TLDR newsletter titles:');
      tldrResults.rows.slice(0, 10).forEach((row: any) => {
        console.log(`  - ${row.title.substring(0, 70)}...`);
      });
    }
  } else {
    console.log('No TLDR newsletter items found in last 3 days!');
  }
}

main().catch(console.error);

