/**
 * Paper section summaries database operations
 * Stores section-level summaries and embeddings for intelligent retrieval
 */

import { getSqlite } from './index';
import { logger } from '../logger';
import { generateEmbedding } from '../embeddings/generate';

export interface PaperSectionSummary {
  id: string;
  bibcode: string;
  sectionId: string; // e.g., "section-1", "abstract", "introduction"
  sectionTitle: string;
  level: number; // Heading level (1-6)
  summary: string; // LLM-generated summary
  fullText: string; // Original section text
  charStart: number; // Character offset in body
  charEnd: number; // Character offset in body
  embedding?: number[]; // 1536-dim embedding of summary
  createdAt: number;
  updatedAt: number;
}

/**
 * Initialize paper_sections table
 * Works with both SQLite (dev) and PostgreSQL (prod)
 */
export function initializePaperSectionsTable() {
  // Check if we're using Postgres
  if (process.env.DATABASE_URL?.startsWith('postgres')) {
    // Postgres schema is handled by schema-postgres.ts
    // Just ensure the table exists (it will be created by schema initialization)
    logger.info('Paper sections table will be initialized via Postgres schema');
    return;
  }

  // SQLite initialization
  const db = getSqlite();

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS paper_sections (
        id TEXT PRIMARY KEY,
        bibcode TEXT NOT NULL,
        section_id TEXT NOT NULL,
        section_title TEXT NOT NULL,
        level INTEGER NOT NULL,
        summary TEXT NOT NULL,
        full_text TEXT NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        embedding BLOB, -- JSON array of floats
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (bibcode) REFERENCES ads_papers(bibcode) ON DELETE CASCADE,
        UNIQUE(bibcode, section_id)
      );
    `);

    // Index for fast lookups
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_paper_sections_bibcode
      ON paper_sections(bibcode);
    `);

    logger.info('Paper sections table initialized (SQLite)');
  } catch (error) {
    logger.error('Failed to initialize paper sections table', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Store section summaries for a paper
 */
export async function storeSectionSummaries(
  bibcode: string,
  sections: Array<{
    sectionId: string;
    sectionTitle: string;
    level: number;
    summary: string;
    fullText: string;
    charStart: number;
    charEnd: number;
  }>
): Promise<void> {
  const db = getSqlite();
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    INSERT INTO paper_sections (
      id, bibcode, section_id, section_title, level, summary,
      full_text, char_start, char_end, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bibcode, section_id) DO UPDATE SET
      section_title = excluded.section_title,
      level = excluded.level,
      summary = excluded.summary,
      full_text = excluded.full_text,
      char_start = excluded.char_start,
      char_end = excluded.char_end,
      updated_at = excluded.updated_at
  `);

  for (const section of sections) {
    const id = `${bibcode}:${section.sectionId}`;
    stmt.run(
      id,
      bibcode,
      section.sectionId,
      section.sectionTitle,
      section.level,
      section.summary,
      section.fullText,
      section.charStart,
      section.charEnd,
      now,
      now
    );
  }

  logger.info('Stored section summaries', {
    bibcode,
    sectionCount: sections.length,
  });
}

/**
 * Generate and store embeddings for section summaries
 */
export async function generateAndStoreSectionEmbeddings(bibcode: string): Promise<void> {
  const db = getSqlite();
  const sections = getSectionSummaries(bibcode);

  if (sections.length === 0) {
    logger.warn('No sections found for embedding generation', { bibcode });
    return;
  }

  logger.info('Generating embeddings for sections', {
    bibcode,
    sectionCount: sections.length,
  });

  const updateStmt = db.prepare(`
    UPDATE paper_sections
    SET embedding = ?, updated_at = ?
    WHERE id = ?
  `);

  const now = Math.floor(Date.now() / 1000);

  for (const section of sections) {
    try {
      // Generate embedding from summary (or full text if summary is short)
      const textToEmbed = section.summary.length > 100
        ? section.summary
        : `${section.sectionTitle}: ${section.summary}`;

      const embedding = await generateEmbedding(textToEmbed);
      const embeddingJson = JSON.stringify(embedding);

      updateStmt.run(embeddingJson, now, section.id);
    } catch (error) {
      logger.error('Failed to generate embedding for section', {
        bibcode,
        sectionId: section.sectionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Generated and stored section embeddings', {
    bibcode,
    sectionCount: sections.length,
  });
}

/**
 * Get all section summaries for a paper
 */
export function getSectionSummaries(bibcode: string): PaperSectionSummary[] {
  const db = getSqlite();

  const stmt = db.prepare(`
    SELECT
      id, bibcode, section_id, section_title, level, summary,
      full_text, char_start, char_end, embedding, created_at, updated_at
    FROM paper_sections
    WHERE bibcode = ?
    ORDER BY char_start ASC
  `);

  const rows = stmt.all(bibcode) as Array<{
    id: string;
    bibcode: string;
    section_id: string;
    section_title: string;
    level: number;
    summary: string;
    full_text: string;
    char_start: number;
    char_end: number;
    embedding: string | null;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    bibcode: row.bibcode,
    sectionId: row.section_id,
    sectionTitle: row.section_title,
    level: row.level,
    summary: row.summary,
    fullText: row.full_text,
    charStart: row.char_start,
    charEnd: row.char_end,
    embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Find relevant sections using semantic search
 * Returns sections sorted by relevance to the query
 */
export async function findRelevantSections(
  bibcode: string,
  query: string,
  limit: number = 5
): Promise<Array<PaperSectionSummary & { relevanceScore: number }>> {
  const sections = getSectionSummaries(bibcode);

  if (sections.length === 0) {
    return [];
  }

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);

  // Compute cosine similarity for each section
  const scoredSections = sections
    .filter((s) => s.embedding && s.embedding.length > 0)
    .map((section) => {
      const similarity = cosineSimilarity(queryEmbedding, section.embedding!);
      return {
        ...section,
        relevanceScore: Math.max(0, similarity), // Normalize to [0, 1]
      };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);

  logger.info('Found relevant sections', {
    bibcode,
    query,
    totalSections: sections.length,
    relevantCount: scoredSections.length,
    topScore: scoredSections[0]?.relevanceScore,
  });

  return scoredSections;
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Clear all section summaries for a paper (useful for regeneration)
 */
export function clearSectionSummaries(bibcode: string): void {
  const db = getSqlite();
  const stmt = db.prepare('DELETE FROM paper_sections WHERE bibcode = ?');
  stmt.run(bibcode);
  logger.info('Cleared section summaries', { bibcode });
}

