#!/usr/bin/env tsx
/**
 * Check sync status and recent items by category
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { getDbClient } from '../src/lib/db/driver';
import { logger } from '../src/lib/logger';

async function checkSyncStatus() {
  try {
    await initializeDatabase();
    const client = await getDbClient();

    console.log('\n📊 Sync Status Check\n');
    console.log('='.repeat(60));

    // Check sync state
    const syncStateResult = await client.query(
      'SELECT * FROM sync_state WHERE id = $1',
      ['daily-sync']
    );

    if (syncStateResult.rows.length > 0) {
      const state = syncStateResult.rows[0] as Record<string, unknown>;
      console.log('\n🔄 Daily Sync State:');
      console.log(`  Status: ${state.status}`);
      console.log(`  Items Processed: ${state.items_processed}`);
      console.log(`  API Calls Used: ${state.calls_used}`);
      console.log(`  Last Updated: ${new Date(Number(state.last_updated_at) * 1000).toISOString()}`);
      if (state.error) {
        console.log(`  Error: ${state.error}`);
      }
      if (state.continuation_token) {
        console.log(`  Has Continuation Token: Yes (sync can resume)`);
      }
    } else {
      console.log('\n🔄 Daily Sync State: No active sync (idle)');
    }

    // Check items added today by category
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = Math.floor(today.getTime() / 1000);

    console.log('\n📅 Items Added Today (by category):');
    const categoryCounts = await client.query(
      `SELECT category, COUNT(*) as count
       FROM items
       WHERE published_at >= $1
       GROUP BY category
       ORDER BY count DESC`,
      [todayTimestamp]
    );

    if (categoryCounts.rows.length === 0) {
      console.log('  ⚠️  No items found from today');
    } else {
      let total = 0;
      for (const row of categoryCounts.rows) {
        const count = Number(row.count);
        total += count;
        console.log(`  ${row.category}: ${count} items`);
      }
      console.log(`  Total: ${total} items`);
    }

    // Check most recent items by category
    console.log('\n📰 Most Recent Items (by category):');
    const categories = ['newsletters', 'podcasts', 'tech_articles', 'ai_news', 'product_news', 'community', 'research'];

    for (const category of categories) {
      const recentItems = await client.query(
        `SELECT id, title, published_at
         FROM items
         WHERE category = $1
         ORDER BY published_at DESC
         LIMIT 3`,
        [category]
      );

      if (recentItems.rows.length > 0) {
        const latest = recentItems.rows[0] as Record<string, unknown>;
        const latestDate = new Date(Number(latest.published_at) * 1000);
        const hoursAgo = (Date.now() - latestDate.getTime()) / (1000 * 60 * 60);
        console.log(`\n  ${category}:`);
        console.log(`    Latest: "${String(latest.title).substring(0, 60)}..."`);
        console.log(`    Published: ${latestDate.toISOString()} (${hoursAgo.toFixed(1)} hours ago)`);
        console.log(`    Total items: ${recentItems.rows.length} shown`);
      } else {
        console.log(`\n  ${category}: No items found`);
      }
    }

    // Check last published timestamp
    const lastPublishedResult = await client.query(
      `SELECT MAX(published_at) as max_published_at
       FROM items`
    );

    if (lastPublishedResult.rows.length > 0 && lastPublishedResult.rows[0].max_published_at) {
      const lastPublished = new Date(Number(lastPublishedResult.rows[0].max_published_at) * 1000);
      const hoursAgo = (Date.now() - lastPublished.getTime()) / (1000 * 60 * 60);
      console.log(`\n⏰ Last Published Item: ${lastPublished.toISOString()} (${hoursAgo.toFixed(1)} hours ago)`);
    }

    console.log('\n' + '='.repeat(60) + '\n');
  } catch (error) {
    logger.error('Failed to check sync status', error);
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSyncStatus();

