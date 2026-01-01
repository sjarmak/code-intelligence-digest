import { NextRequest, NextResponse } from 'next/server';
import { getPaper, storePaper } from '@/src/lib/db/ads-papers';
import { getBibcodeMetadata, getADSUrl, getArxivUrl } from '@/src/lib/ads/client';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/papers/[bibcode]
 * Get paper metadata (title, authors, etc.) from database
 * If paper doesn't have metadata, fetch it from ADS API
 */
export async function GET(
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
      logger.warn('Bibcode decoding failed', { encodedBibcode });
    }

    let paper = await getPaper(bibcode);

    // If paper doesn't exist or doesn't have title/metadata, fetch from ADS API
    if (!paper || !paper.title) {
      const token = process.env.ADS_API_TOKEN;
      if (token) {
        try {
          const metadata = await getBibcodeMetadata([bibcode], token);
          const paperMeta = metadata[bibcode];
          if (paperMeta) {
            // Store paper with metadata
            await storePaper({
              bibcode,
              title: paperMeta.title?.[0],
              authors: paperMeta.authors ? JSON.stringify(paperMeta.authors) : undefined,
              pubdate: paperMeta.pubdate,
              abstract: paperMeta.abstract,
              body: paperMeta.body,
              adsUrl: getADSUrl(bibcode),
              arxivUrl: getArxivUrl(bibcode),
              fulltextSource: paperMeta.body ? 'ads_api' : undefined,
            });
            // Re-fetch the paper
            paper = await getPaper(bibcode);
            logger.info('Fetched and stored paper metadata', { bibcode });
          }
        } catch (error) {
          logger.warn('Failed to fetch paper metadata from ADS API', {
            bibcode,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (!paper) {
      return NextResponse.json(
        { error: 'Paper not found' },
        { status: 404 }
      );
    }

    // Parse authors JSON if present
    let authors: string[] | undefined;
    if (paper.authors) {
      try {
        authors = JSON.parse(paper.authors);
      } catch (error) {
        // If parsing fails, treat as single author string
        authors = [paper.authors];
      }
    }

    return NextResponse.json({
      bibcode: paper.bibcode,
      title: paper.title,
      authors,
      pubdate: paper.pubdate,
      abstract: paper.abstract,
      adsUrl: paper.adsUrl || getADSUrl(bibcode),
      arxivUrl: paper.arxivUrl || getArxivUrl(bibcode),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to fetch paper', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to fetch paper' },
      { status: 500 }
    );
  }
}

