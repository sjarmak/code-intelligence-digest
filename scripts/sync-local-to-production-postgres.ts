#!/usr/bin/env tsx
/**
 * Sync data from local Postgres database to production Postgres database
 *
 * This script pushes data from your local database (where you've done batch
 * enrichment/backfilling) to production. Use this after completing local work.
 *
 * Usage:
 *   npx tsx scripts/sync-local-to-production-postgres.ts [--tables=items,item_scores,ads_papers]
 *
 * Environment variables required:
 *   - LOCAL_DATABASE_URL: Local PostgreSQL connection string
 *   - PRODUCTION_DATABASE_URL: Production PostgreSQL connection string
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

// Load .env.local for local development
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { logger } from '../src/lib/logger';

interface SyncOptions {
  tables: string[];
}

async function syncLocalToProduction(options: SyncOptions): Promise<void> {
  const { tables } = options;

  logger.info(`\n📤 Syncing data from local Postgres to production Postgres...`);
  logger.info(`Tables to sync: ${tables.join(', ')}\n`);

  // Connect to local Postgres
  const localUrl = process.env.LOCAL_DATABASE_URL;
  if (!localUrl || !localUrl.startsWith('postgres')) {
    throw new Error('LOCAL_DATABASE_URL must be set to local Postgres connection string');
  }

  // Connect to production Postgres
  const productionUrl = process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL;
  if (!productionUrl || !productionUrl.startsWith('postgres')) {
    throw new Error('PRODUCTION_DATABASE_URL or DATABASE_URL must be set to production Postgres connection string');
  }

  if (productionUrl === localUrl) {
    throw new Error('Production and local DATABASE_URL cannot be the same!');
  }

  const localPool = new Pool({
    connectionString: localUrl,
  });

  const prodPool = new Pool({
    connectionString: productionUrl,
    ssl: {
      rejectUnauthorized: false, // Render uses self-signed certs
    },
  });

  try {
    // Sync each table
    for (const table of tables) {
      logger.info(`Syncing ${table}...`);

      // Get all data from local
      const localResult = await localPool.query(`SELECT * FROM ${table} ORDER BY created_at DESC`);

      if (localResult.rows.length === 0) {
        logger.info(`  ℹ️  No data in local ${table}`);
        continue;
      }

      logger.info(`  📥 Found ${localResult.rows.length} rows in local ${table}`);

      // Get column names
      const columns = Object.keys(localResult.rows[0]);
      const columnList = columns.join(', ');
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const updateClause = columns
        .filter(col => col !== 'id' && col !== 'created_at') // Don't update these
        .map((col, i) => `${col} = EXCLUDED.${col}`)
        .join(', ');

      // Insert/update into production
      let synced = 0;
      for (const row of localResult.rows) {
        const values = columns.map(col => row[col]);

        try {
          await prodPool.query(`
            INSERT INTO ${table} (${columnList})
            VALUES (${placeholders})
            ON CONFLICT (id) DO UPDATE SET ${updateClause}
          `, values);
          synced++;
        } catch (error) {
          logger.warn(`  ⚠️  Failed to sync row ${row.id || 'unknown'}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.info(`  ✅ Synced ${synced}/${localResult.rows.length} rows to production`);
    }

    logger.info('\n✅ Sync complete!');
  } catch (error) {
    logger.error('Sync failed', { error });
    throw error;
  } finally {
    await localPool.end();
    await prodPool.end();
  }
}

// Parse command line arguments
const tablesArg = process.argv.find(arg => arg.startsWith('--tables='));
const tables = tablesArg
  ? tablesArg.split('=')[1].split(',').map(t => t.trim())
  : ['items', 'item_scores', 'ads_papers', 'paper_sections']; // Default tables

syncLocalToProduction({ tables })
  .then(() => {
    logger.info('Sync script completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Sync script failed', { error });
    process.exit(1);
  });

