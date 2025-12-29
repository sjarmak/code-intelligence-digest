#!/usr/bin/env tsx
/**
 * Sync data from production Postgres database to local Postgres database
 *
 * This script pulls fresh data from the production database to your local
 * PostgreSQL instance. Useful for local development to get the latest production data.
 *
 * Usage:
 *   npx tsx scripts/sync-production-to-local-postgres.ts [--days=7]
 *
 * Environment variables required:
 *   - PRODUCTION_DATABASE_URL: Production PostgreSQL connection string
 *   - DATABASE_URL: Local PostgreSQL connection string (from .env.local)
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

async function syncProductionToLocal(options: SyncOptions): Promise<void> {
  const { daysBack } = options;

  logger.info(`\n📥 Syncing data from production Postgres to local Postgres...`);
  logger.info(`Fetching items from last ${daysBack} days\n`);

  // Connect to production Postgres
  const productionUrl = process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL;
  if (!productionUrl || !productionUrl.startsWith('postgres')) {
    throw new Error('PRODUCTION_DATABASE_URL or DATABASE_URL must be set to production Postgres connection string');
  }

  // Connect to local Postgres
  const localUrl = process.env.LOCAL_DATABASE_URL;
  if (!localUrl || !localUrl.startsWith('postgres')) {
    throw new Error('LOCAL_DATABASE_URL must be set to local Postgres connection string');
  }

  if (productionUrl === localUrl) {
    throw new Error('Production and local DATABASE_URL cannot be the same!');
  }

  const prodPool = new Pool({
    connectionString: productionUrl,
    ssl: {
      rejectUnauthorized: false, // Render uses self-signed certs
    },
  });

  const localPool = new Pool({
    connectionString: localUrl,
  });

  try {
    // Calculate cutoff timestamp
    const cutoffTime = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000);

    // Sync items
    logger.info('Syncing items...');
    const itemsResult = await prodPool.query(`
      SELECT * FROM items
      WHERE created_at >= $1
      ORDER BY created_at DESC
    `, [cutoffTime]);

    if (itemsResult.rows.length > 0) {
      // Delete existing items in date range from local
      await localPool.query(`
        DELETE FROM items WHERE created_at >= $1
      `, [cutoffTime]);

      // Insert items into local
      for (const item of itemsResult.rows) {
        await localPool.query(`
          INSERT INTO items (
            id, stream_id, source_title, title, url, author, published_at,
            summary, content_snippet, full_text, full_text_fetched_at, full_text_source,
            extracted_url, categories, category, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT(id) DO UPDATE SET
            stream_id = EXCLUDED.stream_id,
            source_title = EXCLUDED.source_title,
            title = EXCLUDED.title,
            url = EXCLUDED.url,
            author = EXCLUDED.author,
            published_at = EXCLUDED.published_at,
            summary = EXCLUDED.summary,
            content_snippet = EXCLUDED.content_snippet,
            full_text = EXCLUDED.full_text,
            full_text_fetched_at = EXCLUDED.full_text_fetched_at,
            full_text_source = EXCLUDED.full_text_source,
            extracted_url = EXCLUDED.extracted_url,
            categories = EXCLUDED.categories,
            category = EXCLUDED.category,
            updated_at = EXCLUDED.updated_at
        `, [
          item.id, item.stream_id, item.source_title, item.title, item.url, item.author,
          item.published_at, item.summary, item.content_snippet, item.full_text,
          item.full_text_fetched_at, item.full_text_source, item.extracted_url,
          item.categories, item.category, item.created_at, item.updated_at
        ]);
      }
      logger.info(`  ✅ Synced ${itemsResult.rows.length} items`);
    } else {
      logger.info('  ℹ️  No items to sync');
    }

    // Sync item_scores
    logger.info('Syncing item scores...');
    const scoresResult = await prodPool.query(`
      SELECT s.* FROM item_scores s
      INNER JOIN items i ON s.item_id = i.id
      WHERE i.created_at >= $1
      ORDER BY s.scored_at DESC
    `, [cutoffTime]);

    if (scoresResult.rows.length > 0) {
      // Delete existing scores for items in date range from local
      await localPool.query(`
        DELETE FROM item_scores
        WHERE item_id IN (SELECT id FROM items WHERE created_at >= $1)
      `, [cutoffTime]);

      // Insert scores into local
      for (const score of scoresResult.rows) {
        await localPool.query(`
          INSERT INTO item_scores (
            item_id, category, bm25_score, llm_relevance, llm_usefulness,
            llm_tags, recency_score, engagement_score, final_score, reasoning, scored_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT(item_id, scored_at) DO UPDATE SET
            category = EXCLUDED.category,
            bm25_score = EXCLUDED.bm25_score,
            llm_relevance = EXCLUDED.llm_relevance,
            llm_usefulness = EXCLUDED.llm_usefulness,
            llm_tags = EXCLUDED.llm_tags,
            recency_score = EXCLUDED.recency_score,
            engagement_score = EXCLUDED.engagement_score,
            final_score = EXCLUDED.final_score,
            reasoning = EXCLUDED.reasoning
        `, [
          score.item_id, score.category, score.bm25_score, score.llm_relevance,
          score.llm_usefulness, score.llm_tags, score.recency_score,
          score.engagement_score, score.final_score, score.reasoning, score.scored_at
        ]);
      }
      logger.info(`  ✅ Synced ${scoresResult.rows.length} scores`);
    } else {
      logger.info('  ℹ️  No scores to sync');
    }

    // Sync ADS papers (all of them, not just recent)
    logger.info('Syncing ADS papers...');
    const papersResult = await prodPool.query(`
      SELECT * FROM ads_papers ORDER BY created_at DESC
    `);

    if (papersResult.rows.length > 0) {
      // Clear local ADS papers
      await localPool.query('DELETE FROM ads_papers');

      // Insert papers into local
      for (const paper of papersResult.rows) {
        await localPool.query(`
          INSERT INTO ads_papers (
            bibcode, title, authors, pubdate, abstract, body, year, journal,
            ads_url, arxiv_url, fulltext_source, html_content, html_fetched_at,
            html_sections, html_figures, paper_notes, is_favorite, favorited_at,
            fetched_at, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
          ON CONFLICT(bibcode) DO UPDATE SET
            title = EXCLUDED.title,
            authors = EXCLUDED.authors,
            pubdate = EXCLUDED.pubdate,
            abstract = EXCLUDED.abstract,
            body = EXCLUDED.body,
            year = EXCLUDED.year,
            journal = EXCLUDED.journal,
            ads_url = EXCLUDED.ads_url,
            arxiv_url = EXCLUDED.arxiv_url,
            fulltext_source = EXCLUDED.fulltext_source,
            html_content = EXCLUDED.html_content,
            html_fetched_at = EXCLUDED.html_fetched_at,
            html_sections = EXCLUDED.html_sections,
            html_figures = EXCLUDED.html_figures,
            paper_notes = EXCLUDED.paper_notes,
            is_favorite = EXCLUDED.is_favorite,
            favorited_at = EXCLUDED.favorited_at,
            fetched_at = EXCLUDED.fetched_at,
            updated_at = EXCLUDED.updated_at
        `, [
          paper.bibcode, paper.title, paper.authors, paper.pubdate, paper.abstract,
          paper.body, paper.year, paper.journal, paper.ads_url, paper.arxiv_url,
          paper.fulltext_source, paper.html_content, paper.html_fetched_at,
          paper.html_sections, paper.html_figures, paper.paper_notes,
          paper.is_favorite, paper.favorited_at, paper.fetched_at,
          paper.created_at, paper.updated_at
        ]);
      }
      logger.info(`  ✅ Synced ${papersResult.rows.length} papers`);
    } else {
      logger.info('  ℹ️  No papers to sync');
    }

    // Sync paper_sections (all of them)
    logger.info('Syncing paper sections...');
    const sectionsResult = await prodPool.query(`
      SELECT * FROM paper_sections ORDER BY created_at DESC
    `);

    if (sectionsResult.rows.length > 0) {
      // Clear local paper sections
      await localPool.query('DELETE FROM paper_sections');

      // Insert sections into local
      for (const section of sectionsResult.rows) {
        await localPool.query(`
          INSERT INTO paper_sections (
            id, bibcode, section_id, section_title, level, summary,
            full_text, char_start, char_end, embedding, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT(id) DO UPDATE SET
            section_title = EXCLUDED.section_title,
            level = EXCLUDED.level,
            summary = EXCLUDED.summary,
            full_text = EXCLUDED.full_text,
            char_start = EXCLUDED.char_start,
            char_end = EXCLUDED.char_end,
            embedding = EXCLUDED.embedding,
            updated_at = EXCLUDED.updated_at
        `, [
          section.id, section.bibcode, section.section_id, section.section_title,
          section.level, section.summary, section.full_text, section.char_start,
          section.char_end, section.embedding, section.created_at, section.updated_at
        ]);
      }
      logger.info(`  ✅ Synced ${sectionsResult.rows.length} paper sections`);
    } else {
      logger.info('  ℹ️  No paper sections to sync');
    }

    logger.info('\n✅ Sync complete!');
  } catch (error) {
    logger.error('Sync failed', { error });
    throw error;
  } finally {
    await prodPool.end();
    await localPool.end();
  }
}

// Parse command line arguments
const daysBack = process.argv.includes('--days')
  ? parseInt(process.argv[process.argv.indexOf('--days') + 1], 10)
  : 7;

syncProductionToLocal({ daysBack })
  .then(() => {
    logger.info('Sync script completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Sync script failed', { error });
    process.exit(1);
  });

