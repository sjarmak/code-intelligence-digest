/**
 * PATCH /api/admin/item-relevance
 * 
 * Save item relevance rating and notes
 * Body: { itemId: string, rating: number | null, notes?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { saveItemRelevance } from '@/src/lib/db/item-relevance';
import { logger } from '@/src/lib/logger';

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json() as {
      itemId: string;
      rating: number | null;
      notes?: string;
    };

    const { itemId, rating, notes } = body;

    if (!itemId) {
      return NextResponse.json(
        { error: 'Item ID is required' },
        { status: 400 }
      );
    }

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
