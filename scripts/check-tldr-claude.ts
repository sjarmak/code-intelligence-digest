/**
 * Check if specific TLDR article exists in database
 * Looking for: "A Guide to Claude Code 2.0 and Getting Better at Using Coding Agents"
 */

import { initializeDatabase } from "../src/lib/db/index";
import { getDbClient, detectDriver } from "../src/lib/db/driver";

async function main() {
  await initializeDatabase();
  const client = await getDbClient();
  const driver = detectDriver();

  console.log(`=== Checking for TLDR Claude Code article ===\n`);
  console.log(`Database driver: ${driver}\n`);

  // Search for the specific article by title
  const searchTitle = "Claude Code 2.0";
  const searchQuery = driver === 'postgres'
    ? `SELECT id, title, url, source_title, category, created_at, published_at, id LIKE '%-article-%' as is_decomposed
       FROM items
       WHERE (title ILIKE $1 OR summary ILIKE $1 OR content_snippet ILIKE $1)
       ORDER BY created_at DESC
       LIMIT 20`
    : `SELECT id, title, url, source_title, category, created_at, published_at,
              CASE WHEN id LIKE '%-article-%' THEN 1 ELSE 0 END as is_decomposed
       FROM items
       WHERE (title LIKE ? OR summary LIKE ? OR content_snippet LIKE ?)
       ORDER BY created_at DESC
       LIMIT 20`;

  const searchParam = `%${searchTitle}%`;
  const params = driver === 'postgres' ? [searchParam] : [searchParam, searchParam, searchParam];

  const results = await client.query(searchQuery, params);
  console.log(`Found ${results.rows.length} items matching "Claude Code 2.0"\n`);

  results.rows.forEach((row: any) => {
    const createdDate = new Date(row.created_at * 1000).toISOString();
    const publishedDate = new Date(row.published_at * 1000).toISOString();
    console.log(`Title: ${row.title}`);
    console.log(`  Source: ${row.source_title}`);
    console.log(`  Category: ${row.category}`);
    console.log(`  Decomposed: ${row.is_decomposed ? 'YES' : 'NO'}`);
    console.log(`  Created: ${createdDate}`);
    console.log(`  Published: ${publishedDate}`);
    console.log(`  ID: ${row.id.substring(0, 80)}...`);
    console.log(`  URL: ${row.url.substring(0, 100)}...`);
    console.log('');
  });

  // Also check recent TLDR items
  console.log('\n=== Recent TLDR items (last 24 hours) ===\n');
  const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

  const tldrQuery = driver === 'postgres'
    ? `SELECT id, title, url, source_title, category, created_at, published_at, id LIKE '%-article-%' as is_decomposed
       FROM items
       WHERE source_title ILIKE '%TLDR%' AND created_at >= $1
       ORDER BY created_at DESC
       LIMIT 30`
    : `SELECT id, title, url, source_title, category, created_at, published_at,
              CASE WHEN id LIKE '%-article-%' THEN 1 ELSE 0 END as is_decomposed
       FROM items
       WHERE source_title LIKE '%TLDR%' AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT 30`;

  const tldrResults = await client.query(tldrQuery, driver === 'postgres' ? [oneDayAgo] : [oneDayAgo]);
  console.log(`Found ${tldrResults.rows.length} TLDR items in last 24 hours\n`);

  if (tldrResults.rows.length === 0) {
    console.log('❌ No TLDR items found in last 24 hours!');
    console.log('This suggests items are not being synced or saved correctly.\n');

    // Check if there are any TLDR items at all
    const anyTldrQuery = driver === 'postgres'
      ? `SELECT COUNT(*) as count FROM items WHERE source_title ILIKE '%TLDR%'`
      : `SELECT COUNT(*) as count FROM items WHERE source_title LIKE '%TLDR%'`;
    const anyTldr = await client.query(anyTldrQuery, []);
    console.log(`Total TLDR items in database: ${(anyTldr.rows[0] as any).count}`);
  } else {
    tldrResults.rows.slice(0, 10).forEach((row: any) => {
      const createdDate = new Date(row.created_at * 1000).toISOString();
      console.log(`Title: ${row.title.substring(0, 70)}...`);
      console.log(`  Decomposed: ${row.is_decomposed ? 'YES' : 'NO'}`);
      console.log(`  Created: ${createdDate}`);
      console.log(`  Category: ${row.category}`);
      console.log('');
    });
  }

  // Check newsletter items in general
  console.log('\n=== Newsletter items (last 24 hours) ===\n');
  const newsletterQuery = driver === 'postgres'
    ? `SELECT COUNT(*) as count,
              COUNT(CASE WHEN id LIKE '%-article-%' THEN 1 END) as decomposed_count
       FROM items
       WHERE category = 'newsletters' AND created_at >= $1`
    : `SELECT COUNT(*) as count,
              SUM(CASE WHEN id LIKE '%-article-%' THEN 1 ELSE 0 END) as decomposed_count
       FROM items
       WHERE category = 'newsletters' AND created_at >= ?`;

  const newsletterCount = await client.query(newsletterQuery, driver === 'postgres' ? [oneDayAgo] : [oneDayAgo]);
  const count = (newsletterCount.rows[0] as any).count;
  const decomposedCount = (newsletterCount.rows[0] as any).decomposed_count;

  console.log(`Total newsletter items: ${count}`);
  console.log(`Decomposed articles: ${decomposedCount}`);
  console.log(`Non-decomposed: ${count - decomposedCount}`);
}

main().catch(console.error);

