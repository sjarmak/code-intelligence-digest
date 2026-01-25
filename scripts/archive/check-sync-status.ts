/**
 * Check sync status and last sync time
 */

import { initializeDatabase } from "../src/lib/db/index";
import { getDbClient, detectDriver } from "../src/lib/db/driver";

async function main() {
  await initializeDatabase();
  const client = await getDbClient();
  const driver = detectDriver();

  console.log('=== Sync Status Check ===\n');

  // Check sync_state table
  const syncStateQuery = driver === 'postgres'
    ? `SELECT id, continuation_token, items_processed, calls_used, started_at, last_updated_at, status, error
       FROM sync_state
       WHERE id = 'daily-sync'
       ORDER BY started_at DESC
       LIMIT 1`
    : `SELECT id, continuation_token, items_processed, calls_used, started_at, last_updated_at, status, error
       FROM sync_state
       WHERE id = 'daily-sync'
       ORDER BY started_at DESC
       LIMIT 1`;

  const syncState = await client.query(syncStateQuery, []);

  if (syncState.rows.length > 0) {
    const state = syncState.rows[0] as any;
    console.log('Last Sync State:');
    console.log(`  Status: ${state.status}`);
    console.log(`  Started: ${new Date(state.started_at * 1000).toISOString()}`);
    console.log(`  Last Updated: ${new Date(state.last_updated_at * 1000).toISOString()}`);
    console.log(`  Items Processed: ${state.items_processed}`);
    console.log(`  Calls Used: ${state.calls_used}`);
    if (state.error) {
      console.log(`  Error: ${state.error}`);
    }
  } else {
    console.log('No sync state found');
  }

  // Check most recent items by created_at
  console.log('\n=== Most Recent Items (by created_at) ===\n');
  const recentItemsQuery = driver === 'postgres'
    ? `SELECT id, title, source_title, category, created_at, published_at, id LIKE '%-article-%' as is_decomposed
       FROM items
       ORDER BY created_at DESC
       LIMIT 10`
    : `SELECT id, title, source_title, category, created_at, published_at,
              CASE WHEN id LIKE '%-article-%' THEN 1 ELSE 0 END as is_decomposed
       FROM items
       ORDER BY created_at DESC
       LIMIT 10`;

  const recentItems = await client.query(recentItemsQuery, []);
  console.log(`Most recent items:\n`);

  recentItems.rows.forEach((row: any) => {
    const createdDate = new Date(row.created_at * 1000).toISOString();
    const hoursAgo = ((Date.now() - row.created_at * 1000) / (1000 * 60 * 60)).toFixed(1);
    console.log(`${row.title.substring(0, 60)}...`);
    console.log(`  Source: ${row.source_title}`);
    console.log(`  Category: ${row.category}`);
    console.log(`  Created: ${createdDate} (${hoursAgo} hours ago)`);
    console.log(`  Decomposed: ${row.is_decomposed ? 'YES' : 'NO'}`);
    console.log('');
  });
}

main().catch(console.error);
