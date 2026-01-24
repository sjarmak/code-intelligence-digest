#!/usr/bin/env tsx
/**
 * Sync data from production Postgres database to local SQLite
 *
 * This script pulls fresh data from the production database instead of
 * making duplicate API calls to Inoreader. Useful for local development
 * to get the latest production data.
 *
 * Usage:
 *   npx tsx scripts/sync-from-production.ts [--days=7]
 *
 * Environment variables required:
 *   - DATABASE_URL: Production PostgreSQL connection string
 *   - Local SQLite will be used as destination (.data/digest.db)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

// Load .env.local for local development
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { getSqlite } from '../src/lib/db/index';
import { logger } from '../src/lib/logger';

interface SyncOptions {
  daysBack: number;
}

async function syncFromProduction(options: SyncOptions): Promise<void> {
  const { daysBack } = options;

  logger.info(`\n📥 Syncing data from production Postgres to local SQLite...`);
  logger.info(`Fetching items from last ${daysBack} days\n`);

  // Connect to production Postgres
  const productionUrl = process.env.DATABASE_URL;
  if (!productionUrl || !productionUrl.startsWith('postgres')) {
    throw new Error('DATABASE_URL must be set to production Postgres connection string');
  }

  const prodPool = new Pool({
    connectionString: productionUrl,
    ssl: {
      rejectUnauthorized: false, // Render uses self-signed certs
    },
  });

  try {
    // Get local SQLite database
    const localDb = await getSqlite();

    // 1. Sync feeds table
    logger.info('📋 Syncing feeds table...');
    const feedsResult = await prodPool.query('SELECT * FROM feeds');
    const feeds = feedsResult.rows;

    const feedInsert = localDb.prepare(`
      INSERT OR REPLACE INTO feeds (
        id, stream_id, canonical_name, default_category, vendor, tags,
        created_at, updated_at, source_relevance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let feedsUpserted = 0;
    for (const feed of feeds) {
      feedInsert.run(
        feed.id,
        feed.stream_id,
        feed.canonical_name,
        feed.default_category,
        feed.vendor,
        feed.tags,
        feed.created_at,
        feed.updated_at,
        feed.source_relevance
      );
      feedsUpserted++;
    }
    logger.info(`✅ Synced ${feedsUpserted} feeds\n`);

    // 2. Sync recent items (last N days) - use created_at to match our day period logic
    logger.info(`📰 Syncing items from last ${daysBack} days...`);
    const itemsResult = await prodPool.query(`
      SELECT * FROM items
      WHERE created_at >= extract(epoch from now() - interval '${daysBack} days')::integer
      ORDER BY created_at DESC
    `);
    const items = itemsResult.rows;

    const itemInsert = localDb.prepare(`
      INSERT OR REPLACE INTO items (
        id, stream_id, source_title, title, url, author, published_at,
        summary, content_snippet, categories, category, created_at, updated_at,
        full_text, full_text_fetched_at, full_text_source, extracted_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let itemsUpserted = 0;
    const categoryDistribution = new Map<string, number>();

    for (const item of items) {
      itemInsert.run(
        item.id,
        item.stream_id,
        item.source_title,
        item.title,
        item.url,
        item.author,
        item.published_at,
        item.summary,
        item.content_snippet,
        item.categories,
        item.category,
        item.created_at,
        item.updated_at,
        item.full_text,
        item.full_text_fetched_at,
        item.full_text_source,
        item.extracted_url
      );
      itemsUpserted++;

      // Track category distribution
      const cat = item.category || 'unknown';
      categoryDistribution.set(cat, (categoryDistribution.get(cat) || 0) + 1);
    }

    logger.info(`✅ Synced ${itemsUpserted} items\n`);

    // Show category breakdown
    logger.info('Category distribution:');
    const sortedCategories = Array.from(categoryDistribution.entries())
      .sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sortedCategories) {
      logger.info(`  ${cat}: ${count} items`);
    }

    // 3. Sync embeddings for recent items (optional - may not exist in production yet)
    logger.info(`\n🧮 Syncing embeddings...`);
    const itemIds = items.map(i => i.id);
    let totalEmbeddings = 0;

    try {
      if (itemIds.length > 0) {
        // Batch embeddings query (Postgres has a limit on array size, so batch in chunks of 1000)
        const BATCH_SIZE = 1000;

        for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
          const batch = itemIds.slice(i, i + BATCH_SIZE);
          const embeddingsResult = await prodPool.query(
            'SELECT item_id, embedding FROM item_embeddings WHERE item_id = ANY($1)',
            [batch]
          );

          const embeddings = embeddingsResult.rows;

          const embeddingInsert = localDb.prepare(`
            INSERT OR REPLACE INTO item_embeddings (item_id, embedding, generated_at)
            VALUES (?, ?, ?)
          `);

          for (const emb of embeddings) {
            // Convert pgvector to JSON array for SQLite
            // pgvector may return as string '[0.1,0.2,...]' or as array
            let embeddingArray = emb.embedding;
            if (typeof emb.embedding === 'string') {
              // Parse pgvector string format
              embeddingArray = emb.embedding
                .replace(/[\[\]]/g, '')
                .split(',')
                .map((s: string) => parseFloat(s.trim()));
            }
            const embeddingJson = JSON.stringify(embeddingArray);
            const now = Math.floor(Date.now() / 1000);
            embeddingInsert.run(emb.item_id, embeddingJson, now);
            totalEmbeddings++;
          }
        }

        logger.info(`✅ Synced ${totalEmbeddings} embeddings\n`);
      }
    } catch (error) {
      const err = error as { code?: string; message?: string };
      if (err.code === '42P01') {
        logger.warn('⚠️  item_embeddings table does not exist in production - skipping embeddings sync');
      } else {
        logger.error('Error syncing embeddings:', err.message);
        throw error;
      }
    }

    // 4. Sync item scores for recent items
    logger.info(`\n📊 Syncing item scores...`);
    const itemIdsForScores = items.map(i => i.id);
    let totalScores = 0;

    try {
      if (itemIdsForScores.length > 0) {
        // Batch scores query (Postgres has a limit on array size, so batch in chunks of 1000)
        const BATCH_SIZE = 1000;

        for (let i = 0; i < itemIdsForScores.length; i += BATCH_SIZE) {
          const batch = itemIdsForScores.slice(i, i + BATCH_SIZE);
          const scoresResult = await prodPool.query(
            'SELECT * FROM item_scores WHERE item_id = ANY($1)',
            [batch]
          );

          const scores = scoresResult.rows;

          const scoreInsert = localDb.prepare(`
            INSERT OR REPLACE INTO item_scores (
              item_id, category, bm25_score, llm_relevance, llm_usefulness,
              llm_tags, recency_score, engagement_score, final_score, reasoning, scored_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const score of scores) {
            scoreInsert.run(
              score.item_id,
              score.category,
              score.bm25_score,
              score.llm_relevance,
              score.llm_usefulness,
              score.llm_tags,
              score.recency_score,
              score.engagement_score || null,
              score.final_score,
              score.reasoning || null,
              score.scored_at
            );
            totalScores++;
          }
        }

        logger.info(`✅ Synced ${totalScores} item scores\n`);
      }
    } catch (error) {
      const err = error as { code?: string; message?: string };
      if (err.code === '42P01') {
        logger.warn('⚠️  item_scores table does not exist in production - skipping scores sync');
      } else {
        logger.error('Error syncing scores:', err.message);
        throw error;
      }
    }

    // 5. Update cache metadata
    logger.info('🔄 Updating cache metadata...');
    const now = Math.floor(Date.now() / 1000);

    localDb.prepare(`
      INSERT OR REPLACE INTO cache_metadata (key, last_refresh_at, count, expires_at)
      VALUES ('feeds', ?, ?, ?)
    `).run(now, feedsUpserted, now + 3600);

    logger.info('✅ Cache metadata updated\n');

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Production → Local Sync Summary');
    console.log('='.repeat(60));
    console.log(`Feeds synced:       ${feedsUpserted}`);
    console.log(`Items synced:       ${itemsUpserted}`);
    console.log(`Scores synced:      ${totalScores || 0}`);
    console.log(`Embeddings synced:  ${totalEmbeddings || 0}`);
    console.log(`Days back:          ${daysBack}`);
    console.log('='.repeat(60) + '\n');

    logger.info('✅ Sync from production completed successfully!');

  } finally {
    await prodPool.end();
  }
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const daysArg = args.find(arg => arg.startsWith('--days='));
  const daysBack = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7;

  if (isNaN(daysBack) || daysBack < 1) {
    console.error('Error: --days must be a positive integer');
    process.exit(1);
  }

  try {
    await syncFromProduction({ daysBack });
  } catch (error) {
    logger.error('Sync from production failed', error);
    console.error('\n❌ Sync failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error in sync script', error);
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
