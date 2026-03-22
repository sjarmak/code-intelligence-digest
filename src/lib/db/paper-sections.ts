/**
 * Paper section summaries database operations
 * Stores section-level summaries and embeddings for intelligent retrieval
 */

import { getDbClient } from "./driver";
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
 * PostgreSQL schema is defined in `schema-postgres.ts` and applied by `initializeDatabase()`.
 */
export function initializePaperSectionsTable() {
  logger.info("Paper sections table is managed via PostgreSQL schema initialization");
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
  const now = Math.floor(Date.now() / 1000);

  

    const client = await getDbClient();
    for (const section of sections) {
      const id = `${bibcode}:${section.sectionId}`;
      await client.run(
        `INSERT INTO paper_sections (
          id, bibcode, section_id, section_title, level, summary,
          full_text, char_start, char_end, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT(bibcode, section_id) DO UPDATE SET
          section_title = EXCLUDED.section_title,
          level = EXCLUDED.level,
          summary = EXCLUDED.summary,
          full_text = EXCLUDED.full_text,
          char_start = EXCLUDED.char_start,
          char_end = EXCLUDED.char_end,
          updated_at = EXCLUDED.updated_at`,
        [
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
          now,
        ]
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
  const sections = await getSectionSummaries(bibcode);

  if (sections.length === 0) {
    logger.warn('No sections found for embedding generation', { bibcode });
    return;
  }

  logger.info('Generating embeddings for sections', {
    bibcode,
    sectionCount: sections.length,
  });

  const now = Math.floor(Date.now() / 1000);

  

    const client = await getDbClient();
    for (const section of sections) {
      try {
        // Generate embedding from summary (or full text if summary is short)
        const textToEmbed = section.summary.length > 100
          ? section.summary
          : `${section.sectionTitle}: ${section.summary}`;

        const embedding = await generateEmbedding(textToEmbed);
        // Postgres expects vector type - convert array to Postgres vector format
        // Format: "[0.1,0.2,...]" (same as item_embeddings)
        const vectorStr = `[${embedding.join(',')}]`;

        await client.run(
          `UPDATE paper_sections
          SET embedding = $1::vector, updated_at = $2
          WHERE id = $3`,
          [vectorStr, now, section.id]
        );
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
export async function getSectionSummaries(bibcode: string): Promise<PaperSectionSummary[]> {

  

    const client = await getDbClient();
    const result = await client.query(
      `SELECT
        id, bibcode, section_id, section_title, level, summary,
        full_text, char_start, char_end, embedding, created_at, updated_at
      FROM paper_sections
      WHERE bibcode = $1
      ORDER BY char_start ASC`,
      [bibcode]
    );

    return result.rows.map((row: Record<string, unknown>) => {
      // Handle Postgres vector type - it comes as a string or array
      let embedding: number[] | undefined;
      if (row.embedding) {
        if (typeof row.embedding === 'string') {
          try {
            embedding = JSON.parse(row.embedding);
          } catch {
            // If parsing fails, try to parse as Postgres array format
            embedding = undefined;
          }
        } else if (Array.isArray(row.embedding)) {
          embedding = row.embedding as number[];
        }
      }

      return {
        id: row.id as string,
        bibcode: row.bibcode as string,
        sectionId: row.section_id as string,
        sectionTitle: row.section_title as string,
        level: row.level as number,
        summary: row.summary as string,
        fullText: row.full_text as string,
        charStart: row.char_start as number,
        charEnd: row.char_end as number,
        embedding,
        createdAt: row.created_at as number,
        updatedAt: row.updated_at as number,
      };
    });
  

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
  const sections = await getSectionSummaries(bibcode);

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
export async function clearSectionSummaries(bibcode: string): Promise<void> {

  

    const client = await getDbClient();
    await client.run('DELETE FROM paper_sections WHERE bibcode = $1', [bibcode]);
  


  logger.info('Cleared section summaries', { bibcode });
}

