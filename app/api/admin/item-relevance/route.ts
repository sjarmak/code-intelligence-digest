/**
 * GET /api/admin/item-relevance?itemId={id}
 * 
 * Get item relevance rating and notes
 * 
 * PATCH /api/admin/item-relevance
 * 
 * Save item relevance rating and notes or star an item
 * Body: { itemId: string, rating?: number | null, notes?: string, starred?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { saveItemRelevance, getItemRelevance, starItem, isItemStarred } from '@/src/lib/db/item-relevance';
import { logger } from '@/src/lib/logger';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const itemId = searchParams.get('itemId');

    if (!itemId) {
      return NextResponse.json(
        { error: 'Item ID is required' },
        { status: 400 }
      );
    }

    const relevance = await getItemRelevance(itemId);
    const starred = await isItemStarred(itemId);

    return NextResponse.json({
      success: true,
      itemId,
      rating: relevance?.rating ?? null,
      notes: relevance?.notes ?? null,
      ratedAt: relevance?.ratedAt ?? null,
      starred: starred ?? false,
    });
  } catch (error) {
    logger.error('[ITEM-RELEVANCE] Failed to get item relevance', error);

    return NextResponse.json(
      {
        error: 'Failed to get item relevance',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json() as {
      itemId: string;
      rating?: number | null;
      notes?: string;
      starred?: boolean;
    };

    const { itemId, rating, notes, starred } = body;

    if (!itemId) {
      return NextResponse.json(
        { error: 'Item ID is required' },
        { status: 400 }
      );
    }

    // Handle starring
    if (starred !== undefined) {
      await starItem(itemId, starred);
      logger.info(`Updated starred status for item: ${itemId} -> ${starred}`);
      return NextResponse.json({
        success: true,
        itemId,
        starred,
      });
    }

    // Handle rating
    if (rating !== undefined) {
      if (rating !== null && (rating < 0 || rating > 3)) {
        return NextResponse.json(
          { error: 'Rating must be between 0 and 3, or null' },
          { status: 400 }
        );
      }

      await saveItemRelevance(itemId, rating, notes);
      logger.info(`Saved item relevance: ${itemId} -> rating: ${rating}`);

      return NextResponse.json({
        success: true,
        itemId,
        rating,
        notes: notes || null,
      });
    }

    return NextResponse.json(
      { error: 'Either rating or starred must be provided' },
      { status: 400 }
    );
  } catch (error) {
    logger.error('[ITEM-RELEVANCE] Failed to save item relevance', error);

    return NextResponse.json(
      {
        error: 'Failed to save item relevance',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
