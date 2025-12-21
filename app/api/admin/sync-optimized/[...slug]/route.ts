/**
 * API route: POST /api/admin/sync-optimized
 * 
 * Optimized sync that uses only 1-3 API calls total
 * Perfect for Inoreader's 100-call/day limit
 * 
 * Endpoints:
 * - POST /api/admin/sync-optimized/all - Sync all categories in 1 call
 * - POST /api/admin/sync-optimized/category - Sync one category in 1 call
 */

import { NextRequest, NextResponse } from 'next/server';
import { Category } from '@/src/lib/model';
import { logger } from '@/src/lib/logger';
import { initializeDatabase } from '@/src/lib/db/index';
import {
  syncAllCategoriesOptimized,
  syncCategoryOptimized,
  syncByLabel,
} from '@/src/lib/sync/inoreader-sync-optimized';

const VALID_CATEGORIES: Category[] = [
  'newsletters',
  'podcasts',
  'tech_articles',
  'ai_news',
  'product_news',
  'community',
  'research',
];

/**
 * POST /api/admin/sync-optimized/all
 * Sync ALL categories with just 1 API call to Inoreader
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const { searchParams } = new URL(req.url);
    const resolvedParams = await params;
    const action = resolvedParams.slug?.[0] || '';

    logger.info(`[SYNC-OPT] Request action: ${action}, slug: ${JSON.stringify(resolvedParams?.slug)}`);

    // Initialize database
    await initializeDatabase();

    // Handle params
    const finalAction = action;

    if (finalAction === 'all') {
      // Sync all categories at once (1 API call)
      logger.info('[SYNC-OPT] Initiating full optimized sync (1 API call)');

      const result = await syncAllCategoriesOptimized();

      logger.info(
        `[SYNC-OPT] Sync complete: ${result.itemsAdded} items, ${result.apiCallsUsed} API call(s)`
      );

      return NextResponse.json({
        success: result.success,
        categoriesProcessed: result.categoriesProcessed,
        itemsAdded: result.itemsAdded,
        errors: result.errors,
        apiCallsUsed: result.apiCallsUsed,
        message: `Synced ${result.itemsAdded} items using only ${result.apiCallsUsed} API call(s)`,
        timestamp: new Date().toISOString(),
      });
    } else if (finalAction === 'category') {
      // Sync single category
      const category = searchParams.get('category') as Category | null;

      if (!category || !VALID_CATEGORIES.includes(category)) {
        return NextResponse.json(
          {
            error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(
              ', '
            )}`,
          },
          { status: 400 }
        );
      }

      logger.info(
        `[SYNC-OPT] Initiating optimized sync for category: ${category} (1 API call)`
      );

      const result = await syncCategoryOptimized(category);

      logger.info(
        `[SYNC-OPT] Synced category: ${category}, added: ${result.itemsAdded} items`
      );

      return NextResponse.json({
        success: true,
        category,
        itemsAdded: result.itemsAdded,
        itemsSkipped: result.itemsSkipped,
        apiCallsUsed: result.apiCallsUsed,
        message: `Synced ${result.itemsAdded} items using only ${result.apiCallsUsed} API call(s)`,
        timestamp: new Date().toISOString(),
      });
    } else if (finalAction === 'label') {
      // Sync by label (useful if you've organized feeds by label in Inoreader)
      const labelId = searchParams.get('labelId');

      if (!labelId) {
        return NextResponse.json(
          { error: 'labelId parameter required' },
          { status: 400 }
        );
      }

      logger.info(`[SYNC-OPT] Syncing from label: ${labelId}`);

      const result = await syncByLabel(labelId);

      return NextResponse.json({
        success: true,
        labelId,
        itemsAdded: result.itemsAdded,
        apiCallsUsed: result.apiCallsUsed,
        message: `Synced ${result.itemsAdded} items from label using ${result.apiCallsUsed} API call(s)`,
        timestamp: new Date().toISOString(),
      });
    } else {
      return NextResponse.json(
        {
          error: 'Invalid endpoint. Use /all, /category, or /label',
          endpoints: [
            'POST /api/admin/sync-optimized/all',
            'POST /api/admin/sync-optimized/category?category=newsletters',
            'POST /api/admin/sync-optimized/label?labelId=user/123/label/Code_Intelligence',
          ],
        },
        { status: 400 }
      );
    }
  } catch (error) {
    logger.error('[SYNC-OPT] Sync failed', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Sync failed',
      },
      { status: 500 }
    );
  }
}
