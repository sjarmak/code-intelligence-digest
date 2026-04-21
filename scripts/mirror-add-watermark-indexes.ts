#!/usr/bin/env tsx
/**
 * One-off: add watermark indexes needed for hourly incremental sync.
 *
 * Uses CREATE INDEX CONCURRENTLY so production writes are not blocked.
 * Safe to re-run: each index uses IF NOT EXISTS.
 *
 * Usage:
 *   npx tsx scripts/mirror-add-watermark-indexes.ts --target=production
 *   npx tsx scripts/mirror-add-watermark-indexes.ts --target=local
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const INDEXES: Array<{ name: string; sql: string }> = [
  {
    name: 'idx_items_updated_at',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_updated_at ON items(updated_at)`,
  },
  {
    name: 'idx_paper_sections_updated_at',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_paper_sections_updated_at ON paper_sections(updated_at)`,
  },
  {
    name: 'idx_item_embeddings_generated_at',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_item_embeddings_generated_at ON item_embeddings(generated_at)`,
  },
  {
    name: 'idx_item_scores_scored_at',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_item_scores_scored_at ON item_scores(scored_at)`,
  },
  {
    name: 'idx_ads_papers_updated_at',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ads_papers_updated_at ON ads_papers(updated_at)`,
  },
];

async function main() {
  const targetArg = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1];
  if (!targetArg || !['production', 'local'].includes(targetArg)) {
    console.error('Usage: --target=production | --target=local');
    process.exit(1);
  }

  const connStr =
    targetArg === 'production'
      ? process.env.PRODUCTION_DATABASE_URL
      : process.env.LOCAL_DATABASE_URL;
  if (!connStr) {
    console.error(`Missing env var for target=${targetArg}`);
    process.exit(1);
  }

  // CREATE INDEX CONCURRENTLY cannot run inside a transaction, so use a
  // single Client (pg driver auto-begins on Pool which is what we want to avoid).
  const client = new Client({
    connectionString: connStr,
    ssl: targetArg === 'production' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  console.log(`Target: ${targetArg}`);
  console.log(`Applying ${INDEXES.length} watermark indexes...\n`);

  for (const idx of INDEXES) {
    const start = Date.now();
    try {
      await client.query(idx.sql);
      console.log(`  ✅ ${idx.name} (${Date.now() - start}ms)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ ${idx.name}: ${msg}`);
    }
  }

  const verify = await client.query(
    `SELECT indexname, tablename FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = ANY($1::text[])
     ORDER BY indexname`,
    [INDEXES.map((i) => i.name)]
  );
  console.log(`\nVerified ${verify.rows.length}/${INDEXES.length} indexes present on ${targetArg}:`);
  for (const r of verify.rows) {
    console.log(`  - ${r.indexname} on ${r.tablename}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
