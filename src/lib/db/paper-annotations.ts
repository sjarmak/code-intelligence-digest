/**
 * Paper annotations database operations
 * Handles storing and retrieving annotations, highlights, and tags for papers
 */

import { getSqlite } from './index';
import { logger } from '../logger';
import { randomUUID } from 'crypto';

// Types
export interface PaperAnnotation {
  id: string;
  bibcode: string;
  type: 'note' | 'highlight';
  content: string;
  note?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
  sectionId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PaperTag {
  id: string;
  name: string;
  color?: string | null;
  createdAt: number;
}

export interface PaperTagLink {
  bibcode: string;
  tagId: string;
  createdAt: number;
}

export interface CreateAnnotationInput {
  bibcode: string;
  type: 'note' | 'highlight';
  content: string;
  note?: string;
  startOffset?: number;
  endOffset?: number;
  sectionId?: string;
}

export interface CreateTagInput {
  name: string;
  color?: string;
}

/**
 * Initialize annotation tables in database
 */
export function initializeAnnotationTables() {
  const db = getSqlite();

  try {
    // Create paper_annotations table
    db.exec(`
      CREATE TABLE IF NOT EXISTS paper_annotations (
        id TEXT PRIMARY KEY,
        bibcode TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('note', 'highlight')),
        content TEXT NOT NULL,
        note TEXT,
        start_offset INTEGER,
        end_offset INTEGER,
        section_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (bibcode) REFERENCES ads_papers(bibcode) ON DELETE CASCADE
      );
    `);

    // Create paper_tags table
    db.exec(`
      CREATE TABLE IF NOT EXISTS paper_tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Create paper_tag_links junction table
    db.exec(`
      CREATE TABLE IF NOT EXISTS paper_tag_links (
        bibcode TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (bibcode, tag_id),
        FOREIGN KEY (bibcode) REFERENCES ads_papers(bibcode) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES paper_tags(id) ON DELETE CASCADE
      );
    `);

    // Add new columns to ads_papers if they don't exist
    // SQLite doesn't support IF NOT EXISTS for columns, so we check and add
    const tableInfo = db.prepare(`PRAGMA table_info(ads_papers)`).all() as Array<{ name: string }>;
    const columnNames = tableInfo.map((col) => col.name);

    if (!columnNames.includes('html_content')) {
      db.exec(`ALTER TABLE ads_papers ADD COLUMN html_content TEXT`);
    }
    if (!columnNames.includes('html_fetched_at')) {
      db.exec(`ALTER TABLE ads_papers ADD COLUMN html_fetched_at INTEGER`);
    }
    if (!columnNames.includes('paper_notes')) {
      db.exec(`ALTER TABLE ads_papers ADD COLUMN paper_notes TEXT`);
    }

    // Create indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_annotations_bibcode ON paper_annotations(bibcode);
      CREATE INDEX IF NOT EXISTS idx_annotations_type ON paper_annotations(type);
      CREATE INDEX IF NOT EXISTS idx_tag_links_bibcode ON paper_tag_links(bibcode);
      CREATE INDEX IF NOT EXISTS idx_tag_links_tag ON paper_tag_links(tag_id);
    `);

    logger.info('Annotation tables initialized');
  } catch (error) {
    logger.error('Failed to initialize annotation tables', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ========== Annotation Operations ==========

/**
 * Create a new annotation
 */
export function createAnnotation(input: CreateAnnotationInput): PaperAnnotation {
  const db = getSqlite();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    INSERT INTO paper_annotations (
      id, bibcode, type, content, note, start_offset, end_offset, section_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.bibcode,
    input.type,
    input.content,
    input.note ?? null,
    input.startOffset ?? null,
    input.endOffset ?? null,
    input.sectionId ?? null,
    now,
    now
  );

  logger.info('Annotation created', { id, bibcode: input.bibcode, type: input.type });

  return {
    id,
    bibcode: input.bibcode,
    type: input.type,
    content: input.content,
    note: input.note ?? null,
    startOffset: input.startOffset ?? null,
    endOffset: input.endOffset ?? null,
    sectionId: input.sectionId ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get all annotations for a paper
 */
export function getAnnotations(bibcode: string): PaperAnnotation[] {
  const db = getSqlite();

  const stmt = db.prepare(`
    SELECT
      id, bibcode, type, content, note,
      start_offset as startOffset, end_offset as endOffset,
      section_id as sectionId, created_at as createdAt, updated_at as updatedAt
    FROM paper_annotations
    WHERE bibcode = ?
    ORDER BY created_at DESC
  `);

  return stmt.all(bibcode) as PaperAnnotation[];
}

/**
 * Get a single annotation by ID
 */
export function getAnnotation(id: string): PaperAnnotation | null {
  const db = getSqlite();

  const stmt = db.prepare(`
    SELECT
      id, bibcode, type, content, note,
      start_offset as startOffset, end_offset as endOffset,
      section_id as sectionId, created_at as createdAt, updated_at as updatedAt
    FROM paper_annotations
    WHERE id = ?
  `);

  return (stmt.get(id) as PaperAnnotation) ?? null;
}

/**
 * Update an annotation
 */
export function updateAnnotation(
  id: string,
  updates: Partial<Pick<PaperAnnotation, 'content' | 'note'>>
): PaperAnnotation | null {
  const db = getSqlite();
  const now = Math.floor(Date.now() / 1000);

  const setClauses: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (updates.content !== undefined) {
    setClauses.push('content = ?');
    values.push(updates.content);
  }
  if (updates.note !== undefined) {
    setClauses.push('note = ?');
    values.push(updates.note);
  }

  values.push(id);

  const stmt = db.prepare(`
    UPDATE paper_annotations
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `);

  const result = stmt.run(...values);

  if (result.changes === 0) {
    return null;
  }

  logger.info('Annotation updated', { id });
  return getAnnotation(id);
}

/**
 * Delete an annotation
 */
export function deleteAnnotation(id: string): boolean {
  const db = getSqlite();

  const stmt = db.prepare(`DELETE FROM paper_annotations WHERE id = ?`);
  const result = stmt.run(id);

  if (result.changes > 0) {
    logger.info('Annotation deleted', { id });
    return true;
  }
  return false;
}

/**
 * Get annotation count for a paper
 */
export function getAnnotationCount(bibcode: string): number {
  const db = getSqlite();

  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM paper_annotations WHERE bibcode = ?
  `);

  const result = stmt.get(bibcode) as { count: number };
  return result.count;
}

// ========== Tag Operations ==========

/**
 * Create a new tag
 */
export function createTag(input: CreateTagInput): PaperTag {
  const db = getSqlite();
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    INSERT INTO paper_tags (id, name, color, created_at)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(id, input.name, input.color ?? null, now);

  logger.info('Tag created', { id, name: input.name });

  return {
    id,
    name: input.name,
    color: input.color ?? null,
    createdAt: now,
  };
}

/**
 * Get all tags
 */
export function getAllTags(): PaperTag[] {
  const db = getSqlite();

  const stmt = db.prepare(`
    SELECT id, name, color, created_at as createdAt
    FROM paper_tags
    ORDER BY name ASC
  `);

  return stmt.all() as PaperTag[];
}

/**
 * Get a tag by ID
 */
export function getTag(id: string): PaperTag | null {
  const db = getSqlite();

  const stmt = db.prepare(`
    SELECT id, name, color, created_at as createdAt
    FROM paper_tags
    WHERE id = ?
  `);

  return (stmt.get(id) as PaperTag) ?? null;
}

/**
 * Get a tag by name
 */
export function getTagByName(name: string): PaperTag | null {
  const db = getSqlite();

  const stmt = db.prepare(`
    SELECT id, name, color, created_at as createdAt
    FROM paper_tags
    WHERE name = ?
  `);

  return (stmt.get(name) as PaperTag) ?? null;
}

/**
 * Update a tag
 */
export function updateTag(
  id: string,
  updates: Partial<Pick<PaperTag, 'name' | 'color'>>
): PaperTag | null {
  const db = getSqlite();

  const setClauses: string[] = [];
  const values: (string | null)[] = [];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    values.push(updates.name);
  }
  if (updates.color !== undefined) {
    setClauses.push('color = ?');
    values.push(updates.color);
  }

  if (setClauses.length === 0) {
    return getTag(id);
  }

  values.push(id);

  const stmt = db.prepare(`
    UPDATE paper_tags
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `);

  const result = stmt.run(...values);

  if (result.changes === 0) {
    return null;
  }

  logger.info('Tag updated', { id });
  return getTag(id);
}

/**
 * Delete a tag (also removes all links)
 */
export function deleteTag(id: string): boolean {
  const db = getSqlite();

  const stmt = db.prepare(`DELETE FROM paper_tags WHERE id = ?`);
  const result = stmt.run(id);

  if (result.changes > 0) {
    logger.info('Tag deleted', { id });
    return true;
  }
  return false;
}

// ========== Tag Link Operations ==========

/**
 * Add a tag to a paper
 */
export function addTagToPaper(bibcode: string, tagId: string): boolean {
  const db = getSqlite();

  try {
    const stmt = db.prepare(`
      INSERT INTO paper_tag_links (bibcode, tag_id)
      VALUES (?, ?)
      ON CONFLICT(bibcode, tag_id) DO NOTHING
    `);

    stmt.run(bibcode, tagId);
    logger.info('Tag added to paper', { bibcode, tagId });
    return true;
  } catch (error) {
    logger.error('Failed to add tag to paper', {
      bibcode,
      tagId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Remove a tag from a paper
 */
export function removeTagFromPaper(bibcode: string, tagId: string): boolean {
  const db = getSqlite();

  const stmt = db.prepare(`
    DELETE FROM paper_tag_links WHERE bibcode = ? AND tag_id = ?
  `);

  const result = stmt.run(bibcode, tagId);

  if (result.changes > 0) {
    logger.info('Tag removed from paper', { bibcode, tagId });
    return true;
  }
  return false;
}

/**
 * Get all tags for a paper
 */
export function getPaperTags(bibcode: string): PaperTag[] {
  const db = getSqlite();

  const stmt = db.prepare(`
    SELECT t.id, t.name, t.color, t.created_at as createdAt
    FROM paper_tags t
    JOIN paper_tag_links ptl ON t.id = ptl.tag_id
    WHERE ptl.bibcode = ?
    ORDER BY t.name ASC
  `);

  return stmt.all(bibcode) as PaperTag[];
}

/**
 * Get all papers with a specific tag
 */
export function getPapersWithTag(tagId: string): string[] {
  const db = getSqlite();

  const stmt = db.prepare(`
    SELECT bibcode FROM paper_tag_links WHERE tag_id = ?
  `);

  const results = stmt.all(tagId) as Array<{ bibcode: string }>;
  return results.map((r) => r.bibcode);
}

// ========== Paper Notes Operations ==========

/**
 * Get paper-level notes
 */
export function getPaperNotes(bibcode: string): string | null {
  const db = getSqlite();

  const stmt = db.prepare(`
    SELECT paper_notes FROM ads_papers WHERE bibcode = ?
  `);

  const result = stmt.get(bibcode) as { paper_notes: string | null } | undefined;
  return result?.paper_notes ?? null;
}

/**
 * Update paper-level notes
 */
export function updatePaperNotes(bibcode: string, notes: string | null): boolean {
  const db = getSqlite();

  const stmt = db.prepare(`
    UPDATE ads_papers
    SET paper_notes = ?, updated_at = strftime('%s', 'now')
    WHERE bibcode = ?
  `);

  const result = stmt.run(notes, bibcode);

  if (result.changes > 0) {
    logger.info('Paper notes updated', { bibcode });
    return true;
  }
  return false;
}

// ========== HTML Content Cache Operations ==========

/**
 * Get cached HTML content for a paper
 */
export function getCachedHtmlContent(
  bibcode: string
): { htmlContent: string; htmlFetchedAt: number } | null {
  const db = getSqlite();

  const stmt = db.prepare(`
    SELECT html_content, html_fetched_at
    FROM ads_papers
    WHERE bibcode = ? AND html_content IS NOT NULL
  `);

  const result = stmt.get(bibcode) as
    | { html_content: string; html_fetched_at: number }
    | undefined;

  if (!result) return null;

  return {
    htmlContent: result.html_content,
    htmlFetchedAt: result.html_fetched_at,
  };
}

/**
 * Cache HTML content for a paper
 */
export function cacheHtmlContent(bibcode: string, htmlContent: string): boolean {
  const db = getSqlite();
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    UPDATE ads_papers
    SET html_content = ?, html_fetched_at = ?, updated_at = ?
    WHERE bibcode = ?
  `);

  const result = stmt.run(htmlContent, now, now, bibcode);

  if (result.changes > 0) {
    logger.info('HTML content cached', { bibcode });
    return true;
  }
  return false;
}

/**
 * Check if cached HTML is fresh (less than 7 days old)
 */
export function isCachedHtmlFresh(bibcode: string, maxAgeSeconds = 7 * 24 * 60 * 60): boolean {
  const cached = getCachedHtmlContent(bibcode);
  if (!cached) return false;

  const now = Math.floor(Date.now() / 1000);
  return now - cached.htmlFetchedAt < maxAgeSeconds;
}
