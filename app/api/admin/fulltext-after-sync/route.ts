/**
 * Smart full text population after sync
 * POST /api/admin/fulltext-after-sync
 * 
 * Automatically populates full text for:
 * 1. Research papers (via ADS API) - high priority
 * 2. Tech articles, AI news (via web scraping) - medium priority
 * 
 * This runs after daily sync to ensure new items get full text ASAP
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/src/lib/logger';
import { loadItemsByCategory, saveFullText, getFullTextCacheStats } from '@/src/lib/db/items';
import { fetchFullText, fetchFullTextBatch } from '@/src/lib/pipeline/fulltext';
import { getBibcodeMetadata } from '@/src/lib/ads/client';
import type { Category } from '@/src/lib/model';

interface PopulationStats {
  category: Category;
  loaded: number;
  fetched: number;
  successful: number;
  failed: number;
  duration: number;
}

/**
 * Extract arXiv ID from URL
 */
function extractArxivId(url: string): string | null {
  const match = url.match(/arxiv\.org(?:\/abs|\/pdf)\/(\d{4}\.\d{4,5})/);
  return match ? match[1] : null;
}

/**
 * Populate research papers via ADS API
 */
async function populateResearchViaADS(
  adsToken: string,
  limit: number = 500
): Promise<PopulationStats> {
  const startTime = Date.now();
  const category = 'research' as const;

  try {
    logger.info(`[ADS] Starting research population (max ${limit} items)...`);

    // Load research items without full text
    const items = await loadItemsByCategory(category, 365);
    const itemsToFetch = items
      .filter((item) => !item.fullText || (item.fullText?.length ?? 0) < 100)
      .slice(0, limit);

    if (itemsToFetch.length === 0) {
      return { category, loaded: items.length, fetched: 0, successful: 0, failed: 0, duration: 0 };
    }

    logger.info(`[ADS] Fetching ${itemsToFetch.length} research items...`);

    let successful = 0;
    let failed = 0;

    // Batch process (50 items per batch)
    const batchSize = 50;
    for (let i = 0; i < itemsToFetch.length; i += batchSize) {
      const batch = itemsToFetch.slice(i, i + batchSize);
      const arxivIds = batch.map((item) => extractArxivId(item.url)).filter(Boolean) as string[];

      if (arxivIds.length === 0) continue;

      try {
        // Build ADS query: arxiv:ID1 OR arxiv:ID2 OR ...
        const query = arxivIds.map((id) => `arxiv:${id}`).join(' OR ');
        const metadata = await getBibcodeMetadata(arxivIds, adsToken);

        // Save results
        for (const item of batch) {
          const arxivId = extractArxivId(item.url);
          if (!arxivId) {
            failed++;
            continue;
          }

          const bibcodes = Object.entries(metadata).find(
            ([, doc]) => doc.bibcode?.includes(arxivId)
          );

          if (bibcodes) {
            const [, doc] = bibcodes;
            const text = doc.body || doc.abstract || '';
            if (text.length > 100) {
              await saveFullText(item.id, text, 'arxiv');
              successful++;
            } else {
              failed++;
            }
          } else {
            failed++;
          }
        }

        // Rate limiting: wait between batches
        if (i + batchSize < itemsToFetch.length) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      } catch (error) {
        logger.warn(`[ADS] Batch failed: ${error instanceof Error ? error.message : String(error)}`);
        failed += batch.length;
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`[ADS] Research population done: ${successful} successful, ${failed} failed`);

    return { category, loaded: items.length, fetched: itemsToFetch.length, successful, failed, duration };
  } catch (error) {
    logger.error(`[ADS] Research population failed: ${error}`);
    return { category, loaded: 0, fetched: 0, successful: 0, failed: 0, duration: Date.now() - startTime };
  }
}

/**
 * Populate other categories via web scraping
 */
async function populateOtherCategories(
  categories: Category[] = ['tech_articles', 'ai_news'],
  maxPerCategory: number = 100,
  concurrency: number = 5
): Promise<PopulationStats[]> {
  const results: PopulationStats[] = [];

  for (const category of categories) {
    const startTime = Date.now();

    try {
      logger.info(`[WEB] Starting ${category} population (max ${maxPerCategory} items)...`);

      const items = await loadItemsByCategory(category, 30);
      const itemsToFetch = items
        .filter((item) => !item.fullText || (item.fullText?.length ?? 0) < 100)
        .slice(0, maxPerCategory);

      if (itemsToFetch.length === 0) {
        results.push({ category, loaded: items.length, fetched: 0, successful: 0, failed: 0, duration: 0 });
        continue;
      }

      logger.info(`[WEB] Fetching ${itemsToFetch.length} ${category} items...`);

      const batchResults = await fetchFullTextBatch(itemsToFetch, concurrency);
      let successful = 0;
      let failed = 0;

      for (const [itemId, result] of batchResults.entries()) {
        try {
          await saveFullText(itemId, result.text, result.source);
          if (result.source !== 'error') {
            successful++;
          } else {
            failed++;
          }
        } catch (error) {
          logger.warn(`[WEB] Failed to save ${itemId}: ${error}`);
          failed++;
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`[WEB] ${category} done: ${successful} successful, ${failed} failed`);

      results.push({ category, loaded: items.length, fetched: itemsToFetch.length, successful, failed, duration });
    } catch (error) {
      logger.error(`[WEB] ${category} population failed: ${error}`);
      results.push({ category, loaded: 0, fetched: 0, successful: 0, failed: 0, duration: Date.now() - startTime });
    }
  }

  return results;
}

/**
 * POST /api/admin/fulltext-after-sync
 * Populate full text for high-priority categories after sync
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { adsToken?: string; skipResearch?: boolean; skipWeb?: boolean } | null;
    const adsToken = body?.adsToken || process.env.ADS_API_TOKEN;
    const skipResearch = body?.skipResearch ?? false;
    const skipWeb = body?.skipWeb ?? false;

    logger.info('[FULLTEXT-AFTER-SYNC] Starting post-sync population...');

    const allResults: PopulationStats[] = [];

    // Populate research if not skipped
    if (!skipResearch && adsToken) {
      const researchResult = await populateResearchViaADS(adsToken, 200);
      allResults.push(researchResult);
    } else if (!skipResearch) {
      logger.warn('[FULLTEXT-AFTER-SYNC] Skipping research (no ADS token)');
    }

    // Populate other categories if not skipped
    if (!skipWeb) {
      const webResults = await populateOtherCategories(['tech_articles', 'ai_news'], 100, 5);
      allResults.push(...webResults);
    }

    // Get final stats
    const stats = await getFullTextCacheStats();

    logger.info('[FULLTEXT-AFTER-SYNC] Population complete');

    return NextResponse.json({
      status: 'ok',
      message: 'Full text population complete',
      results: allResults,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[FULLTEXT-AFTER-SYNC] Failed', { error: errorMsg });

    return NextResponse.json(
      {
        error: 'Population failed',
        message: errorMsg,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/fulltext-after-sync
 * Check status
 */
export async function GET() {
  const stats = await getFullTextCacheStats();

  return NextResponse.json({
    status: 'ready',
    message: 'POST with optional adsToken to populate full text',
    currentStats: stats,
    timestamp: new Date().toISOString(),
  });
}
