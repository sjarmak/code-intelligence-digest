/**
 * Check recent sync activity by looking at items added over time
 */

import { initializeDatabase } from "../src/lib/db/index";
import { getDbClient, detectDriver } from "../src/lib/db/driver";

async function main() {
  await initializeDatabase();
  const client = await getDbClient();
  const driver = detectDriver();

  console.log('=== Recent Item Additions (by created_at) ===\n');

  // Group items by day to see when they were added
  const dailyQuery = driver === 'postgres'
    ? `SELECT
         DATE(to_timestamp(created_at)) as date,
         category,
         COUNT(*) as count,
         MIN(created_at) as first_item,
         MAX(created_at) as last_item
       FROM items
       WHERE created_at >= EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
       GROUP BY DATE(to_timestamp(created_at)), category
       ORDER BY date DESC, category`
    : `SELECT
         DATE(datetime(created_at, 'unixepoch')) as date,
         category,
         COUNT(*) as count,
         MIN(created_at) as first_item,
         MAX(created_at) as last_item
       FROM items
       WHERE created_at >= strftime('%s', 'now', '-7 days')
       GROUP BY DATE(datetime(created_at, 'unixepoch')), category
       ORDER BY date DESC, category`;

  const dailyStats = await client.query(dailyQuery, []);

  if (dailyStats.rows.length > 0) {
    console.log('Items added by day and category (last 7 days):\n');
    dailyStats.rows.forEach((row: any) => {
      const firstTime = new Date(row.first_item * 1000).toISOString();
      const lastTime = new Date(row.last_item * 1000).toISOString();
      console.log(`${row.date} - ${row.category}: ${row.count} items`);
      console.log(`  First: ${firstTime}`);
      console.log(`  Last:  ${lastTime}`);
      console.log('');
    });
  } else {
    console.log('No items added in last 7 days\n');
  }

  // Check newsletter items specifically
  console.log('\n=== Newsletter Items (last 7 days) ===\n');
  const newsletterQuery = driver === 'postgres'
    ? `SELECT
         DATE(to_timestamp(created_at)) as date,
         COUNT(*) as count,
         COUNT(CASE WHEN id LIKE '%-article-%' THEN 1 END) as decomposed_count
       FROM items
       WHERE category = 'newsletters'
         AND created_at >= EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
       GROUP BY DATE(to_timestamp(created_at))
       ORDER BY date DESC`
    : `SELECT
         DATE(datetime(created_at, 'unixepoch')) as date,
         COUNT(*) as count,
         SUM(CASE WHEN id LIKE '%-article-%' THEN 1 ELSE 0 END) as decomposed_count
       FROM items
       WHERE category = 'newsletters'
         AND created_at >= strftime('%s', 'now', '-7 days')
       GROUP BY DATE(datetime(created_at, 'unixepoch'))
       ORDER BY date DESC`;

  const newsletterStats = await client.query(newsletterQuery, []);

  if (newsletterStats.rows.length > 0) {
    newsletterStats.rows.forEach((row: any) => {
      console.log(`${row.date}: ${row.count} items (${row.decomposed_count} decomposed)`);
    });
  } else {
    console.log('No newsletter items in last 7 days\n');
  }
}

main().catch(console.error);

