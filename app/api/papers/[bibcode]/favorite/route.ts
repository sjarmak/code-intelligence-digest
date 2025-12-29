import { NextRequest, NextResponse } from 'next/server';
import {
  markPaperAsFavorite,
  unmarkPaperAsFavorite,
  isPaperFavorite,
  initializeAnnotationTables,
} from '@/src/lib/db/paper-annotations';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

// Initialize tables on first import
let tablesInitialized = false;
async function ensureTablesInitialized() {
  if (!tablesInitialized) {
    try {
      await initializeAnnotationTables();
      tablesInitialized = true;
    } catch (error) {
      logger.warn('Tables may already exist', { error });
      tablesInitialized = true;
    }
  }
}

/**
 * GET /api/papers/[bibcode]/favorite
 * Check if a paper is favorited
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    await ensureTablesInitialized();

    const { bibcode: encodedBibcode } = await params;
    let bibcode: string;
    try {
      bibcode = decodeURIComponent(encodedBibcode);
    } catch (error) {
      bibcode = encodedBibcode;
      logger.warn('Bibcode decoding failed in favorite GET', { encodedBibcode });
    }

    const isFavorite = await isPaperFavorite(bibcode);

    return NextResponse.json({
      bibcode,
      isFavorite,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to check favorite status', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to check favorite status' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/papers/[bibcode]/favorite
 * Mark a paper as favorite
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    await ensureTablesInitialized();

    const { bibcode: encodedBibcode } = await params;
    let bibcode: string;
    try {
      bibcode = decodeURIComponent(encodedBibcode);
    } catch (error) {
      bibcode = encodedBibcode;
      logger.warn('Bibcode decoding failed in favorite POST', { encodedBibcode });
    }

    const success = await markPaperAsFavorite(bibcode);

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to mark paper as favorite' },
        { status: 500 }
      );
    }

    logger.info('Paper marked as favorite', { bibcode });

    return NextResponse.json({
      success: true,
      bibcode,
      isFavorite: true,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to mark paper as favorite', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to mark paper as favorite' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/papers/[bibcode]/favorite
 * Unmark a paper as favorite
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    await ensureTablesInitialized();

    const { bibcode: encodedBibcode } = await params;
    let bibcode: string;
    try {
      bibcode = decodeURIComponent(encodedBibcode);
    } catch (error) {
      bibcode = encodedBibcode;
      logger.warn('Bibcode decoding failed in favorite DELETE', { encodedBibcode });
    }

    const success = await unmarkPaperAsFavorite(bibcode);

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to unmark paper as favorite' },
        { status: 500 }
      );
    }

    logger.info('Paper unmarked as favorite', { bibcode });

    return NextResponse.json({
      success: true,
      bibcode,
      isFavorite: false,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to unmark paper as favorite', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to unmark paper as favorite' },
      { status: 500 }
    );
  }
}

