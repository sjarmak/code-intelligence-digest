import { NextRequest, NextResponse } from 'next/server';
import {
  getFavoritePapers,
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

