import { NextRequest, NextResponse } from 'next/server';
import {
  getFavoritePapers,
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
 * GET /api/papers/favorites
 * Get all favorite papers
 */
export async function GET(request: NextRequest) {
  try {
    await ensureTablesInitialized();

    const bibcodes = await getFavoritePapers();

    logger.info('Fetched favorite papers', { count: bibcodes.length });

    return NextResponse.json({
      bibcodes,
      count: bibcodes.length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to fetch favorite papers', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to fetch favorite papers' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/papers/favorites
 * Add or remove a paper from favorites
 * Body: { bibcode: string, favorite: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    await ensureTablesInitialized();

    const body = await request.json();
    const { bibcode, favorite } = body;

    if (!bibcode || typeof bibcode !== 'string') {
      return NextResponse.json(
        { error: 'bibcode is required and must be a string' },
        { status: 400 }
      );
    }

    if (typeof favorite !== 'boolean') {
      return NextResponse.json(
        { error: 'favorite must be a boolean' },
        { status: 400 }
      );
    }

    const success = favorite
      ? await markPaperAsFavorite(bibcode)
      : await unmarkPaperAsFavorite(bibcode);

    if (!success) {
      return NextResponse.json(
        { error: `Failed to ${favorite ? 'add' : 'remove'} paper from favorites` },
        { status: 500 }
      );
    }

    logger.info(`Paper ${favorite ? 'added to' : 'removed from'} favorites`, { bibcode });

    return NextResponse.json({
      bibcode,
      favorite,
      success: true,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to update favorite status', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to update favorite status' },
      { status: 500 }
    );
  }
}

