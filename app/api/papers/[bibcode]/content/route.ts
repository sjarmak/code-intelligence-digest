import { NextRequest, NextResponse } from 'next/server';
import { getPaper, storePaper } from '@/src/lib/db/ads-papers';
import {
  getCachedHtmlContent,
  cacheHtmlContent,
  isCachedHtmlFresh,
  initializeAnnotationTables,
} from '@/src/lib/db/paper-annotations';
import { getBibcodeMetadata, getADSUrl, getArxivUrl } from '@/src/lib/ads/client';
import { fetchPaperContent, extractArxivId } from '@/src/lib/ar5iv';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

// Initialize tables on first import
let tablesInitialized = false;
function ensureTablesInitialized() {
  if (!tablesInitialized) {
    try {
      initializeAnnotationTables();
      tablesInitialized = true;
    } catch (error) {
      logger.warn('Tables may already exist', { error });
      tablesInitialized = true;
    }
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    ensureTablesInitialized();

    const { bibcode: encodedBibcode } = await params;
    const bibcode = decodeURIComponent(encodedBibcode);
    const adsToken = process.env.ADS_API_TOKEN;

    if (!adsToken) {
      return NextResponse.json(
        { error: 'ADS_API_TOKEN not configured' },
        { status: 500 }
      );
    }

    logger.info('Fetching paper content', { bibcode });

    // Check for fresh cached HTML
    if (isCachedHtmlFresh(bibcode)) {
      const cached = getCachedHtmlContent(bibcode);
      if (cached) {
        logger.info('Returning cached HTML content', { bibcode });

        // Get paper metadata for response
        const paper = getPaper(bibcode);

        return NextResponse.json({
          source: 'cached',
          html: cached.htmlContent,
          cachedAt: cached.htmlFetchedAt,
          title: paper?.title,
          authors: paper?.authors ? JSON.parse(paper.authors) : undefined,
          abstract: paper?.abstract,
          bibcode,
          arxivId: extractArxivId(bibcode),
          adsUrl: getADSUrl(bibcode),
          arxivUrl: getArxivUrl(bibcode),
        });
      }
    }

    // Get paper metadata (from cache or ADS)
    let paper = getPaper(bibcode);
    const needsRefresh = !paper || !paper.body;

    if (needsRefresh) {
      logger.info('Fetching paper metadata from ADS', {
        bibcode,
        reason: !paper ? 'not in cache' : 'missing body field'
      });
      const metadata = await getBibcodeMetadata([bibcode], adsToken);
      const paperData = metadata[bibcode];

      if (!paperData) {
        // If we had a cached paper without body, still use it
        if (paper) {
          logger.warn('ADS fetch failed, using cached paper without body', { bibcode });
        } else {
          return NextResponse.json(
            { error: `Paper ${bibcode} not found` },
            { status: 404 }
          );
        }
      } else {
        paper = {
          bibcode,
          title: paperData.title,
          authors: paperData.authors ? JSON.stringify(paperData.authors) : undefined,
          pubdate: paperData.pubdate,
          abstract: paperData.abstract,
          body: paperData.body,
          adsUrl: getADSUrl(bibcode),
          arxivUrl: getArxivUrl(bibcode),
          fulltextSource: paperData.body ? 'ads_api' : undefined,
        };

        storePaper(paper);
        logger.info('Paper stored with body', { bibcode, hasBody: !!paperData.body });
      }
    }

    // At this point paper should never be null
    if (!paper) {
      return NextResponse.json(
        { error: `Paper ${bibcode} not found` },
        { status: 404 }
      );
    }

    // Fetch content (ar5iv with fallbacks)
    const content = await fetchPaperContent(bibcode, {
      adsBody: paper.body,
      abstract: paper.abstract,
      title: paper.title,
      arxivUrl: paper.arxivUrl ?? undefined,
    });

    // Cache the HTML content
    if (content.html && content.source === 'ar5iv') {
      cacheHtmlContent(bibcode, content.html);
    }

    logger.info('Paper content fetched', {
      bibcode,
      source: content.source,
      htmlLength: content.html.length,
      sectionsCount: content.sections.length,
      figuresCount: content.figures.length,
    });

    return NextResponse.json({
      source: content.source,
      html: content.html,
      title: content.title || paper.title,
      authors: content.authors || (paper.authors ? JSON.parse(paper.authors) : undefined),
      abstract: content.abstract || paper.abstract,
      sections: content.sections,
      figures: content.figures,
      tableOfContents: content.tableOfContents,
      bibcode,
      arxivId: extractArxivId(bibcode),
      adsUrl: getADSUrl(bibcode),
      arxivUrl: getArxivUrl(bibcode),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to fetch paper content', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to fetch paper content', details: errorMsg },
      { status: 500 }
    );
  }
}
