#!/usr/bin/env tsx
/**
 * Check production database state for daily items
 * Run this to diagnose why daily items aren't showing in production
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { getDbClient, detectDriver } from '../src/lib/db/driver';
import { loadScoresForItems } from '../src/lib/db/items';
import { PERIOD_CONFIG } from '../src/config/periods';
import { Category } from '../src/lib/model';

async function checkProduction() {
  await initializeDatabase();
  const driver = detectDriver();
  const client = await getDbClient();
  
  console.log(`🔍 Checking ${driver === 'postgres' ? 'PRODUCTION' : 'LOCAL'} database for daily items...\n`);
  
  const categories: Category[] = ['newsletters', 'podcasts', 'tech_articles', 'ai_news', 'product_news', 'community', 'research'];
  const periodDays = PERIOD_CONFIG.day.days!;
  const cutoffTime = Math.floor((Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000);
  const dateColumn = 'created_at';
  
  console.log(`Period config: day = ${periodDays} days`);
  console.log(`Cutoff time: ${new Date(cutoffTime * 1000).toISOString()}\n`);
  
  for (const category of categories) {
    const whereClause = category === 'newsletters'
      ? `category = $1 AND id LIKE '%-article-%' AND ${dateColumn} >= $2`
      : `category = $1 AND ${dateColumn} >= $2`;
    
    // Count items
    const countResult = await client.query(
      `SELECT COUNT(*) as count FROM items WHERE ${whereClause}`,
      [category, cutoffTime]
    );
    const count = countResult.rows[0] as { count: number };
    
    if (count.count === 0) {
      console.log(`❌ ${category}: 0 items (created_at >= ${new Date(cutoffTime * 1000).toISOString()})`);
      
      // Check if there are any items at all in this category
      const totalResult = await client.query(
        `SELECT COUNT(*) as total, MAX(created_at) as latest_created, MAX(published_at) as latest_published FROM items WHERE category = $1`,
        [category]
      );
      const total = totalResult.rows[0] as { total: number; latest_created: number | null; latest_published: number | null };
      
      if (total.total > 0) {
        const latestCreated = total.latest_created ? new Date(total.latest_created * 1000).toISOString() : 'never';
        const latestPublished = total.latest_published ? new Date(total.latest_published * 1000).toISOString() : 'never';
        console.log(`   ℹ️  But ${total.total} total items exist (latest created: ${latestCreated}, latest published: ${latestPublished})`);
        
        // Check how old the latest item is
        if (total.latest_created) {
          const ageHours = (Date.now() - total.latest_created * 1000) / (1000 * 60 * 60);
          console.log(`   ℹ️  Latest item is ${ageHours.toFixed(1)} hours old (need items from last ${periodDays * 24} hours)`);
        }
      }
      continue;
    }
    
    // Get sample items
    const itemsResult = await client.query(
      `SELECT id, title, created_at, published_at FROM items WHERE ${whereClause} ORDER BY ${dateColumn} DESC LIMIT 5`,
      [category, cutoffTime]
    );
    
    const itemIds = itemsResult.rows.map((row: any) => row.id);
    const scores = await loadScoresForItems(itemIds);
    const itemsWithScores = Object.keys(scores).length;
    
    console.log(`✅ ${category}: ${count.count} items`);
    console.log(`   Items with scores: ${itemsWithScores}/${itemIds.length}`);
    
    if (itemsWithScores < itemIds.length) {
      console.log(`   ⚠️  ${itemIds.length - itemsWithScores} items missing scores!`);
    }
    
    // Show sample
    if (itemsResult.rows.length > 0) {
      const sample = itemsResult.rows[0] as { id: string; title: string; created_at: number; published_at: number };
      console.log(`   Sample: "${sample.title.substring(0, 50)}..."`);
      console.log(`   Created: ${new Date(sample.created_at * 1000).toISOString()}`);
    }
  }
  
  // Check sync state
  console.log(`\n📊 Sync State:`);
  const syncState = await client.query(
    `SELECT * FROM sync_state WHERE id = 'hourly-sync' ORDER BY last_updated_at DESC LIMIT 1`
  );
  
  if (syncState.rows.length > 0) {
    const state = syncState.rows[0] as any;
    console.log(`   Status: ${state.status}`);
    console.log(`   Items processed: ${state.items_processed}`);
    console.log(`   Last updated: ${new Date(state.last_updated_at * 1000).toISOString()}`);
    if (state.error) {
      console.log(`   Error: ${state.error}`);
    }
  } else {
    console.log(`   No sync state found`);
  }
}

if (require.main === module) {
  checkProduction().catch(console.error);
}

