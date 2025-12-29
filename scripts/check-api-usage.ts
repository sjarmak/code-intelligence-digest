/**
 * Check what's using the API quota
 */

import { initializeDatabase } from "../src/lib/db/index";
import { getGlobalApiBudget } from "../src/lib/db/index";
import { getDbClient, detectDriver } from "../src/lib/db/driver";

async function main() {
  await initializeDatabase();
  const client = await getDbClient();
  const driver = detectDriver();

  console.log('=== API Budget Usage ===\n');

  const budget = await getGlobalApiBudget();
  console.log(`Calls Used: ${budget.callsUsed}/${budget.quotaLimit}`);
  console.log(`Remaining: ${budget.remaining}`);
  console.log(`Percent: ${Math.round((budget.callsUsed / budget.quotaLimit) * 100)}%\n`);

  // Check sync state history (if we have it)
  console.log('=== Sync State History ===\n');
  const syncHistoryQuery = driver === 'postgres'
    ? `SELECT id, status, items_processed, calls_used, started_at, last_updated_at, error
       FROM sync_state
       ORDER BY started_at DESC
       LIMIT 10`
    : `SELECT id, status, items_processed, calls_used, started_at, last_updated_at, error
       FROM sync_state
       ORDER BY started_at DESC
       LIMIT 10`;

  const syncHistory = await client.query(syncHistoryQuery, []);

  if (syncHistory.rows.length > 0) {
    syncHistory.rows.forEach((row: any, i: number) => {
      const started = new Date(row.started_at * 1000).toISOString();
      const updated = new Date(row.last_updated_at * 1000).toISOString();
      const hoursAgo = ((Date.now() - row.last_updated_at * 1000) / (1000 * 60 * 60)).toFixed(1);

      console.log(`${i + 1}. ${row.id}`);
      console.log(`   Status: ${row.status}`);
      console.log(`   Items: ${row.items_processed}`);
      console.log(`   Calls: ${row.calls_used}`);
      console.log(`   Started: ${started}`);
      console.log(`   Updated: ${updated} (${hoursAgo} hours ago)`);
      if (row.error) {
        console.log(`   Error: ${row.error}`);
      }
      console.log('');
    });
  } else {
    console.log('No sync history found\n');
  }

  // Check recent items to see when last successful sync happened
  console.log('=== Recent Items Analysis ===\n');
  const recentQuery = driver === 'postgres'
    ? `SELECT
         category,
         COUNT(*) as count,
         MAX(created_at) as latest_created,
         MIN(created_at) as earliest_created
       FROM items
       WHERE created_at >= $1
       GROUP BY category
       ORDER BY latest_created DESC`
    : `SELECT
         category,
         COUNT(*) as count,
         MAX(created_at) as latest_created,
         MIN(created_at) as earliest_created
       FROM items
       WHERE created_at >= ?
       GROUP BY category
       ORDER BY latest_created DESC`;

  const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  const recentItems = await client.query(recentQuery, [oneDayAgo]);

  if (recentItems.rows.length > 0) {
    console.log('Items added in last 24 hours by category:');
    recentItems.rows.forEach((row: any) => {
      const latest = new Date(row.latest_created * 1000).toISOString();
      const hoursAgo = ((Date.now() - row.latest_created * 1000) / (1000 * 60 * 60)).toFixed(1);
      console.log(`  ${row.category}: ${row.count} items (latest: ${latest}, ${hoursAgo}h ago)`);
    });
  } else {
    console.log('❌ No items added in last 24 hours!');
  }
}

main().catch(console.error);

