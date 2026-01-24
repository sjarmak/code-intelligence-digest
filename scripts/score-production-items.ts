#!/usr/bin/env tsx
/**
 * Score items locally and sync scores to production database
 *
 * This script:
 * 1. Fetches unscored items from production database
 * 2. Scores them locally (where we have more memory/resources)
 * 3. Saves scores back to production database
 * 4. Repeats until all items are scored
 *
 * Usage:
 *   npx tsx scripts/score-production-items.ts [--category=research] [--batch-size=25]
 *
 * Environment variables required:
 *   - DATABASE_URL: Production PostgreSQL connection string
 *   - OPENAI_API_KEY: For LLM scoring
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

// Load .env.local for local development
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { FeedItem, Category, RankedItem } from '../src/lib/model';
import { logger } from '../src/lib/logger';

const VALID_CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "product_news",
  "community",
  "research",
];

interface ScoreOptions {
  category?: Category;
  batchSize?: number;
}

async function scoreProductionItems(options: ScoreOptions): Promise<void> {
  const { category, batchSize = 25 } = options;

  logger.info(`\n🎯 Scoring items locally and syncing to production...`);
  if (category) {
    logger.info(`Category: ${category}\n`);
  } else {
    logger.info(`All categories\n`);
  }

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
    const categoriesToProcess = category ? [category] : VALID_CATEGORIES;
    let totalScored = 0;

    for (const cat of categoriesToProcess) {
      logger.info(`\n📊 Processing category: ${cat}`);

      // Find items without scores
      const unscoredResult = await prodPool.query(`
        SELECT i.*
        FROM items i
        LEFT JOIN item_scores s ON i.id = s.item_id
        WHERE i.category = $1
          AND s.item_id IS NULL
        ORDER BY i.created_at DESC
        LIMIT $2
      `, [cat, batchSize * 10]); // Fetch more items to batch process

      const unscoredRows = unscoredResult.rows;
      logger.info(`Found ${unscoredRows.length} unscored items in category ${cat}`);

      if (unscoredRows.length === 0) {
        logger.info(`✅ All items in category ${cat} are already scored`);
        continue;
      }

      // Convert rows to FeedItem format
      const items: FeedItem[] = unscoredRows.map((row) => {
        return {
          id: row.id,
          streamId: row.stream_id,
          sourceTitle: row.source_title,
          title: row.title,
          url: row.url,
          author: row.author || undefined,
          publishedAt: new Date(row.published_at * 1000),
          createdAt: new Date(row.created_at * 1000),
          summary: row.summary || undefined,
          contentSnippet: row.content_snippet || undefined,
          categories: JSON.parse(row.categories || '[]'),
          category: cat,
          raw: {},
          fullText: row.full_text || undefined, // Include full text for scoring
        };
      });

      // Score items locally and save directly to production
      // We'll replicate the scoring logic from compute-scores.ts but save to production
      logger.info(`Scoring ${items.length} items locally...`);

      // Import scoring dependencies
      const { BM25Index } = await import('../src/lib/pipeline/bm25');
      const { scoreWithLLM } = await import('../src/lib/pipeline/llmScore');
      const { getCategoryConfig } = await import('../src/config/categories');

      const config = getCategoryConfig(cat);
      const BATCH_SIZE = cat === 'research' ? 25 : 100;
      let batchScored = 0;
      const scoredAt = Math.floor(Date.now() / 1000);

      // Helper function to compute recency score
      const computeRecencyScore = (publishedAt: Date, halfLifeDays: number): number => {
        const now = Date.now();
        const ageMs = now - publishedAt.getTime();
        const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
        const decayFactor = Math.exp(-Math.log(2) * (ageMs / halfLifeMs));
        return 0.2 + 0.8 * decayFactor;
      };

      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(items.length / BATCH_SIZE);

        logger.info(`Processing batch ${batchNum}/${totalBatches} (${batch.length} items)...`);

        // Build BM25 index for this batch
        const bm25 = new BM25Index();
        bm25.addDocuments(batch);
        const queryTerms = config.query
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 0);
        const bm25Scores = bm25.score(queryTerms);
        const bm25Normalized = bm25.normalizeScores(bm25Scores);

        // Filter out items with insufficient content before LLM scoring
        const itemsWithContent = batch.filter((item) => {
          const hasRealContent =
            (item.summary && item.summary.length > item.title.length + 20) ||
            (item.contentSnippet && item.contentSnippet.length > item.title.length + 20) ||
            (item.fullText && item.fullText.length > 100);
          return hasRealContent;
        });

        // Compute LLM scores only for items with sufficient content
        // If LLM scoring fails, we'll continue with BM25 scores only
        let llmScores: Record<string, any> = {};
        if (itemsWithContent.length > 0) {
          try {
            llmScores = await scoreWithLLM(itemsWithContent, cat, 30);
          } catch (error) {
            logger.warn(`LLM scoring failed for batch ${batchNum}, continuing with BM25 scores only`, { error });
            llmScores = {};
          }
        }

        // Compute all scores (same logic as computeAndSaveScoresForCategory)
        const rankedItems: RankedItem[] = batch.map((item) => {
          const bm25Score = bm25Normalized.get(item.id) ?? 0;
          const llmResult = llmScores[item.id];

          const hasRealContent =
            (item.summary && item.summary.length > item.title.length + 20) ||
            (item.contentSnippet && item.contentSnippet.length > item.title.length + 20) ||
            (item.fullText && item.fullText.length > 100);

          const llmScore = llmResult
            ? (0.7 * llmResult.relevance + 0.3 * llmResult.usefulness) / 10
            : hasRealContent
              ? bm25Score
              : bm25Score * 0.3;

          const recencyScore = computeRecencyScore(item.publishedAt, config.halfLifeDays);

          // Apply boosts (simplified - same logic as compute-scores.ts)
          let boostMultiplier = 1.0;
          const contentToSearch = `${item.title} ${item.summary || ''} ${item.contentSnippet || ''}`.toLowerCase();
          const boostTags: string[] = [];

          // Product news boost
          if (cat === "product_news") {
            const productNames = [
              'augment code', 'claude code', 'cursor', 'windsurf', 'warp',
              'greptile', 'coderabbit', 'codex', 'gemini cli', 'github copilot', 'kilo',
            ];
            const matchingProducts = productNames.filter(product => contentToSearch.includes(product));
            if (matchingProducts.length > 0) {
              boostMultiplier = matchingProducts.length >= 2 ? 4.0 : 3.0;
              boostTags.push(...matchingProducts);
            }
          }

          // Sourcegraph boost
          if (contentToSearch.includes('sourcegraph')) {
            boostMultiplier = 5.0;
            boostTags.push('sourcegraph');
          } else {
            const coreTerms = [
              'deep search', 'code search', 'code intelligence', 'coding agent',
              'codebase understanding', 'information retrieval', 'context management',
              'context window', 'software engineering', 'benchmark', 'evaluation',
              'developer productivity', 'ai tooling',
            ];
            const matchingCoreTerms = coreTerms.filter(term => contentToSearch.includes(term)).length;
            const hasAgent = contentToSearch.includes('agent') || contentToSearch.includes('agentic') || contentToSearch.includes('coding agent');
            const hasCodeContext = coreTerms.slice(1, 8).some(term => contentToSearch.includes(term));

            if (matchingCoreTerms >= 3) {
              boostMultiplier = 3.0;
            } else if (matchingCoreTerms === 2) {
              boostMultiplier = 2.0;
            } else if (hasAgent && hasCodeContext) {
              boostMultiplier = 2.5;
            } else if (matchingCoreTerms === 1) {
              boostMultiplier = 1.5;
            }
          }

          const finalScore = (config.weights.llm * llmScore + config.weights.bm25 * bm25Score) * boostMultiplier;

          const reasoning = [
            `LLM: relevance=${llmResult?.relevance.toFixed(1)}, usefulness=${llmResult?.usefulness.toFixed(1)}`,
            `BM25=${bm25Score.toFixed(2)}`,
            boostMultiplier > 1.0 ? `[BOOST] ${boostMultiplier}x` : '',
            `Tags: ${llmResult?.tags.join(", ") || "none"}`,
          ].filter(Boolean).join(" | ");

          return {
            ...item,
            bm25Score,
            llmScore: {
              relevance: llmResult?.relevance ?? Math.round((bm25Score * 10)),
              usefulness: llmResult?.usefulness ?? Math.round((bm25Score * 10)),
              tags: [...(llmResult?.tags ?? []), ...boostTags],
            },
            recencyScore,
            finalScore,
            reasoning,
          };
        });

        // Save scores directly to production database
        logger.info(`Saving batch ${batchNum}/${totalBatches} scores to production...`);
        for (const item of rankedItems) {
          await prodPool.query(`
            INSERT INTO item_scores
            (item_id, category, bm25_score, llm_relevance, llm_usefulness, llm_tags,
             recency_score, engagement_score, final_score, reasoning, scored_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (item_id, scored_at) DO NOTHING
          `, [
            item.id,
            cat,
            item.bm25Score,
            Math.round(item.llmScore.relevance),
            Math.round(item.llmScore.usefulness),
            JSON.stringify(item.llmScore.tags),
            item.recencyScore,
            item.engagementScore || null,
            item.finalScore,
            item.reasoning,
            scoredAt,
          ]);
        }

        batchScored += rankedItems.length;
        logger.info(`✅ Saved batch ${batchNum}/${totalBatches} (${rankedItems.length} items, ${batchScored} total so far)`);
      }

      logger.info(`✅ Scored and saved ${batchScored} items to production database`);
      totalScored += batchScored;

      // Check if there are more items to score
      const remainingResult = await prodPool.query(`
        SELECT COUNT(*) as count
        FROM items i
        LEFT JOIN item_scores s ON i.id = s.item_id
        WHERE i.category = $1
          AND s.item_id IS NULL
      `, [cat]);

      const remaining = parseInt(remainingResult.rows[0].count, 10);
      if (remaining > 0) {
        logger.info(`📋 ${remaining} items remaining in category ${cat}`);
      } else {
        logger.info(`✅ Category ${cat} is fully scored!`);
      }
    }

    logger.info(`\n🎉 Complete! Scored ${totalScored} items total`);
  } catch (error) {
    logger.error('Failed to score production items', error);
    throw error;
  } finally {
    await prodPool.end();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: ScoreOptions = {};

for (const arg of args) {
  if (arg.startsWith('--category=')) {
    const cat = arg.split('=')[1] as Category;
    if (VALID_CATEGORIES.includes(cat)) {
      options.category = cat;
    } else {
      logger.error(`Invalid category: ${cat}. Valid categories: ${VALID_CATEGORIES.join(', ')}`);
      process.exit(1);
    }
  } else if (arg.startsWith('--batch-size=')) {
    const size = parseInt(arg.split('=')[1], 10);
    if (!isNaN(size) && size > 0) {
      options.batchSize = size;
    }
  }
}

// Run the script
scoreProductionItems(options).catch((error) => {
  logger.error('Script failed', error);
  process.exit(1);
});

