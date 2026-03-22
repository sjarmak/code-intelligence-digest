/**
 * ADS papers database operations
 * Handles storing and retrieving paper metadata and full text from local database
 */

import { getDbClient } from "./driver";
import { logger } from '../logger';

export interface ADSPaperRecord {
  bibcode: string;
  title?: string;
  authors?: string; // JSON stringified array
  pubdate?: string;
  abstract?: string;
  body?: string; // Full text content
  year?: number;
  journal?: string;
  adsUrl?: string;
  arxivUrl?: string | null;
  fulltextSource?: string; // Where full text came from (e.g., "ads_api")
}

export interface ADSPaperSearchResult {
  papers: ADSPaperRecord[];
  total: number;
}

/**
 * Initialize ADS tables in database (PostgreSQL)
 */
export async function initializeADSTables() {

  try {
    

      const client = await getDbClient();

      // Create ads_papers table
      await client.exec(`
        CREATE TABLE IF NOT EXISTS ads_papers (
          bibcode TEXT PRIMARY KEY,
          title TEXT,
          authors TEXT,
          pubdate TEXT,
          abstract TEXT,
          body TEXT,
          year INTEGER,
          journal TEXT,
          ads_url TEXT,
          arxiv_url TEXT,
          fulltext_source TEXT,
          html_content TEXT,
          html_fetched_at INTEGER,
          html_sections TEXT,
          html_figures TEXT,
          paper_notes TEXT,
          is_favorite INTEGER DEFAULT 0,
          favorited_at INTEGER,
          fetched_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
          created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
          updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
        );
      `);

      // Create ads_library_papers junction table
      await client.exec(`
        CREATE TABLE IF NOT EXISTS ads_library_papers (
          library_id TEXT NOT NULL,
          bibcode TEXT NOT NULL,
          added_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
          PRIMARY KEY (library_id, bibcode),
          FOREIGN KEY (bibcode) REFERENCES ads_papers(bibcode) ON DELETE CASCADE
        );
      `);

      // Create ads_libraries cache table
      await client.exec(`
        CREATE TABLE IF NOT EXISTS ads_libraries (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          num_documents INTEGER NOT NULL DEFAULT 0,
          is_public INTEGER NOT NULL DEFAULT 0,
          fetched_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
          created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
          updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
        );
      `);

      // Create indexes
      await client.exec(`
        CREATE INDEX IF NOT EXISTS idx_ads_papers_year ON ads_papers(year);
        CREATE INDEX IF NOT EXISTS idx_ads_papers_journal ON ads_papers(journal);
        CREATE INDEX IF NOT EXISTS idx_ads_library_papers_library ON ads_library_papers(library_id);
        CREATE INDEX IF NOT EXISTS idx_ads_library_papers_bibcode ON ads_library_papers(bibcode);
        CREATE INDEX IF NOT EXISTS idx_ads_papers_search
          ON ads_papers
          USING GIN (to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(abstract, '') || ' ' || COALESCE(authors, '')));
      `);

      logger.info('ADS database tables initialized (PostgreSQL)');
    

  } catch (error) {
    logger.error('Failed to initialize ADS tables', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Store or update a paper in the database
 */
export async function storePaper(paper: ADSPaperRecord): Promise<void> {
  const year = paper.year || (paper.pubdate ? parseInt(paper.pubdate.substring(0, 4), 10) : undefined);

  // Sanitize text fields to remove null bytes (required for PostgreSQL)
  const sanitizedPaper: ADSPaperRecord = {
    ...paper,
    title: sanitizeText(paper.title) || undefined,
    authors: sanitizeText(paper.authors) || undefined,
    pubdate: sanitizeText(paper.pubdate) || undefined,
    abstract: sanitizeText(paper.abstract) || undefined,
    body: sanitizeText(paper.body) || undefined,
    journal: sanitizeText(paper.journal) || undefined,
    adsUrl: sanitizeText(paper.adsUrl) || undefined,
    arxivUrl: sanitizeText(paper.arxivUrl) || undefined,
    fulltextSource: sanitizeText(paper.fulltextSource) || undefined,
  };

  try {
    

      const client = await getDbClient();
      const now = Math.floor(Date.now() / 1000);
      await client.run(
        `INSERT INTO ads_papers (
          bibcode, title, authors, pubdate, abstract, body,
          year, journal, ads_url, arxiv_url, fulltext_source, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT(bibcode) DO UPDATE SET
          title = EXCLUDED.title,
          authors = EXCLUDED.authors,
          pubdate = EXCLUDED.pubdate,
          abstract = EXCLUDED.abstract,
          body = COALESCE(EXCLUDED.body, ads_papers.body),
          year = COALESCE(EXCLUDED.year, ads_papers.year),
          journal = EXCLUDED.journal,
          ads_url = EXCLUDED.ads_url,
          arxiv_url = EXCLUDED.arxiv_url,
          fulltext_source = COALESCE(EXCLUDED.fulltext_source, ads_papers.fulltext_source),
          updated_at = $12`,
        [
          sanitizedPaper.bibcode,
          sanitizedPaper.title || null,
          sanitizedPaper.authors || null,
          sanitizedPaper.pubdate || null,
          sanitizedPaper.abstract || null,
          sanitizedPaper.body || null,
          year || null,
          sanitizedPaper.journal || null,
          sanitizedPaper.adsUrl || null,
          sanitizedPaper.arxivUrl || null,
          sanitizedPaper.fulltextSource || null,
          now,
        ]
      );
    


    logger.info('Paper stored in database', { bibcode: paper.bibcode });

    // Automatically process sections if body text is available
    // Do this asynchronously to avoid blocking the store operation
    if (paper.body && paper.body.length >= 100) {
      // Process in background (fire and forget)
      processPaperSectionsAsync(sanitizedPaper.bibcode).catch((err) => {
        logger.warn('Background section processing failed', {
          bibcode: sanitizedPaper.bibcode,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  } catch (error) {
    logger.error('Failed to store paper', {
      bibcode: sanitizedPaper.bibcode,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Process paper sections asynchronously (non-blocking)
 */
async function processPaperSectionsAsync(bibcode: string): Promise<void> {
  try {
    const { processPaperSections } = await import('../pipeline/section-summarization');
    await processPaperSections(bibcode);
  } catch (error) {
    // Silently fail - this is background processing
    logger.debug('Section processing skipped or failed', {
      bibcode,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Sanitize text fields for PostgreSQL (remove null bytes)
 */
function sanitizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  // PostgreSQL doesn't allow null bytes in text fields
  return value.replace(/\0/g, '');
}

/**
 * Store multiple papers in batch
 */
export async function storePapersBatch(papers: ADSPaperRecord[]): Promise<void> {
  if (papers.length === 0) {
    return;
  }
  const now = Math.floor(Date.now() / 1000);

  // Sanitize all text fields to remove null bytes (required for PostgreSQL)
  const sanitizedPapers: ADSPaperRecord[] = papers.map(paper => ({
    ...paper,
    title: sanitizeText(paper.title) || undefined,
    authors: sanitizeText(paper.authors) || undefined,
    pubdate: sanitizeText(paper.pubdate) || undefined,
    abstract: sanitizeText(paper.abstract) || undefined,
    body: sanitizeText(paper.body) || undefined,
    journal: sanitizeText(paper.journal) || undefined,
    adsUrl: sanitizeText(paper.adsUrl) || undefined,
    arxivUrl: sanitizeText(paper.arxivUrl) || undefined,
    fulltextSource: sanitizeText(paper.fulltextSource) || undefined,
  }));

  try {
    

      // Process in smaller batches to avoid connection timeouts and query size limits
      // PostgreSQL can handle large queries, but with body text fields, we need smaller batches
      const BATCH_SIZE = 5; // Reduced from 10 to handle very large body text fields
      let processed = 0;

      while (processed < sanitizedPapers.length) {
        const batch = sanitizedPapers.slice(processed, processed + BATCH_SIZE);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        let paramIndex = 1;

        for (const paper of batch) {
          const year = paper.year || (paper.pubdate ? parseInt(paper.pubdate.substring(0, 4), 10) : undefined);
          placeholders.push(
            `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
          );
          values.push(
            paper.bibcode,
            paper.title || null,
            paper.authors || null,
            paper.pubdate || null,
            paper.abstract || null,
            paper.body || null,
            year || null,
            paper.journal || null,
            paper.adsUrl || null,
            paper.arxivUrl || null,
            paper.fulltextSource || null,
            now,
          );
        }

        // Retry logic for connection errors
        let retries = 3;
        let lastError: Error | null = null;

        while (retries > 0) {
          let pgClient: import('pg').PoolClient | null = null;
          try {
            // Get a fresh connection from the pool for each batch
            const { getFreshPostgresConnection } = await import('./driver');
            pgClient = await getFreshPostgresConnection();

            // Convert placeholders and execute
            const pgSql = `INSERT INTO ads_papers (
              bibcode, title, authors, pubdate, abstract, body,
              year, journal, ads_url, arxiv_url, fulltext_source, updated_at
            ) VALUES ${placeholders.join(', ')}
            ON CONFLICT(bibcode) DO UPDATE SET
              title = EXCLUDED.title,
              authors = EXCLUDED.authors,
              pubdate = EXCLUDED.pubdate,
              abstract = EXCLUDED.abstract,
              body = COALESCE(EXCLUDED.body, ads_papers.body),
              year = COALESCE(EXCLUDED.year, ads_papers.year),
              journal = EXCLUDED.journal,
              ads_url = EXCLUDED.ads_url,
              arxiv_url = EXCLUDED.arxiv_url,
              fulltext_source = COALESCE(EXCLUDED.fulltext_source, ads_papers.fulltext_source),
              updated_at = EXCLUDED.updated_at`;

            await pgClient.query(pgSql, values);
            processed += batch.length;
            logger.debug(`Stored batch of ${batch.length} papers (${processed}/${sanitizedPapers.length} total)`);
            break; // Success, exit retry loop
          } catch (batchError) {
            lastError = batchError instanceof Error ? batchError : new Error(String(batchError));
            retries--;

            // Check if it's a connection error that might be recoverable
            const errorMsg = lastError.message.toLowerCase();
            const isConnectionError = errorMsg.includes('connection') ||
                                     errorMsg.includes('terminated') ||
                                     errorMsg.includes('timeout') ||
                                     errorMsg.includes('broken pipe');

            if (isConnectionError && retries > 0) {
              logger.warn(`Connection error on batch, retrying (${retries} retries left)`, {
                batchSize: batch.length,
                processed,
                error: lastError.message,
              });
              // Wait a bit before retrying (exponential backoff)
              const delay = (4 - retries) * 1000; // 1s, 2s, 3s
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              // Not a connection error or out of retries
              logger.error('Failed to store batch', {
                batchSize: batch.length,
                processed,
                total: sanitizedPapers.length,
                error: lastError.message,
                retriesLeft: retries,
              });
              throw lastError;
            }
          } finally {
            // Always release the connection back to the pool
            if (pgClient) {
              pgClient.release();
            }
          }
        }
      }
    


    logger.info('Papers batch stored in database', { count: sanitizedPapers.length });

    // Automatically process sections for papers with body text (async, non-blocking)
    // processPaperSections will skip if sections already exist (unless forceRegenerate=true)
    const papersWithBody = sanitizedPapers.filter((p) => p.body && p.body.length >= 100);
    if (papersWithBody.length > 0) {
      logger.info('Triggering section processing for papers with body text', {
        count: papersWithBody.length,
      });
      // Process in background
      processPapersSectionsAsync(papersWithBody.map((p) => p.bibcode)).catch((err) => {
        logger.warn('Background batch section processing failed', {
          count: papersWithBody.length,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  } catch (error) {
    logger.error('Failed to store papers batch', {
      count: papers.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Process multiple papers' sections asynchronously (non-blocking)
 */
async function processPapersSectionsAsync(bibcodes: string[]): Promise<void> {
  try {
    const { processPaperSections } = await import('../pipeline/section-summarization');
    // Process sequentially to avoid overwhelming the API
    for (const bibcode of bibcodes) {
      await processPaperSections(bibcode).catch((err) => {
        logger.debug('Section processing failed for paper in batch', {
          bibcode,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  } catch (error) {
    logger.debug('Batch section processing skipped or failed', {
      count: bibcodes.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get a paper from the database
 */
export async function getPaper(bibcode: string): Promise<ADSPaperRecord | null> {

  try {
    

      const client = await getDbClient();
      const result = await client.query(
        `SELECT * FROM ads_papers WHERE bibcode = $1`,
        [bibcode]
      );
      const row = result.rows[0] as {
        bibcode: string;
        title?: string | null;
        authors?: string | null;
        pubdate?: string | null;
        abstract?: string | null;
        body?: string | null;
        year?: number | null;
        journal?: string | null;
        ads_url?: string | null;
        arxiv_url?: string | null;
        fulltext_source?: string | null;
      } | undefined;
      if (!row) return null;

      // Map PostgreSQL column names to camelCase
      return {
        bibcode: row.bibcode,
        title: row.title || undefined,
        authors: row.authors || undefined,
        pubdate: row.pubdate || undefined,
        abstract: row.abstract || undefined,
        body: row.body || undefined,
        year: row.year || undefined,
        journal: row.journal || undefined,
        adsUrl: row.ads_url || undefined,
        arxivUrl: row.arxiv_url || undefined,
        fulltextSource: row.fulltext_source || undefined,
      };
    

  } catch (error) {
    logger.error('Failed to get paper', {
      bibcode,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Get papers in a library
 */
export async function getLibraryPapers(libraryId: string, limit = 100, offset = 0): Promise<ADSPaperRecord[]> {

  try {
    

      const client = await getDbClient();

      // First check if the library has any linked papers
      const countResult = await client.query(
        `SELECT COUNT(*) as count FROM ads_library_papers WHERE library_id = $1`,
        [libraryId]
      );
      const linkCount = parseInt(countResult.rows[0]?.count as string || '0', 10);

      logger.info('Getting library papers', {
        libraryId,
        linkedPapersCount: linkCount,
        limit,
        offset,
      });

      if (linkCount === 0) {
        logger.warn('No papers linked to library', { libraryId });
        return [];
      }

      // Use COALESCE to handle NULL fetched_at values, fallback to created_at or added_at
      const result = await client.query(
        `SELECT p.*, lp.added_at
         FROM ads_papers p
         JOIN ads_library_papers lp ON p.bibcode = lp.bibcode
         WHERE lp.library_id = $1
         ORDER BY COALESCE(p.fetched_at, p.created_at, lp.added_at, 0) DESC
         LIMIT $2 OFFSET $3`,
        [libraryId, limit, offset]
      );

      logger.info('Retrieved library papers', {
        libraryId,
        requested: limit,
        returned: result.rows.length,
      });

      // Map PostgreSQL column names to camelCase
      return result.rows.map((row: Record<string, unknown>) => ({
        bibcode: row.bibcode as string,
        title: (row.title as string | null) || undefined,
        authors: (row.authors as string | null) || undefined,
        pubdate: (row.pubdate as string | null) || undefined,
        abstract: (row.abstract as string | null) || undefined,
        body: (row.body as string | null) || undefined,
        year: (row.year as number | null) || undefined,
        journal: (row.journal as string | null) || undefined,
        adsUrl: (row.ads_url as string | null) || undefined,
        arxivUrl: (row.arxiv_url as string | null) || undefined,
        fulltextSource: (row.fulltext_source as string | null) || undefined,
      }));
    

  } catch (error) {
    logger.error('Failed to get library papers', {
      libraryId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return [];
  }
}

export async function getCachedLibraryPaperCount(libraryId: string): Promise<number> {

  try {
      const client = await getDbClient();
      const result = await client.query(
        `SELECT COUNT(*) as count FROM ads_library_papers WHERE library_id = $1`,
        [libraryId],
      );
      return parseInt(String(result.rows[0]?.count ?? '0'), 10);
  } catch (error) {
    logger.error('Failed to count cached library papers', {
      libraryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export async function searchLibraryPapers(
  libraryId: string,
  query: string,
  limit = 50,
  offset = 0,
): Promise<ADSPaperSearchResult> {

  try {
    

      const client = await getDbClient();
      const countResult = await client.query(
        `SELECT COUNT(*) as count
         FROM ads_papers p
         JOIN ads_library_papers lp ON p.bibcode = lp.bibcode
         WHERE lp.library_id = $1
           AND to_tsvector('english', COALESCE(p.title, '') || ' ' || COALESCE(p.abstract, '') || ' ' || COALESCE(p.authors, ''))
               @@ plainto_tsquery('english', $2)`,
        [libraryId, query],
      );

      const total = parseInt(String(countResult.rows[0]?.count ?? '0'), 10);
      const result = await client.query(
        `SELECT p.*
         FROM ads_papers p
         JOIN ads_library_papers lp ON p.bibcode = lp.bibcode
         WHERE lp.library_id = $1
           AND to_tsvector('english', COALESCE(p.title, '') || ' ' || COALESCE(p.abstract, '') || ' ' || COALESCE(p.authors, ''))
               @@ plainto_tsquery('english', $2)
         ORDER BY ts_rank(
           to_tsvector('english', COALESCE(p.title, '') || ' ' || COALESCE(p.abstract, '') || ' ' || COALESCE(p.authors, '')),
           plainto_tsquery('english', $2)
         ) DESC,
         COALESCE(p.fetched_at, p.created_at, 0) DESC
         LIMIT $3 OFFSET $4`,
        [libraryId, query, limit, offset],
      );

      return {
        total,
        papers: result.rows.map((row: Record<string, unknown>) => ({
          bibcode: row.bibcode as string,
          title: (row.title as string | null) || undefined,
          authors: (row.authors as string | null) || undefined,
          pubdate: (row.pubdate as string | null) || undefined,
          abstract: (row.abstract as string | null) || undefined,
          body: (row.body as string | null) || undefined,
          year: (row.year as number | null) || undefined,
          journal: (row.journal as string | null) || undefined,
          adsUrl: (row.ads_url as string | null) || undefined,
          arxivUrl: (row.arxiv_url as string | null) || undefined,
          fulltextSource: (row.fulltext_source as string | null) || undefined,
        })),
      };
  } catch (error) {
    logger.error('Failed to search library papers', {
      libraryId,
      query,
      error: error instanceof Error ? error.message : String(error),
    });
    return { papers: [], total: 0 };
  }
}

/**
 * Link a paper to a library
 */
export async function linkPaperToLibrary(libraryId: string, bibcode: string): Promise<void> {
  try {
    const client = await getDbClient();
    await client.run(
      `
      INSERT INTO ads_library_papers (library_id, bibcode)
      VALUES ($1, $2)
      ON CONFLICT(library_id, bibcode) DO NOTHING
    `,
      [libraryId, bibcode],
    );
  } catch (error) {
    logger.error('Failed to link paper to library', {
      libraryId,
      bibcode,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Link multiple papers to a library in batch
 */
export async function linkPapersToLibraryBatch(libraryId: string, bibcodes: string[]): Promise<void> {
  if (bibcodes.length === 0) {
    return;
  }

  try {
    

      const client = await getDbClient();
      // Use a single query with VALUES for batch insert
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      for (const bibcode of bibcodes) {
        placeholders.push(`($${paramIndex++}, $${paramIndex++})`);
        values.push(libraryId, bibcode);
      }

      const result = await client.run(
        `INSERT INTO ads_library_papers (library_id, bibcode)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT(library_id, bibcode) DO NOTHING`,
        values
      );

      logger.info('Linked papers to library', {
        libraryId,
        bibcodesCount: bibcodes.length,
        inserted: result.changes,
      });
    

  } catch (error) {
    logger.error('Failed to link papers to library', {
      libraryId,
      count: bibcodes.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Check if a paper has full text cached
 */
export async function hasCachedFullText(bibcode: string): Promise<boolean> {
  try {
    const client = await getDbClient();
    const result = await client.query(
      `SELECT body FROM ads_papers WHERE bibcode = $1 AND body IS NOT NULL LIMIT 1`,
      [bibcode],
    );
    const row = result.rows[0] as { body: string } | undefined;
    return !!row?.body;
  } catch (error) {
    logger.error('Failed to check cached full text', {
      bibcode,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Get papers missing full text
 */
export async function getPapersMissingFullText(limit = 50): Promise<ADSPaperRecord[]> {
  try {
    const client = await getDbClient();
    const result = await client.query(
      `
      SELECT * FROM ads_papers
      WHERE body IS NULL
      ORDER BY fetched_at ASC
      LIMIT $1
    `,
      [limit],
    );
    return result.rows as unknown as ADSPaperRecord[];
  } catch (error) {
    logger.error('Failed to get papers missing full text', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get favorited/bookmarked papers for a user (per-user bookmarks)
 */
export async function getFavoritePapers(userId: string, limit = 100): Promise<ADSPaperRecord[]> {
  try {
    const { getFavoritePapers: getFavoriteBibcodes } = await import('./paper-annotations');
    const bibcodes = await getFavoriteBibcodes(userId);
    const limited = bibcodes.slice(0, limit);
    const papers = await Promise.all(limited.map((bibcode) => getPaper(bibcode)));
    return papers.filter((p): p is ADSPaperRecord => p !== null);
  } catch (error) {
    logger.error('Failed to get favorite papers', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get search results from local cache
 */
export async function searchPapers(query: string, limit = 50): Promise<ADSPaperRecord[]> {
  try {
    const client = await getDbClient();
    const searchTerm = `%${query}%`;
    const result = await client.query(
      `
      SELECT * FROM ads_papers
      WHERE title LIKE $1 OR abstract LIKE $2 OR authors LIKE $3
      ORDER BY fetched_at DESC
      LIMIT $4
    `,
      [searchTerm, searchTerm, searchTerm, limit],
    );
    return result.rows as unknown as ADSPaperRecord[];
  } catch (error) {
    logger.error('Failed to search papers', {
      query,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
