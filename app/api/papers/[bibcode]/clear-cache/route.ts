import { NextRequest, NextResponse } from 'next/server';
import { getDbClient, detectDriver } from '@/src/lib/db/driver';
import { getSqlite } from '@/src/lib/db/index';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/papers/[bibcode]/clear-cache
 * Clear cached HTML content for a paper to force re-fetch
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    const { bibcode: encodedBibcode } = await params;
    let bibcode: string;
    try {
      bibcode = decodeURIComponent(encodedBibcode);
    } catch (error) {
      bibcode = encodedBibcode;
      logger.warn('Bibcode decoding failed in clear-cache', { encodedBibcode });
    }

    const driver = detectDriver();
    const now = Math.floor(Date.now() / 1000);

    if (driver === 'postgres') {
      const client = await getDbClient();
      await client.run(`
        UPDATE ads_papers
        SET html_content = NULL, html_fetched_at = NULL, html_sections = NULL, html_figures = NULL, updated_at = $1
        WHERE bibcode = $2
      `, [now, bibcode]);
    } else {
      const db = getSqlite();
      db.prepare(`
        UPDATE ads_papers
        SET html_content = NULL, html_fetched_at = NULL, html_sections = NULL, html_figures = NULL, updated_at = ?
        WHERE bibcode = ?
      `).run(now, bibcode);
    }

    logger.info('Cleared HTML cache for paper', { bibcode });

    return NextResponse.json({
      success: true,
      bibcode,
      message: 'Cache cleared successfully',
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to clear cache', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to clear cache' },
      { status: 500 }
    );
  }
}


