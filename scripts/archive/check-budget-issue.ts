/**
 * Check the actual budget values in the database
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from "../src/lib/db/index";
import { getDbClient, detectDriver } from "../src/lib/db/driver";
import { getGlobalApiBudget } from "../src/lib/db/index";

async function main() {
  await initializeDatabase();
  const client = await getDbClient();
  const driver = detectDriver();

  console.log('=== API Budget Investigation ===\n');

  const today = new Date().toISOString().split('T')[0];
  console.log(`Checking budget for: ${today}\n`);

  // Get raw budget data
  const budgetQuery = driver === 'postgres'
    ? `SELECT date, calls_used, quota_limit, last_updated_at FROM global_api_budget WHERE date = $1`
    : `SELECT date, calls_used, quota_limit, last_updated_at FROM global_api_budget WHERE date = ?`;

  const result = await client.query(budgetQuery, [today]);

  if (result.rows.length > 0) {
    const row = result.rows[0] as any;
    console.log('Raw Database Values:');
    console.log(`  date: ${row.date}`);
    console.log(`  calls_used: ${row.calls_used}`);
    console.log(`  quota_limit: ${row.quota_limit}`);
    console.log(`  last_updated_at: ${row.last_updated_at ? new Date(row.last_updated_at * 1000).toISOString() : 'null'}`);
    console.log('');

    const calculatedRemaining = row.quota_limit - row.calls_used;
    const calculatedPercent = Math.round((row.calls_used / row.quota_limit) * 100);

    console.log('Calculated Values:');
    console.log(`  remaining: ${calculatedRemaining}`);
    console.log(`  percent used: ${calculatedPercent}%`);
    console.log('');

    const budget = await getGlobalApiBudget();
    console.log('From getGlobalApiBudget() function:');
    console.log(`  callsUsed: ${budget.callsUsed}`);
    console.log(`  remaining: ${budget.remaining}`);
    console.log(`  quotaLimit: ${budget.quotaLimit}`);
    console.log(`  percent: ${Math.round((budget.callsUsed / budget.quotaLimit) * 100)}%`);
  } else {
    console.log('No budget entry found for today');
  }

  // Check all recent budget entries
  console.log('\n=== Recent Budget Entries ===\n');
  const allQuery = driver === 'postgres'
    ? `SELECT date, calls_used, quota_limit, last_updated_at FROM global_api_budget ORDER BY date DESC LIMIT 7`
    : `SELECT date, calls_used, quota_limit, last_updated_at FROM global_api_budget ORDER BY date DESC LIMIT 7`;

  const allResults = await client.query(allQuery, []);

  if (allResults.rows.length > 0) {
    allResults.rows.forEach((row: any) => {
      const remaining = row.quota_limit - row.calls_used;
      const percent = Math.round((row.calls_used / row.quota_limit) * 100);
      const updated = row.last_updated_at ? new Date(row.last_updated_at * 1000).toISOString() : 'null';
      console.log(`${row.date}: ${row.calls_used}/${row.quota_limit} (${percent}%, ${remaining} remaining) - updated: ${updated}`);
    });
  } else {
    console.log('No budget entries found');
  }
}

main().catch(console.error);

