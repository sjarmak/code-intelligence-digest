/**
 * API route: POST /api/admin/sync
 * Trigger manual sync from Inoreader to database
 * 
 * Endpoints:
 * - POST /api/admin/sync/all - Sync all categories
 * - POST /api/admin/sync/category?category=newsletters - Sync one category
 */

import { NextRequest, NextResponse } from 'next/server';
import { Category } from '@/src/lib/model';
import { logger } from '@/src/lib/logger';
import { initializeDatabase } from '@/src/lib/db/index';
import { syncAllCategories, syncCategory } from '@/src/lib/sync/inoreader-sync';

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
 * POST /api/admin/sync/all
 * Sync all categories from Inoreader
 */
export async function POST(req: NextRequest) {
  try {
    const { pathname } = new URL(req.url);
    const isAllSync = pathname.includes('/all');

    logger.info(`Sync request: ${isAllSync ? 'all categories' : 'specific category'}`);

    // Initialize database
    await initializeDatabase();

    if (isAllSync) {
      // Sync all categories
      const result = await syncAllCategories();

      logger.info(`Sync completed: ${result.itemsAdded} items added`);

      return NextResponse.json({
        success: result.success,
        categoriesProcessed: result.categoriesProcessed,
        itemsAdded: result.itemsAdded,
        errors: result.errors,
        timestamp: new Date().toISOString(),
      });
    } else {
      // Sync specific category
      const { searchParams } = new URL(req.url);
      const category = searchParams.get('category') as Category | null;

      if (!category || !VALID_CATEGORIES.includes(category)) {
        return NextResponse.json(
          {
            error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
          },
          { status: 400 }
        );
      }

      const result = await syncCategory(category);

      logger.info(
        `Synced category: ${category}, added: ${result.itemsAdded} items`
      );

      return NextResponse.json({
        success: true,
        category,
        itemsAdded: result.itemsAdded,
        itemsSkipped: result.itemsSkipped,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logger.error('Sync failed', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Sync failed',
      },
      { status: 500 }
    );
  }
}
