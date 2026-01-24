#!/usr/bin/env npx tsx
/**
 * Sync paper_sections from SQLite to PostgreSQL production database
 *
 * This script specifically syncs paper sections (with embeddings) to production.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/sync-paper-sections-to-prod.ts
 */

import Database from 'better-sqlite3';
import { Pool } from 'pg';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const SQLITE_PATH = path.join(DATA_DIR, 'digest.db');

async function syncPaperSections() {
  console.log('🔄 Syncing paper_sections to production...\n');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable not set');
    console.error('   Set it to your PostgreSQL connection string');
    process.exit(1);
  }

  if (!databaseUrl.startsWith('postgres')) {
    console.error('❌ DATABASE_URL must be a PostgreSQL connection string');
    process.exit(1);
  }

  if (!require('fs').existsSync(SQLITE_PATH)) {
    console.error(`❌ SQLite database not found at ${SQLITE_PATH}`);
    process.exit(1);
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    // Test connections
    await pool.query('SELECT 1');
    console.log('  ✅ Connected to PostgreSQL\n');

    // Ensure paper_sections table exists
    console.log('🔧 Ensuring paper_sections table exists...');

    // Check if ads_papers exists first (foreign key dependency)
    const adsPapersCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'ads_papers'
      );
    `);

    if (!adsPapersCheck.rows[0].exists) {
      console.log('  ⚠️  ads_papers table does not exist, creating it first...');
      await pool.query(`
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
          fetched_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
          created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
          updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
        );
      `);
    }

    // Create paper_sections table (without foreign key constraint for now, in case ads_papers doesn't exist)
    await pool.query(`
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
        embedding vector(1536),
        created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
        updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
        UNIQUE(bibcode, section_id)
      );
    `);

    // Add foreign key constraint if ads_papers exists and constraint doesn't exist
    try {
      const fkCheck = await pool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'paper_sections'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name LIKE '%bibcode%'
      `);

      if (fkCheck.rows.length === 0 && adsPapersCheck.rows[0].exists) {
        await pool.query(`
          ALTER TABLE paper_sections
          ADD CONSTRAINT paper_sections_bibcode_fkey
          FOREIGN KEY (bibcode) REFERENCES ads_papers(bibcode) ON DELETE CASCADE;
        `);
      }
    } catch (err) {
      // Foreign key may already exist or ads_papers doesn't exist - that's okay
      console.log('  ℹ️  Foreign key constraint skipped (may already exist or ads_papers missing)');
    }

    // Create index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_paper_sections_bibcode
      ON paper_sections(bibcode);
    `);

    // Create vector index if pgvector extension is available
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_paper_sections_embedding
        ON paper_sections USING hnsw (embedding vector_cosine_ops);
      `);
      console.log('  ✅ Vector index created\n');
    } catch (err) {
      console.log('  ⚠️  Vector index creation skipped (pgvector may not be enabled)\n');
    }

    console.log('  ✅ Table schema ready\n');

    // Get all paper sections from SQLite
    const sections = sqlite
      .prepare(`
        SELECT id, bibcode, section_id, section_title, level, summary,
               full_text, char_start, char_end, embedding, created_at, updated_at
        FROM paper_sections
        ORDER BY bibcode, char_start
      `)
      .all() as Array<{
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

    console.log(`📊 Found ${sections.length} sections in SQLite\n`);

    if (sections.length === 0) {
      console.log('  ℹ️  No sections to sync');
      return;
    }

    // Prepare insert statement
    const sql = `
      INSERT INTO paper_sections (
        id, bibcode, section_id, section_title, level, summary,
        full_text, char_start, char_end, embedding, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, $11, $12)
      ON CONFLICT (bibcode, section_id) DO UPDATE SET
        section_title = EXCLUDED.section_title,
        level = EXCLUDED.level,
        summary = EXCLUDED.summary,
        full_text = EXCLUDED.full_text,
        char_start = EXCLUDED.char_start,
        char_end = EXCLUDED.char_end,
        embedding = EXCLUDED.embedding,
        updated_at = EXCLUDED.updated_at
    `;

    let inserted = 0;
    let updated = 0;
    let errors = 0;

    // Process in batches
    const batchSize = 50;
    for (let i = 0; i < sections.length; i += batchSize) {
      const batch = sections.slice(i, i + batchSize);

      for (const row of batch) {
        try {
          // Sanitize text fields: remove null bytes (PostgreSQL doesn't allow them)
          const sanitizeText = (text: string | null): string => {
            if (!text) return '';
            return text.replace(/\0/g, ''); // Remove null bytes
          };

          const sectionTitle = sanitizeText(row.section_title);
          const summary = sanitizeText(row.summary);
          const fullText = sanitizeText(row.full_text);

          // Parse embedding from JSON string (SQLite stores as JSON text)
          const embedding = row.embedding ? JSON.parse(row.embedding) as number[] : null;
          const vectorStr = embedding ? `[${embedding.join(',')}]` : null;

          // Check if it already exists
          const existing = await pool.query(
            'SELECT id FROM paper_sections WHERE bibcode = $1 AND section_id = $2',
            [row.bibcode, row.section_id]
          );

          await pool.query(sql, [
            row.id,
            row.bibcode,
            row.section_id,
            sectionTitle,
            row.level,
            summary,
            fullText,
            row.char_start,
            row.char_end,
            vectorStr,
            row.created_at,
            row.updated_at,
          ]);

          if (existing.rows.length > 0) {
            updated++;
          } else {
            inserted++;
          }
        } catch (err) {
          errors++;
          if (!(err instanceof Error && err.message.includes('duplicate'))) {
            console.error(`  ❌ Error syncing section ${row.id}:`, err instanceof Error ? err.message : String(err));
          }
        }
      }

      // Progress indicator
      const progress = Math.min(i + batchSize, sections.length);
      process.stdout.write(`\r  Progress: ${progress}/${sections.length} sections processed...`);
    }

    console.log('\n\n📊 Sync Summary:');
    console.log(`  ✅ Inserted: ${inserted}`);
    console.log(`  🔄 Updated: ${updated}`);
    console.log(`  ❌ Errors: ${errors}`);
    console.log(`  📦 Total: ${sections.length}`);

    // Verify sync
    const prodCount = await pool.query('SELECT COUNT(*) as count FROM paper_sections');
    console.log(`\n  📊 Sections in production: ${prodCount.rows[0].count}`);

  } catch (error) {
    console.error('\n❌ Sync failed:', error);
    process.exit(1);
  } finally {
    sqlite.close();
    await pool.end();
  }
}

syncPaperSections().catch(console.error);

