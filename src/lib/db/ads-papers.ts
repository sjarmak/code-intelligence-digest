/**
 * ADS papers database operations
 * Handles storing and retrieving paper metadata and full text from local database
 */

import { getSqlite } from './index';
import { detectDriver, getDbClient } from './driver';
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

/**
 * Initialize ADS tables in database
 */
export function initializeADSTables() {
  const db = getSqlite();

  try {
    // Create ads_papers table
    db.exec(`
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
        is_favorite INTEGER DEFAULT 0,
        favorited_at INTEGER,
        fetched_at INTEGER DEFAULT (strftime('%s', 'now')),
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Create ads_library_papers junction table
    db.exec(`
      CREATE TABLE IF NOT EXISTS ads_library_papers (
        library_id TEXT NOT NULL,
        bibcode TEXT NOT NULL,
        added_at INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (library_id, bibcode),
        FOREIGN KEY (bibcode) REFERENCES ads_papers(bibcode) ON DELETE CASCADE
      );
    `);

    // Create ads_libraries cache table
    db.exec(`
      CREATE TABLE IF NOT EXISTS ads_libraries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        num_documents INTEGER NOT NULL DEFAULT 0,
        is_public INTEGER NOT NULL DEFAULT 0,
        fetched_at INTEGER DEFAULT (strftime('%s', 'now')),
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Create indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ads_papers_year ON ads_papers(year);
      CREATE INDEX IF NOT EXISTS idx_ads_papers_journal ON ads_papers(journal);
      CREATE INDEX IF NOT EXISTS idx_ads_library_papers_library ON ads_library_papers(library_id);
      CREATE INDEX IF NOT EXISTS idx_ads_library_papers_bibcode ON ads_library_papers(bibcode);
    `);

    logger.info('ADS database tables initialized');
  } catch (error) {
    logger.error('Failed to initialize ADS tables', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Store or update a paper in the database
 */
export async function storePaper(paper: ADSPaperRecord): Promise<void> {
  const driver = detectDriver();
  const year = paper.year || (paper.pubdate ? parseInt(paper.pubdate.substring(0, 4), 10) : undefined);

  // Sanitize text fields to remove null bytes (required for PostgreSQL)
  const sanitizedPaper = {
    ...paper,
    title: sanitizeText(paper.title),
    authors: sanitizeText(paper.authors),
    pubdate: sanitizeText(paper.pubdate),
    abstract: sanitizeText(paper.abstract),
    body: sanitizeText(paper.body),
    journal: sanitizeText(paper.journal),
    adsUrl: sanitizeText(paper.adsUrl),
    arxivUrl: sanitizeText(paper.arxivUrl),
    fulltextSource: sanitizeText(paper.fulltextSource),
  };

  try {
    if (driver === 'postgres') {
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
    } else {
      const db = getSqlite();
      const stmt = db.prepare(`
        INSERT INTO ads_papers (
          bibcode, title, authors, pubdate, abstract, body,
          year, journal, ads_url, arxiv_url, fulltext_source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
        ON CONFLICT(bibcode) DO UPDATE SET
          title = excluded.title,
          authors = excluded.authors,
          pubdate = excluded.pubdate,
          abstract = excluded.abstract,
          body = COALESCE(excluded.body, body),
          year = COALESCE(excluded.year, year),
          journal = excluded.journal,
          ads_url = excluded.ads_url,
          arxiv_url = excluded.arxiv_url,
          fulltext_source = COALESCE(excluded.fulltext_source, fulltext_source),
          updated_at = strftime('%s', 'now')
      `);
      stmt.run(
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
      );
    }

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

  const driver = detectDriver();
  const now = Math.floor(Date.now() / 1000);
  
  // Sanitize all text fields to remove null bytes (required for PostgreSQL)
  const sanitizedPapers = papers.map(paper => ({
    ...paper,
    title: sanitizeText(paper.title),
    authors: sanitizeText(paper.authors),
    pubdate: sanitizeText(paper.pubdate),
    abstract: sanitizeText(paper.abstract),
    body: sanitizeText(paper.body),
    journal: sanitizeText(paper.journal),
    adsUrl: sanitizeText(paper.adsUrl),
    arxivUrl: sanitizeText(paper.arxivUrl),
    fulltextSource: sanitizeText(paper.fulltextSource),
  }));

  try {
    if (driver === 'postgres') {
      const client = await getDbClient();
      // Use a single query with VALUES for batch insert
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      for (const paper of sanitizedPapers) {
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

      await client.run(
        `INSERT INTO ads_papers (
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
          updated_at = EXCLUDED.updated_at`,
        values
      );
    } else {
      const db = getSqlite();
      const stmt = db.prepare(`
        INSERT INTO ads_papers (
          bibcode, title, authors, pubdate, abstract, body,
          year, journal, ads_url, arxiv_url, fulltext_source, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
        ON CONFLICT(bibcode) DO UPDATE SET
          title = excluded.title,
          authors = excluded.authors,
          pubdate = excluded.pubdate,
          abstract = excluded.abstract,
          body = COALESCE(excluded.body, body),
          year = COALESCE(excluded.year, year),
          journal = excluded.journal,
          ads_url = excluded.ads_url,
          arxiv_url = excluded.arxiv_url,
          fulltext_source = COALESCE(excluded.fulltext_source, fulltext_source),
          updated_at = strftime('%s', 'now')
      `);

      const insertMany = db.transaction((prs: ADSPaperRecord[]) => {
        for (const paper of prs) {
          const year =
            paper.year || (paper.pubdate ? parseInt(paper.pubdate.substring(0, 4), 10) : undefined);
          stmt.run(
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
          );
        }
      });

      insertMany(sanitizedPapers);
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
export function getPaper(bibcode: string): ADSPaperRecord | null {
  const db = getSqlite();

  try {
    const stmt = db.prepare(`
      SELECT * FROM ads_papers WHERE bibcode = ?
    `);

    return stmt.get(bibcode) as ADSPaperRecord | undefined || null;
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
export function getLibraryPapers(libraryId: string, limit = 100, offset = 0): ADSPaperRecord[] {
  const db = getSqlite();

  try {
    const stmt = db.prepare(`
      SELECT p.* FROM ads_papers p
      JOIN ads_library_papers lp ON p.bibcode = lp.bibcode
      WHERE lp.library_id = ?
      ORDER BY p.fetched_at DESC
      LIMIT ? OFFSET ?
    `);

    return stmt.all(libraryId, limit, offset) as ADSPaperRecord[];
  } catch (error) {
    logger.error('Failed to get library papers', {
      libraryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Link a paper to a library
 */
export function linkPaperToLibrary(libraryId: string, bibcode: string): void {
  const db = getSqlite();

  try {
    const stmt = db.prepare(`
      INSERT INTO ads_library_papers (library_id, bibcode)
      VALUES (?, ?)
      ON CONFLICT(library_id, bibcode) DO NOTHING
    `);

    stmt.run(libraryId, bibcode);
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
export function linkPapersToLibraryBatch(libraryId: string, bibcodes: string[]): void {
  const db = getSqlite();

  try {
    const stmt = db.prepare(`
      INSERT INTO ads_library_papers (library_id, bibcode)
      VALUES (?, ?)
      ON CONFLICT(library_id, bibcode) DO NOTHING
    `);

    const linkMany = db.transaction((codes: string[]) => {
      for (const bibcode of codes) {
        stmt.run(libraryId, bibcode);
      }
    });

    linkMany(bibcodes);
    logger.info('Papers linked to library', { libraryId, count: bibcodes.length });
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
export function hasCachedFullText(bibcode: string): boolean {
  const db = getSqlite();

  try {
    const stmt = db.prepare(`
      SELECT body FROM ads_papers WHERE bibcode = ? AND body IS NOT NULL LIMIT 1
    `);

    const result = stmt.get(bibcode) as { body: string } | undefined;
    return !!result?.body;
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
export function getPapersMissingFullText(limit = 50): ADSPaperRecord[] {
  const db = getSqlite();

  try {
    const stmt = db.prepare(`
      SELECT * FROM ads_papers
      WHERE body IS NULL
      ORDER BY fetched_at ASC
      LIMIT ?
    `);

    return stmt.all(limit) as ADSPaperRecord[];
  } catch (error) {
    logger.error('Failed to get papers missing full text', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get search results from local cache
 */
export function searchPapers(query: string, limit = 50): ADSPaperRecord[] {
  const db = getSqlite();

  try {
    const searchTerm = `%${query}%`;
    const stmt = db.prepare(`
      SELECT * FROM ads_papers
      WHERE title LIKE ? OR abstract LIKE ? OR authors LIKE ?
      ORDER BY fetched_at DESC
      LIMIT ?
    `);

    return stmt.all(searchTerm, searchTerm, searchTerm, limit) as ADSPaperRecord[];
  } catch (error) {
    logger.error('Failed to search papers', {
      query,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
