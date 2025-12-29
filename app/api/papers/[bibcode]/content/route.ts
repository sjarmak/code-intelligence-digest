import { NextRequest, NextResponse } from 'next/server';
import { getPaper, storePaper } from '@/src/lib/db/ads-papers';
import {
  getCachedHtmlContent,
  cacheHtmlContent,
  isCachedHtmlFresh,
  initializeAnnotationTables,
} from '@/src/lib/db/paper-annotations';
import { getBibcodeMetadata, getADSUrl, getArxivUrl } from '@/src/lib/ads/client';
import { fetchPaperContent, extractArxivId, parseAr5ivHtml } from '@/src/lib/ar5iv';
import { getSectionSummaries } from '@/src/lib/db/paper-sections';
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
      await ensureTablesInitialized();

    const { bibcode: encodedBibcode } = await params;

    // Check for force refresh parameter
    const searchParams = request.nextUrl.searchParams;
    const forceRefresh = searchParams.get('refresh') === 'true';
    // Handle URL encoding - decodeURIComponent handles %2F and other encoded characters
    // If decoding fails, try using the raw value (might already be decoded by Next.js)
    let bibcode: string;
    try {
      bibcode = decodeURIComponent(encodedBibcode);
    } catch (error) {
      // If decoding fails, the bibcode might already be decoded or contain invalid encoding
      // Try using it as-is, but log a warning
      bibcode = encodedBibcode;
      logger.warn('Bibcode decoding failed, using raw value', {
        encodedBibcode,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Log the bibcode for debugging
    logger.info('Paper content request', {
      encodedBibcode,
      decodedBibcode: bibcode,
      containsSlash: bibcode.includes('/'),
      containsPercent: bibcode.includes('%'),
    });

    const adsToken = process.env.ADS_API_TOKEN;

    if (!adsToken) {
      return NextResponse.json(
        { error: 'ADS_API_TOKEN not configured' },
        { status: 500 }
      );
    }

    logger.info('Fetching paper content', { bibcode });

    // Check for fresh cached HTML (skip if force refresh)
    if (!forceRefresh && isCachedHtmlFresh(bibcode)) {
      const cached = getCachedHtmlContent(bibcode);
      if (cached) {
        logger.info('Returning cached HTML content', {
          bibcode,
          hasSections: !!cached.sections && cached.sections.length > 0,
          hasFigures: !!cached.figures && cached.figures.length > 0,
        });

        // Get paper metadata for response
        const paper = getPaper(bibcode);

        // Use cached sections/figures if available, otherwise try to parse
        let sections = cached.sections || [];
        let figures = cached.figures || [];
        // Use sections as tableOfContents if available
        let tableOfContents = cached.sections && cached.sections.length > 0 ? cached.sections : [];

        // Rewrite image URLs in cached HTML to absolute paths
        // This fixes images that were cached before the URL rewrite fix
        let htmlContent = cached.htmlContent;
        const htmlLower = htmlContent.toLowerCase();
        const isArxivHtml = htmlLower.includes('arxiv.org/html/') && !htmlLower.includes('arxiv.org/abs/');
        const imageBaseUrl = isArxivHtml ? 'https://arxiv.org' : 'https://ar5iv.org';

        // Rewrite relative image URLs to absolute URLs
        // Handle all possible src formats: src="...", src='...', src=..., and src without quotes
        // Also handle cases where src might come before or after other attributes
        htmlContent = htmlContent.replace(
          /<img\s+([^>]*?)>/gi,
          (match, attributes) => {
            // Try to find src in various formats
            let srcMatch = attributes.match(/\ssrc\s*=\s*"([^"]+)"/i) ||
                          attributes.match(/\ssrc\s*=\s*'([^']+)'/i) ||
                          attributes.match(/\ssrc\s*=\s*([^\s>]+)/i) ||
                          attributes.match(/src\s*=\s*"([^"]+)"/i) ||
                          attributes.match(/src\s*=\s*'([^']+)'/i) ||
                          attributes.match(/src\s*=\s*([^\s>]+)/i);

            if (!srcMatch || !srcMatch[1]) {
              return match; // No src found, return as-is
            }

            const src = srcMatch[1];

            // Only rewrite if it's a relative URL
            if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:') && !src.startsWith('//')) {
              const normalizedSrc = src.startsWith('/')
                ? `${imageBaseUrl}${src}`
                : `${imageBaseUrl}/${src}`;

              // Replace the src in the attributes
              const updatedAttributes = attributes.replace(
                srcMatch[0],
                srcMatch[0].replace(src, normalizedSrc)
              );

              return `<img ${updatedAttributes}>`;
            }
            return match; // Already absolute or data URL
          }
        );

        // Also handle background-image URLs in style attributes
        htmlContent = htmlContent.replace(
          /style=["']([^"']*background[^"']*url\(["']?([^"')]+)["']?\)[^"']*)["']/gi,
          (match, styleContent, url) => {
            if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:') && !url.startsWith('//')) {
              const normalizedUrl = url.startsWith('/')
                ? `${imageBaseUrl}${url}`
                : `${imageBaseUrl}/${url}`;
              return `style="${styleContent.replace(url, normalizedUrl)}"`;
            }
            return match;
          }
        );

        // If sections weren't cached, try to parse from HTML (fallback for old cache entries)
        if (sections.length === 0) {
          try {
            if (htmlLower.includes('<!doctype') && htmlLower.includes('ar5iv.org')) {
              // Raw ar5iv HTML - parse it
              logger.info('Parsing raw ar5iv HTML from cache (sections not cached)', { bibcode });
              const parsed = parseAr5ivHtml(cached.htmlContent);
              sections = parsed.sections;
              figures = parsed.figures;
              tableOfContents = parsed.tableOfContents;
            }
          } catch (error) {
            logger.warn('Failed to parse cached HTML for sections', {
              bibcode,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Determine the original source from the HTML content
        // Cached content could be from ar5iv, arxiv, ads, or abstract
        // (htmlLower already declared above)
        let originalSource: 'ar5iv' | 'arxiv' | 'ads' | 'abstract' = 'abstract';
        if (htmlLower.includes('arxiv.org/html/') && !htmlLower.includes('arxiv.org/abs/')) {
          originalSource = 'arxiv';
        } else if (htmlLower.includes('ltx_') || (htmlLower.includes('paper-reader-content') && htmlLower.length > 10000)) {
          originalSource = 'ar5iv';
        } else if (htmlLower.includes('paper-reader-ads')) {
          originalSource = 'ads';
        }

        // Get section summaries if available
        let sectionSummaries: Array<{
          sectionId: string;
          sectionTitle: string;
          level: number;
          summary: string;
          charStart: number;
          charEnd: number;
        }> = [];
        try {
          const summaries = await getSectionSummaries(bibcode);
          logger.info('Fetched section summaries', {
            bibcode,
            count: summaries.length,
            sectionTitles: summaries.map(s => s.sectionTitle),
          });
          sectionSummaries = summaries.map((s) => ({
            sectionId: s.sectionId,
            sectionTitle: s.sectionTitle,
            level: s.level,
            summary: s.summary,
            charStart: s.charStart,
            charEnd: s.charEnd,
          }));
        } catch (error) {
          logger.warn('Failed to fetch section summaries', {
            bibcode,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        return NextResponse.json({
          source: originalSource, // Return original source, not 'cached'
          html: htmlContent, // Use rewritten HTML with absolute image URLs
          cachedAt: cached.htmlFetchedAt,
          title: paper?.title,
          authors: paper?.authors ? JSON.parse(paper.authors) : undefined,
          abstract: paper?.abstract,
          sections,
          figures,
          tableOfContents,
          sectionSummaries, // Include section summaries
          bibcode,
          arxivId: extractArxivId(bibcode),
          adsUrl: getADSUrl(bibcode),
          arxivUrl: getArxivUrl(bibcode),
        });
      }
    }

    // Get paper metadata (from cache or ADS)
    let paper = getPaper(bibcode);
    // Refresh if paper doesn't exist, has no body, or body is suspiciously short (likely invalid)
    const needsRefresh = !paper || !paper.body || (paper.body && paper.body.length < 100);

    if (needsRefresh) {
      logger.info('Fetching paper metadata from ADS', {
        bibcode,
        reason: !paper ? 'not in cache' : 'missing body field',
        hasCachedPaper: !!paper,
      });

      try {
        const metadata = await getBibcodeMetadata([bibcode], adsToken);
        const paperData = metadata[bibcode];

        if (!paperData) {
          // If we had a cached paper without body, still use it
          if (paper) {
            logger.warn('ADS fetch returned no data, using cached paper without body', {
              bibcode,
              cachedTitle: paper.title,
            });
          } else {
            logger.error('Paper not found in ADS API', { bibcode });
            return NextResponse.json(
              { error: `Paper ${bibcode} not found in ADS` },
              { status: 404 }
            );
          }
        } else {
          // Log what we got from ADS
          logger.info('ADS metadata received', {
            bibcode,
            hasTitle: !!paperData.title,
            hasAbstract: !!paperData.abstract,
            hasBody: !!paperData.body,
            bodyLength: paperData.body?.length || 0,
          });

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

          await storePaper(paper);
          logger.info('Paper stored', {
            bibcode,
            hasBody: !!paperData.body,
            hasAbstract: !!paperData.abstract,
            fulltextSource: paper.fulltextSource,
          });
        }
      } catch (error) {
        logger.error('Failed to fetch paper metadata from ADS', {
          bibcode,
          error: error instanceof Error ? error.message : String(error),
        });

        // If we have a cached paper, use it even if ADS fetch failed
        if (paper) {
          logger.warn('Using cached paper after ADS fetch failure', { bibcode });
        } else {
          return NextResponse.json(
            { error: `Failed to fetch paper ${bibcode}: ${error instanceof Error ? error.message : String(error)}` },
            { status: 500 }
          );
        }
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
    logger.info('Fetching paper content', {
      bibcode,
      hasAdsBody: !!paper.body,
      bodyLength: paper.body?.length || 0,
      hasAbstract: !!paper.abstract,
      arxivUrl: paper.arxivUrl,
    });

    // Check if we have section summaries - if so, we should regenerate HTML to match section IDs
    const { getSectionSummaries } = await import('@/src/lib/db/paper-sections');
    const existingSummaries = await getSectionSummaries(bibcode);
    const shouldRegenerateHtml = existingSummaries.length > 0 && 
      !isCachedHtmlFresh(bibcode) || // Cache is stale
      forceRefresh; // Force refresh requested

    let content;
    try {
      // If we have section summaries but HTML is stale, regenerate it
      if (shouldRegenerateHtml && paper.body && paper.body.length > 100) {
        logger.info('Regenerating HTML to match section summaries', { 
          bibcode, 
          summaryCount: existingSummaries.length 
        });
        // Use adsBodyToHtml directly to ensure section IDs match
        const { adsBodyToHtml } = await import('@/src/lib/ar5iv');
        content = adsBodyToHtml(paper.body, paper.abstract);
      } else {
        content = await fetchPaperContent(bibcode, {
          adsBody: paper.body,
          abstract: paper.abstract,
          title: paper.title,
          arxivUrl: paper.arxivUrl ?? undefined,
        });
      }
    } catch (error) {
      logger.error('Failed to fetch paper content', {
        bibcode,
        error: error instanceof Error ? error.message : String(error),
        hasAdsBody: !!paper.body,
        hasAbstract: !!paper.abstract,
      });

      // Prefer ADS body over abstract if available
      if (paper.body && paper.body.length > 100) {
        logger.warn('Using ADS body after fetchPaperContent failed', { 
          bibcode,
          bodyLength: paper.body.length,
          hasAbstract: !!paper.abstract
        });
        const { adsBodyToHtml } = await import('@/src/lib/ar5iv');
        content = adsBodyToHtml(paper.body, paper.abstract);
      } else if (paper.abstract) {
        logger.warn('Falling back to abstract-only content - no body available', { 
          bibcode,
          hasBody: !!paper.body,
          bodyLength: paper.body?.length || 0
        });
        const { abstractToHtml } = await import('@/src/lib/ar5iv');
        content = abstractToHtml(paper.abstract, paper.title);
      } else {
        throw error;
      }
    }

    // Cache the HTML content along with sections and figures
    // Cache ar5iv, arxiv, and ads sources (but not abstract-only)
    if (content.html && (content.source === 'ar5iv' || content.source === 'arxiv' || content.source === 'ads')) {
      cacheHtmlContent(bibcode, content.html, content.sections, content.figures);
    }

    logger.info('Paper content fetched', {
      bibcode,
      source: content.source,
      htmlLength: content.html.length,
      sectionsCount: content.sections.length,
      figuresCount: content.figures.length,
    });

    // Get section summaries if available
    let sectionSummaries: Array<{
      sectionId: string;
      sectionTitle: string;
      level: number;
      summary: string;
      charStart: number;
      charEnd: number;
    }> = [];
    try {
      const summaries = await getSectionSummaries(bibcode);
      logger.info('Fetched section summaries', {
        bibcode,
        count: summaries.length,
        sectionTitles: summaries.map(s => s.sectionTitle),
      });
      sectionSummaries = summaries.map((s) => ({
        sectionId: s.sectionId,
        sectionTitle: s.sectionTitle,
        level: s.level,
        summary: s.summary,
        charStart: s.charStart,
        charEnd: s.charEnd,
      }));

      // If no sections exist but paper has body, trigger processing in background
      if (sectionSummaries.length === 0 && paper.body && paper.body.length >= 100) {
        logger.info('No section summaries found, triggering background processing', { bibcode });
        // Trigger processing asynchronously (don't wait)
        import('@/src/lib/pipeline/section-summarization').then(({ processPaperSections }) => {
          processPaperSections(paper.bibcode).catch((err) => {
            logger.warn('Background section processing failed', {
              bibcode,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        });
      }
    } catch (error) {
      logger.warn('Failed to fetch section summaries', {
        bibcode,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Ensure tableOfContents is populated from sections if available
    // Use tableOfContents from parsed content, or fall back to sections
    const tableOfContents = content.tableOfContents && content.tableOfContents.length > 0
      ? content.tableOfContents
      : content.sections && content.sections.length > 0
      ? content.sections
      : [];

    return NextResponse.json({
      source: content.source,
      html: content.html,
      title: content.title || paper.title,
      authors: content.authors || (paper.authors ? JSON.parse(paper.authors) : undefined),
      abstract: content.abstract || paper.abstract,
      sections: content.sections,
      figures: content.figures,
      tableOfContents, // Use sections as fallback if tableOfContents is empty
      sectionSummaries, // Include section summaries
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
