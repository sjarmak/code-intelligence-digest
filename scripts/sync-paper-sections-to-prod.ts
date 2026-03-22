#!/usr/bin/env npx tsx
/**
 * Sync paper_sections from local Postgres → production Postgres
 *
 * Usage:
 *   DATABASE_URL=postgres://... LOCAL_DATABASE_URL=postgres://... npx tsx scripts/sync-paper-sections-to-prod.ts
 */

import { Pool } from 'pg';

function requirePostgresUrl(envName: string): string {
  const url = process.env[envName];
  if (!url || !(url.startsWith('postgres://') || url.startsWith('postgresql://'))) {
    throw new Error(`${envName} must be set to a postgres:// or postgresql:// connection string`);
  }
  return url;
}

function embeddingToVectorString(embedding: unknown): string | null {
  if (embedding === null || embedding === undefined) return null;

  // pgvector may come back as string '[..]' or a Buffer
  if (typeof embedding === 'string') {
    const trimmed = embedding.trim();
    if (trimmed.startsWith('[')) {
      return trimmed;
    }
    // JSON text from older stores
    try {
      const parsed = JSON.parse(trimmed) as number[];
      return `[${parsed.join(',')}]`;
    } catch {
      return null;
    }
  }

  if (Array.isArray(embedding)) {
    return `[${(embedding as number[]).join(',')}]`;
  }

  if (Buffer.isBuffer(embedding)) {
    const s = embedding.toString('utf8').trim();
    if (s.startsWith('[')) return s;
    try {
      const parsed = JSON.parse(s) as number[];
      return `[${parsed.join(',')}]`;
    } catch {
      return null;
    }
  }

  return null;
}

async function syncPaperSections() {
  console.log('🔄 Syncing paper_sections (local Postgres → production Postgres)...\n');

  const prodUrl = requirePostgresUrl('DATABASE_URL');
  const localUrl = requirePostgresUrl('LOCAL_DATABASE_URL');

  const localPool = new Pool({
    connectionString: localUrl,
    ssl: localUrl.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  });

  const prodPool = new Pool({
    connectionString: prodUrl,
    ssl: prodUrl.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await localPool.query('SELECT 1');
    await prodPool.query('SELECT 1');
    console.log('  ✅ Connected to local + production PostgreSQL\n');

    // Ensure paper_sections table exists in prod (mirrors prior script behavior)
    console.log('🔧 Ensuring paper_sections table exists in production...');

    const adsPapersCheck = await prodPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ads_papers'
      ) AS exists;
    `);

    if (!adsPapersCheck.rows[0].exists) {
      console.log('  ⚠️  ads_papers table does not exist, creating it first...');
      await prodPool.query(`
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

    await prodPool.query(`
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

    try {
      const fkCheck = await prodPool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'paper_sections'
          AND constraint_type = 'FOREIGN KEY'
          AND constraint_name LIKE '%bibcode%'
      `);

      if (fkCheck.rows.length === 0 && adsPapersCheck.rows[0].exists) {
        await prodPool.query(`
          ALTER TABLE paper_sections
          ADD CONSTRAINT paper_sections_bibcode_fkey
          FOREIGN KEY (bibcode) REFERENCES ads_papers(bibcode) ON DELETE CASCADE;
        `);
      }
    } catch {
      console.log('  ℹ️  Foreign key constraint skipped (may already exist or ads_papers missing)');
    }

    await prodPool.query(`
      CREATE INDEX IF NOT EXISTS idx_paper_sections_bibcode
      ON paper_sections(bibcode);
    `);

    try {
      await prodPool.query(`
        CREATE INDEX IF NOT EXISTS idx_paper_sections_embedding
        ON paper_sections USING hnsw (embedding vector_cosine_ops);
      `);
      console.log('  ✅ Vector index created\n');
    } catch {
      console.log('  ⚠️  Vector index creation skipped (pgvector may not be enabled)\n');
    }

    console.log('  ✅ Table schema ready\n');

    const sectionsResult = await localPool.query(`
      SELECT id, bibcode, section_id, section_title, level, summary,
             full_text, char_start, char_end, embedding, created_at, updated_at
      FROM paper_sections
      ORDER BY bibcode, char_start
    `);

    const sections = sectionsResult.rows as Array<{
      id: string;
      bibcode: string;
      section_id: string;
      section_title: string;
      level: number;
      summary: string;
      full_text: string;
      char_start: number;
      char_end: number;
      embedding: unknown;
      created_at: number;
      updated_at: number;
    }>;

    console.log(`📊 Found ${sections.length} sections in local Postgres\n`);

    if (sections.length === 0) {
      console.log('  ℹ️  No sections to sync');
      return;
    }

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

    const batchSize = 50;
    for (let i = 0; i < sections.length; i += batchSize) {
      const batch = sections.slice(i, i + batchSize);

      for (const row of batch) {
        try {
          const sanitizeText = (text: string | null): string => {
            if (!text) return '';
            return text.replace(/\0/g, '');
          };

          const sectionTitle = sanitizeText(row.section_title);
          const summary = sanitizeText(row.summary);
          const fullText = sanitizeText(row.full_text);

          const vectorStr = embeddingToVectorString(row.embedding);

          const existing = await prodPool.query(
            'SELECT id FROM paper_sections WHERE bibcode = $1 AND section_id = $2',
            [row.bibcode, row.section_id]
          );

          await prodPool.query(sql, [
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

      const progress = Math.min(i + batchSize, sections.length);
      process.stdout.write(`\r  Progress: ${progress}/${sections.length} sections processed...`);
    }

    console.log('\n\n📊 Sync Summary:');
    console.log(`  ✅ Inserted: ${inserted}`);
    console.log(`  🔄 Updated: ${updated}`);
    console.log(`  ❌ Errors: ${errors}`);
    console.log(`  📦 Total: ${sections.length}`);

    const prodCount = await prodPool.query('SELECT COUNT(*)::bigint AS count FROM paper_sections');
    console.log(`\n  📊 Sections in production: ${prodCount.rows[0].count}`);
  } catch (error) {
    console.error('\n❌ Sync failed:', error);
    process.exit(1);
  } finally {
    await localPool.end();
    await prodPool.end();
  }
}

syncPaperSections().catch(console.error);
