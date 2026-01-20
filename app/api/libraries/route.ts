import { NextRequest, NextResponse } from 'next/server';
import {
  listLibraries,
  getLibraryByName,
  getLibraryItems,
  getBibcodeMetadata,
  getADSUrl,
  getArxivUrl,
} from '@/src/lib/ads/client';
import { logger } from '@/src/lib/logger';
import { initializeDatabase } from '@/src/lib/db/index';
import {
  storePapersBatch,
  linkPapersToLibraryBatch,
  initializeADSTables,
} from '@/src/lib/db/ads-papers';
import type { FeedItem } from '@/src/lib/model';
import { saveItems } from '@/src/lib/db/items';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const token = process.env.ADS_API_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: 'ADS_API_TOKEN not configured' },
        { status: 500 },
      );
    }

    // Ensure database tables exist before we try to cache anything
    await initializeDatabase();

    const { searchParams } = new URL(request.url);
    const libraryName = searchParams.get('library') || 'Benchmarks';
    const rows = parseInt(searchParams.get('rows') || '20', 10);
    const start = parseInt(searchParams.get('start') || '0', 10);
    const includeMetadata = searchParams.get('metadata') === 'true';

    logger.info('Fetching library items', { libraryName, rows, start });

    // Reject blocked libraries (SciX, etc.)
    if (libraryName.toLowerCase().includes('scix') || libraryName.toLowerCase().includes('2024 bibliography')) {
      return NextResponse.json(
        { error: `Library "${libraryName}" is not available` },
        { status: 404 },
      );
    }

    // Get library by name
    const library = await getLibraryByName(libraryName, token);
    if (!library) {
      return NextResponse.json(
        { error: `Library "${libraryName}" not found` },
        { status: 404 },
      );
    }

    // Fetch items (bibcodes)
    const bibcodes = await getLibraryItems(library.id, token, {
      start,
      rows,
    });

    // Optionally fetch detailed metadata
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let items: any[] = bibcodes.map((bibcode) => ({
      bibcode,
      title: undefined,
    }));

    if (includeMetadata && bibcodes.length > 0) {
      const metadata = await getBibcodeMetadata(bibcodes, token);

      // Initialize ADS tables if needed
      try {
        await initializeADSTables();
      } catch {
        // Tables may already exist, safe to ignore
      }

      // Prepare papers for storage
      const papersToStore = bibcodes
        .map((bibcode) => ({
          bibcode,
          title: metadata[bibcode]?.title,
          authors: metadata[bibcode]?.authors
            ? JSON.stringify(metadata[bibcode].authors)
            : undefined,
          pubdate: metadata[bibcode]?.pubdate,
          abstract: metadata[bibcode]?.abstract,
          body: metadata[bibcode]?.body, // Full text from ADS API
          adsUrl: getADSUrl(bibcode),
          arxivUrl: getArxivUrl(bibcode),
          fulltextSource: metadata[bibcode]?.body ? 'ads_api' : undefined,
        }))
        .filter(
          (p) =>
            p.title ||
            p.authors ||
            p.pubdate ||
            p.abstract ||
            p.body,
        );

      // Store papers in database
      if (papersToStore.length > 0) {
        try {
          await storePapersBatch(papersToStore);
          await linkPapersToLibraryBatch(library.id, bibcodes);

          // Also save to items table for consistency
          // Convert papers to FeedItems and save
          const itemsToSave: FeedItem[] = papersToStore
            .filter(p => p.title || p.body) // Only save if we have title or body
            .map(paper => {
              // Parse authors
              let author: string | undefined;
              if (paper.authors) {
                try {
                  const authorsArray = JSON.parse(paper.authors);
                  author = Array.isArray(authorsArray) ? authorsArray.join(', ') : authorsArray;
                } catch {
                  author = paper.authors;
                }
              }

              // Parse pubdate
              let publishedAt: Date;
              if (paper.pubdate) {
                publishedAt = new Date(paper.pubdate);
                if (isNaN(publishedAt.getTime())) {
                  publishedAt = new Date();
                }
              } else {
                publishedAt = new Date();
              }

              const itemId = `ads:${paper.bibcode}`;
              const url = paper.arxivUrl || paper.adsUrl || getADSUrl(paper.bibcode);

              return {
                id: itemId,
                streamId: `ads:research:${paper.bibcode}`,
                sourceTitle: 'ADS Research',
                title: paper.title || 'Untitled',
                url,
                author,
                publishedAt,
                createdAt: publishedAt,
                summary: paper.abstract || undefined,
                contentSnippet: paper.abstract || undefined,
                fullText: paper.body || undefined,
                categories: ['research'],
                category: 'research' as const,
                raw: {
                  bibcode: paper.bibcode,
                  adsUrl: paper.adsUrl || getADSUrl(paper.bibcode),
                  arxivUrl: paper.arxivUrl || getArxivUrl(paper.bibcode),
                },
              };
            });

          if (itemsToSave.length > 0) {
            await saveItems(itemsToSave);
            logger.info(`[LIBRARIES] Saved ${itemsToSave.length} items to items table`);
          }
        } catch (dbError) {
          logger.error('Failed to cache ADS library items locally', {
            libraryId: library.id,
            error: dbError instanceof Error ? dbError.message : String(dbError),
          });
        }
      }

      items = bibcodes.map((bibcode) => ({
        bibcode,
        title: metadata[bibcode]?.title,
        authors: metadata[bibcode]?.authors,
        pubdate: metadata[bibcode]?.pubdate,
        abstract: metadata[bibcode]?.abstract,
        adsUrl: getADSUrl(bibcode),
        arxivUrl: getArxivUrl(bibcode),
      }));
    } else {
      // Even without metadata, provide URLs
      items = bibcodes.map((bibcode) => ({
        bibcode,
        adsUrl: getADSUrl(bibcode),
        arxivUrl: getArxivUrl(bibcode),
      }));
    }

    return NextResponse.json({
      library: {
        id: library.id,
        name: library.name,
        numPapers: library.num_documents,
      },
      items,
      pagination: {
        start,
        rows,
        total: library.num_documents,
        hasMore: start + rows < library.num_documents,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch library items';
    logger.error('Failed to fetch library items', {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

/**
 * List all available libraries
 * Filters out SciX 2024 Bibliography and other unwanted collections
 */
export async function POST() {
  try {
    const token = process.env.ADS_API_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: 'ADS_API_TOKEN not configured' },
        { status: 500 },
      );
    }

    await initializeDatabase();

    logger.info('Fetching all libraries');
    const libraries = await listLibraries(token);

    // Filter out SciX 2024 and other unwanted libraries
    const filteredLibraries = libraries.filter(
      (lib) => !lib.name.toLowerCase().includes('scix') && !lib.name.toLowerCase().includes('2024 bibliography')
    );

    return NextResponse.json({
      libraries: filteredLibraries.map((lib) => ({
        id: lib.id,
        name: lib.name,
        description: lib.description,
        numPapers: lib.num_documents,
        public: lib.public,
      })),
    });
  } catch (error) {
    logger.error('Failed to fetch libraries', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to fetch libraries' },
      { status: 500 },
    );
  }
}
