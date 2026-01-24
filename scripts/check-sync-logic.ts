/**
 * Check what the daily sync logic would actually fetch
 */

import { initializeDatabase } from "../src/lib/db/index";
import { getDbClient, detectDriver } from "../src/lib/db/driver";
import { getCachedUserId } from "../src/lib/db/index";

async function main() {
  await initializeDatabase();
  const client = await getDbClient();
  const driver = detectDriver();

  console.log('=== Daily Sync Logic Check ===\n');

  // Check sync state
  const syncStateQuery = driver === 'postgres'
    ? `SELECT * FROM sync_state WHERE id = 'daily-sync'`
    : `SELECT * FROM sync_state WHERE id = 'daily-sync'`;

  const syncState = await client.query(syncStateQuery, []);

  if (syncState.rows.length > 0) {
    const state = syncState.rows[0] as any;
    console.log('Current Sync State:');
    console.log(`  Status: ${state.status}`);
    console.log(`  Started: ${new Date(state.started_at * 1000).toISOString()}`);
    console.log(`  Updated: ${new Date(state.last_updated_at * 1000).toISOString()}`);
    console.log(`  Items Processed: ${state.items_processed}`);
    console.log(`  Calls Used: ${state.calls_used}`);
    if (state.error) {
      console.log(`  Error: ${state.error}`);
    }
    console.log('');
  } else {
    console.log('No sync state found (sync would start fresh)\n');
  }

  // Get user ID
  const userId = await getCachedUserId();
  if (!userId) {
    console.log('⚠️  User ID not cached - sync would need to fetch it first\n');
  } else {
    console.log(`✅ User ID cached: ${userId}\n`);
  }

  // Calculate what the sync would fetch
  const SYNC_WINDOW_HOURS = 4; // Filter by createdAt: when Inoreader received the item
  const OT_WINDOW_DAYS = 7; // ot parameter: fetch items published in last 7 days
  const syncSinceTimestamp = Math.floor((Date.now() - SYNC_WINDOW_HOURS * 60 * 60 * 1000) / 1000);
  const otTimestamp = Math.floor((Date.now() - OT_WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000);

  console.log('Sync Window Settings:');
  console.log(`  SYNC_WINDOW_HOURS: ${SYNC_WINDOW_HOURS} (createdAt filter)`);
  console.log(`  OT_WINDOW_DAYS: ${OT_WINDOW_DAYS} (ot parameter for Inoreader)`);
  console.log(`  syncSinceTimestamp: ${syncSinceTimestamp} (${new Date(syncSinceTimestamp * 1000).toISOString()})`);
  console.log(`  otTimestamp: ${otTimestamp} (${new Date(otTimestamp * 1000).toISOString()})`);
  console.log('');

  // Check what items in database match this window
  console.log('=== Items in Database Matching Sync Window ===\n');
  const matchingQuery = driver === 'postgres'
    ? `SELECT category, COUNT(*) as count, MAX(created_at) as latest
       FROM items
       WHERE created_at >= $1
       GROUP BY category
       ORDER BY latest DESC`
    : `SELECT category, COUNT(*) as count, MAX(created_at) as latest
       FROM items
       WHERE created_at >= ?
       GROUP BY category
       ORDER BY latest DESC`;

  const matching = await client.query(matchingQuery, [syncSinceTimestamp]);

  if (matching.rows.length > 0) {
    matching.rows.forEach((row: any) => {
      const latest = new Date(row.latest * 1000).toISOString();
      const hoursAgo = ((Date.now() - row.latest * 1000) / (1000 * 60 * 60)).toFixed(1);
      console.log(`${row.category}: ${row.count} items (latest: ${latest}, ${hoursAgo}h ago)`);
    });
  } else {
    console.log('❌ No items in database from last 4 hours!');
  }

  console.log('\n=== Newsletter Items Specifically ===\n');
  const newsletterQuery = driver === 'postgres'
    ? `SELECT COUNT(*) as count, MAX(created_at) as latest
       FROM items
       WHERE category = 'newsletters' AND created_at >= $1`
    : `SELECT COUNT(*) as count, MAX(created_at) as latest
       FROM items
       WHERE category = 'newsletters' AND created_at >= ?`;

  const newsletterMatch = await client.query(newsletterQuery, [syncSinceTimestamp]);
  const count = (newsletterMatch.rows[0] as any).count;
  const latest = (newsletterMatch.rows[0] as any).latest;

  if (count > 0) {
    const latestDate = new Date(latest * 1000).toISOString();
    const hoursAgo = ((Date.now() - latest * 1000) / (1000 * 60 * 60)).toFixed(1);
    console.log(`✅ ${count} newsletter items from last 4 hours (latest: ${latestDate}, ${hoursAgo}h ago)`);
  } else {
    console.log(`❌ No newsletter items from last 4 hours`);
    console.log(`   The Claude Code article was published ${((Date.now() - 1735476898000) / (1000 * 60 * 60)).toFixed(1)}h ago`);
    console.log(`   So it SHOULD be in the sync window if sync ran recently`);
  }
}

main().catch(console.error);

