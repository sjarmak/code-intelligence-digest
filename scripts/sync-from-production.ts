#!/usr/bin/env tsx
/**
 * Sync data from production Postgres → local Postgres
 *
 * Usage:
 *   npx tsx scripts/sync-from-production.ts [--days=7]
 *
 * Environment variables:
 *   - PRODUCTION_DATABASE_URL (preferred) or DATABASE_URL: production Postgres connection string
 *   - LOCAL_DATABASE_URL: local Postgres connection string (Docker Compose / dev DB)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

// Load .env.local for local development
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { logger } from '../src/lib/logger';

interface SyncOptions {
  daysBack: number;
}

function requirePostgresUrl(envName: string): string {
  const url = process.env[envName];
  if (!url || !(url.startsWith('postgres://') || url.startsWith('postgresql://'))) {
    throw new Error(`${envName} must be set to a postgres:// or postgresql:// connection string`);
  }
  return url;
}

async function syncFromProduction(options: SyncOptions): Promise<void> {
  const { daysBack } = options;

  const productionUrl =
    process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL || '';
  if (!productionUrl.startsWith('postgres')) {
    throw new Error('Set PRODUCTION_DATABASE_URL (recommended) or DATABASE_URL to production Postgres');
  }
  const localUrl = requirePostgresUrl('LOCAL_DATABASE_URL');

  logger.info(`\n📥 Syncing data from production Postgres → local Postgres...`);
  logger.info(`Fetching items from last ${daysBack} days\n`);

  const prodPool = new Pool({
    connectionString: productionUrl,
    ssl: productionUrl.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  });

  const localPool = new Pool({
    connectionString: localUrl,
    ssl: localUrl.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    // 1) Sync feeds
    logger.info('📋 Syncing feeds table...');
    const feedsResult = await prodPool.query('SELECT * FROM feeds');
    const feeds = feedsResult.rows;

    let feedsUpserted = 0;
    for (const feed of feeds) {
      await localPool.query(
        `
        INSERT INTO feeds (
          id, stream_id, canonical_name, default_category, vendor, tags,
          created_at, updated_at, source_relevance
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          stream_id = EXCLUDED.stream_id,
          canonical_name = EXCLUDED.canonical_name,
          default_category = EXCLUDED.default_category,
          vendor = EXCLUDED.vendor,
          tags = EXCLUDED.tags,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          source_relevance = EXCLUDED.source_relevance
      `,
        [
          feed.id,
          feed.stream_id,
          feed.canonical_name,
          feed.default_category,
          feed.vendor,
          feed.tags,
          feed.created_at,
          feed.updated_at,
          feed.source_relevance,
        ]
      );
      feedsUpserted++;
    }
    logger.info(`✅ Synced ${feedsUpserted} feeds\n`);

    // 2) Sync recent items
    logger.info(`📰 Syncing items from last ${daysBack} days...`);
    const itemsResult = await prodPool.query(
      `
      SELECT * FROM items
      WHERE created_at >= extract(epoch from now() - interval '${daysBack} days')::integer
      ORDER BY created_at DESC
    `
    );
    const items = itemsResult.rows;

    let itemsUpserted = 0;
    const categoryDistribution = new Map<string, number>();

    for (const item of items) {
      await localPool.query(
        `
        INSERT INTO items (
          id, stream_id, source_title, title, url, author, published_at,
          summary, content_snippet, categories, category, created_at, updated_at,
          full_text, full_text_fetched_at, full_text_source, extracted_url
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
        )
        ON CONFLICT (id) DO UPDATE SET
          stream_id = EXCLUDED.stream_id,
          source_title = EXCLUDED.source_title,
          title = EXCLUDED.title,
          url = EXCLUDED.url,
          author = EXCLUDED.author,
          published_at = EXCLUDED.published_at,
          summary = EXCLUDED.summary,
          content_snippet = EXCLUDED.content_snippet,
          categories = EXCLUDED.categories,
          category = EXCLUDED.category,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          full_text = EXCLUDED.full_text,
          full_text_fetched_at = EXCLUDED.full_text_fetched_at,
          full_text_source = EXCLUDED.full_text_source,
          extracted_url = EXCLUDED.extracted_url
      `,
        [
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
          item.extracted_url,
        ]
      );
      itemsUpserted++;

      const cat = item.category || 'unknown';
      categoryDistribution.set(cat, (categoryDistribution.get(cat) || 0) + 1);
    }

    logger.info(`✅ Synced ${itemsUpserted} items\n`);

    logger.info('Category distribution:');
    const sortedCategories = Array.from(categoryDistribution.entries()).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sortedCategories) {
      logger.info(`  ${cat}: ${count} items`);
    }

    // 3) Embeddings
    logger.info(`\n🧮 Syncing embeddings...`);
    const itemIds = items.map((i) => i.id);
    let totalEmbeddings = 0;

    try {
      if (itemIds.length > 0) {
        const BATCH_SIZE = 1000;

        for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
          const batch = itemIds.slice(i, i + BATCH_SIZE);
          const embeddingsResult = await prodPool.query(
            'SELECT item_id, embedding, embedding_model, generated_at FROM item_embeddings WHERE item_id = ANY($1)',
            [batch]
          );

          const embeddings = embeddingsResult.rows;

          for (const emb of embeddings) {
            await localPool.query(
              `
              INSERT INTO item_embeddings (item_id, embedding, embedding_model, generated_at)
              VALUES ($1, $2::vector, $3, $4)
              ON CONFLICT (item_id) DO UPDATE SET
                embedding = EXCLUDED.embedding,
                embedding_model = EXCLUDED.embedding_model,
                generated_at = EXCLUDED.generated_at
            `,
              [emb.item_id, emb.embedding, emb.embedding_model ?? 'text-embedding-3-small', emb.generated_at]
            );
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

    // 4) Scores
    logger.info(`\n📊 Syncing item scores...`);
    const itemIdsForScores = items.map((i) => i.id);
    let totalScores = 0;

    try {
      if (itemIdsForScores.length > 0) {
        const BATCH_SIZE = 1000;

        for (let i = 0; i < itemIdsForScores.length; i += BATCH_SIZE) {
          const batch = itemIdsForScores.slice(i, i + BATCH_SIZE);
          const scoresResult = await prodPool.query('SELECT * FROM item_scores WHERE item_id = ANY($1)', [batch]);

          const scores = scoresResult.rows;

          for (const score of scores) {
            await localPool.query(
              `
              INSERT INTO item_scores (
                item_id, category, bm25_score, llm_relevance, llm_usefulness,
                llm_tags, recency_score, engagement_score, final_score, reasoning, scored_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (item_id, scored_at) DO UPDATE SET
                category = EXCLUDED.category,
                bm25_score = EXCLUDED.bm25_score,
                llm_relevance = EXCLUDED.llm_relevance,
                llm_usefulness = EXCLUDED.llm_usefulness,
                llm_tags = EXCLUDED.llm_tags,
                recency_score = EXCLUDED.recency_score,
                engagement_score = EXCLUDED.engagement_score,
                final_score = EXCLUDED.final_score,
                reasoning = EXCLUDED.reasoning
            `,
              [
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
                score.scored_at,
              ]
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

    // 5) Cache metadata
    logger.info('🔄 Updating cache metadata...');
    const now = Math.floor(Date.now() / 1000);

    await localPool.query(
      `
      INSERT INTO cache_metadata (key, last_refresh_at, count, expires_at)
      VALUES ('feeds', $1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET
        last_refresh_at = EXCLUDED.last_refresh_at,
        count = EXCLUDED.count,
        expires_at = EXCLUDED.expires_at
    `,
      [now, feedsUpserted, now + 3600]
    );

    logger.info('✅ Cache metadata updated\n');

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
    await localPool.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const daysArg = args.find((arg) => arg.startsWith('--days='));
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
