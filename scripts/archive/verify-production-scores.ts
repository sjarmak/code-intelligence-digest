#!/usr/bin/env tsx
/**
 * Verify scores in production database
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const prodPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function verify() {
  try {
    // Count total scores
    const totalResult = await prodPool.query(`
      SELECT COUNT(*) as count FROM item_scores
    `);

    // Count by category
    const byCategoryResult = await prodPool.query(`
      SELECT category, COUNT(*) as count
      FROM item_scores
      GROUP BY category
      ORDER BY category
    `);

    // Count recent scores (last hour)
    const recentResult = await prodPool.query(`
      SELECT COUNT(*) as count
      FROM item_scores
      WHERE scored_at > EXTRACT(EPOCH FROM NOW())::INTEGER - 3600
    `);

    // Count unscored items
    const unscoredResult = await prodPool.query(`
      SELECT COUNT(*) as count
      FROM items i
      LEFT JOIN item_scores s ON i.id = s.item_id
      WHERE s.item_id IS NULL
    `);

    console.log(`\n📊 Production Database Score Summary:\n`);
    console.log(`Total scores: ${totalResult.rows[0].count}`);
    console.log(`Recent scores (last hour): ${recentResult.rows[0].count}`);
    console.log(`Unscored items: ${unscoredResult.rows[0].count}\n`);
    console.log(`Scores by category:`);
    for (const row of byCategoryResult.rows) {
      console.log(`  ${row.category.padEnd(15)}: ${row.count}`);
    }
    console.log();
  } finally {
    await prodPool.end();
  }
}

verify().catch(console.error);

