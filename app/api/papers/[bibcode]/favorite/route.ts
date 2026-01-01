import { NextRequest, NextResponse } from 'next/server';
import {
  markPaperAsFavorite,
  unmarkPaperAsFavorite,
  isPaperFavorite,
  initializeAnnotationTables,
} from '@/src/lib/db/paper-annotations';
import { initializeADSTables } from '@/src/lib/db/ads-papers';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

// Initialize tables on first import
let tablesInitialized = false;
async function ensureTablesInitialized() {
  if (!tablesInitialized) {
    try {
      // Ensure ads_papers table exists first
      initializeADSTables();
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

    // Fetch and store paper metadata if it doesn't exist yet
    const { getPaper, storePaper } = await import('@/src/lib/db/ads-papers');
    const paper = await getPaper(bibcode);

    // If paper exists but doesn't have title/metadata, fetch it from ADS API
    if (paper && (!paper.title || !paper.abstract)) {
      try {
        const { getBibcodeMetadata, getADSUrl, getArxivUrl } = await import('@/src/lib/ads/client');
        const token = process.env.ADS_API_TOKEN;
        if (token) {
          const metadata = await getBibcodeMetadata([bibcode], token);
          const paperMeta = metadata[bibcode];
          if (paperMeta) {
            // Update paper with metadata
            await storePaper({
              bibcode,
              title: paperMeta.title?.[0] || paper.title,
              authors: paperMeta.author ? JSON.stringify(paperMeta.author) : paper.authors,
              pubdate: paperMeta.pubdate || paper.pubdate,
              abstract: paperMeta.abstract || paper.abstract,
              body: paperMeta.body || paper.body,
              adsUrl: getADSUrl(bibcode),
              arxivUrl: getArxivUrl(bibcode),
              fulltextSource: paperMeta.body ? 'ads_api' : paper.fulltextSource,
            });
            logger.info('Fetched and stored paper metadata after favoriting', { bibcode });
          }
        }
      } catch (error) {
        logger.warn('Failed to fetch paper metadata after favoriting', {
          bibcode,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Trigger section processing in background if paper has body text
    if (paper && paper.body && paper.body.length >= 100) {
      // Process sections asynchronously (don't wait)
      import('@/src/lib/pipeline/section-summarization').then(({ processPaperSections }) => {
        processPaperSections(bibcode).catch((err) => {
          logger.warn('Background section processing failed after favoriting', {
            bibcode,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });
    }

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

