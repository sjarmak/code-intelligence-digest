/**
 * Check recent newsletter items in database
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from "../src/lib/db/index";
import { getDbClient, detectDriver } from "../src/lib/db/driver";

async function main() {
  await initializeDatabase();
  const client = await getDbClient();
  const driver = detectDriver();

  console.log('=== Recent Newsletter Items ===\n');

  const now = Math.floor(Date.now() / 1000);
  const last24h = now - (24 * 60 * 60);
  const last72h = now - (3 * 24 * 60 * 60);

  // Check items by created_at (when Inoreader received them)
  const query24h = driver === 'postgres'
    ? `SELECT id, title, source_title, created_at, published_at, category FROM items WHERE category = 'newsletters' AND created_at >= $1 ORDER BY created_at DESC LIMIT 20`
    : `SELECT id, title, source_title, created_at, published_at, category FROM items WHERE category = 'newsletters' AND created_at >= ? ORDER BY created_at DESC LIMIT 20`;

  const result24h = await client.query(query24h, [last24h]);

  console.log(`Newsletters in last 24 hours (created_at >= ${new Date(last24h * 1000).toISOString()}):`);
  console.log(`Found: ${result24h.rows.length} items\n`);

  result24h.rows.forEach((row: any) => {
    const created = new Date(row.created_at * 1000).toISOString();
    const published = row.published_at ? new Date(row.published_at * 1000).toISOString() : 'N/A';
    const isDecomposed = row.id.includes('-article-');
    console.log(`  [${isDecomposed ? 'DECOMPOSED' : 'ORIGINAL'}] ${row.title?.substring(0, 60)}...`);
    console.log(`    ID: ${row.id}`);
    console.log(`    Source: ${row.source_title}`);
    console.log(`    Created: ${created}`);
    console.log(`    Published: ${published}`);
    console.log('');
  });

  // Check items in last 72h (3 day window)
  const query72h = driver === 'postgres'
    ? `SELECT COUNT(*) as count FROM items WHERE category = 'newsletters' AND created_at >= $1`
    : `SELECT COUNT(*) as count FROM items WHERE category = 'newsletters' AND created_at >= ?`;

  const result72h = await client.query(query72h, [last72h]);
  const count72h = driver === 'postgres'
    ? parseInt(result72h.rows[0].count as string, 10)
    : result72h.rows[0].count as number;

  console.log(`\nTotal newsletters in last 72 hours: ${count72h}`);

  // Check sync state
  console.log('\n=== Sync State ===\n');
  const syncQuery = driver === 'postgres'
    ? `SELECT * FROM sync_state WHERE id = 'daily-sync'`
    : `SELECT * FROM sync_state WHERE id = 'daily-sync'`;

  const syncResult = await client.query(syncQuery, []);
  if (syncResult.rows.length > 0) {
    const state = syncResult.rows[0] as any;
    console.log(`Status: ${state.status}`);
    console.log(`Items Processed: ${state.items_processed}`);
    console.log(`Calls Used: ${state.calls_used}`);
    console.log(`Last Updated: ${state.last_updated_at ? new Date(state.last_updated_at * 1000).toISOString() : 'N/A'}`);
    console.log(`Error: ${state.error || 'None'}`);
  } else {
    console.log('No sync state found (sync may have completed)');
  }

  // Check recent TLDR and Elevate items specifically
  console.log('\n=== Recent TLDR & Elevate Items ===\n');
  const tldrQuery = driver === 'postgres'
    ? `SELECT id, title, source_title, created_at FROM items WHERE category = 'newsletters' AND (source_title LIKE '%TLDR%' OR source_title LIKE '%Elevate%') AND created_at >= $1 ORDER BY created_at DESC LIMIT 10`
    : `SELECT id, title, source_title, created_at FROM items WHERE category = 'newsletters' AND (source_title LIKE '%TLDR%' OR source_title LIKE '%Elevate%') AND created_at >= ? ORDER BY created_at DESC LIMIT 10`;

  const tldrResult = await client.query(tldrQuery, [last72h]);
  console.log(`Found ${tldrResult.rows.length} TLDR/Elevate items in last 72h:`);
  tldrResult.rows.forEach((row: any) => {
    const created = new Date(row.created_at * 1000).toISOString();
    console.log(`  ${row.title?.substring(0, 70)}... (${row.source_title}) - ${created}`);
  });
}

main().catch(console.error);


