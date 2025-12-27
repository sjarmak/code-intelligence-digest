#!/usr/bin/env npx tsx
/**
 * SQLite to PostgreSQL Data Migration Script
 *
 * Exports data from local SQLite database and imports to PostgreSQL.
 *
 * Usage:
 *   # Export from SQLite to JSON
 *   npx tsx scripts/migrate-to-postgres.ts export
 *
 *   # Import JSON to PostgreSQL (requires DATABASE_URL)
 *   DATABASE_URL=postgres://... npx tsx scripts/migrate-to-postgres.ts import
 *
 *   # Full migration (export + import)
 *   DATABASE_URL=postgres://... npx tsx scripts/migrate-to-postgres.ts migrate
 */

import Database from 'better-sqlite3';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const SQLITE_PATH = path.join(DATA_DIR, 'digest.db');
const EXPORT_PATH = path.join(DATA_DIR, 'export');

// Tables to migrate (in order due to foreign key constraints)
const TABLES = [
  'feeds',
  'items',
  'item_scores',
  'cache_metadata',
  'digest_selections',
  'sync_state',
  'global_api_budget',
  'user_cache',
  'starred_items',
  'item_relevance',
  'admin_settings',
  'generated_podcast_audio',
  'ads_papers', // Must come before paper_sections (foreign key)
  // Note: item_embeddings and paper_sections require special handling (BLOB -> vector)
];

interface ExportedData {
  table: string;
  columns: string[];
  rows: unknown[][];
  count: number;
}

/**
 * Export all data from SQLite to JSON files
 */
async function exportFromSqlite(): Promise<void> {
  console.log('📤 Exporting data from SQLite...');

  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`❌ SQLite database not found at ${SQLITE_PATH}`);
    process.exit(1);
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  // Create export directory
  if (!fs.existsSync(EXPORT_PATH)) {
    fs.mkdirSync(EXPORT_PATH, { recursive: true });
  }

  let totalRows = 0;

  for (const table of TABLES) {
    try {
      // Get column info
      const columns = sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{ name: string }>;

      if (columns.length === 0) {
        console.log(`  ⚠️  Table ${table} does not exist, skipping`);
        continue;
      }

      const columnNames = columns.map(c => c.name);

      // Get all rows
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();

      const exportData: ExportedData = {
        table,
        columns: columnNames,
        rows: rows.map(row => columnNames.map(col => (row as Record<string, unknown>)[col])),
        count: rows.length,
      };

      // Write to JSON file
      const filePath = path.join(EXPORT_PATH, `${table}.json`);
      fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));

      console.log(`  ✅ ${table}: ${rows.length} rows`);
      totalRows += rows.length;
    } catch (error) {
      console.error(`  ❌ Failed to export ${table}:`, error);
    }
  }

  // Export embeddings separately (BLOB handling)
  try {
    const embeddingRows = sqlite
      .prepare('SELECT item_id, embedding, embedding_model, generated_at FROM item_embeddings')
      .all() as Array<{ item_id: string; embedding: Buffer; embedding_model: string; generated_at: number }>;

    // Convert BLOB to array
    const embeddings = embeddingRows.map(row => ({
      item_id: row.item_id,
      embedding: Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)),
      embedding_model: row.embedding_model,
      generated_at: row.generated_at,
    }));

    const filePath = path.join(EXPORT_PATH, 'item_embeddings.json');
    fs.writeFileSync(filePath, JSON.stringify(embeddings, null, 2));

    console.log(`  ✅ item_embeddings: ${embeddings.length} rows`);
    totalRows += embeddings.length;
  } catch (error) {
    console.log('  ⚠️  item_embeddings: table does not exist or empty');
  }

  // Export paper_sections separately (BLOB handling for embeddings)
  try {
    const sectionRows = sqlite
      .prepare(`
        SELECT id, bibcode, section_id, section_title, level, summary,
               full_text, char_start, char_end, embedding, created_at, updated_at
        FROM paper_sections
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
        embedding: string | null; // JSON string in SQLite
        created_at: number;
        updated_at: number;
      }>;

    // Parse embeddings from JSON strings
    const sections = sectionRows.map(row => ({
      id: row.id,
      bibcode: row.bibcode,
      section_id: row.section_id,
      section_title: row.section_title,
      level: row.level,
      summary: row.summary,
      full_text: row.full_text,
      char_start: row.char_start,
      char_end: row.char_end,
      embedding: row.embedding ? JSON.parse(row.embedding) as number[] : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    const filePath = path.join(EXPORT_PATH, 'paper_sections.json');
    fs.writeFileSync(filePath, JSON.stringify(sections, null, 2));

    console.log(`  ✅ paper_sections: ${sections.length} rows`);
    totalRows += sections.length;
  } catch (error) {
    console.log('  ⚠️  paper_sections: table does not exist or empty');
  }

  sqlite.close();
  console.log(`\n📊 Total: ${totalRows} rows exported to ${EXPORT_PATH}`);
}

/**
 * Sanitize data for PostgreSQL
 */
function sanitizeRow(row: unknown[], columns: string[], table: string): unknown[] {
  return row.map((value, index) => {
    if (value === null || value === undefined) return value;

    // Remove null bytes from text fields (PostgreSQL doesn't support them)
    if (typeof value === 'string') {
      value = value.replace(/\0/g, '');
    }

    // Fix type mismatches for item_scores
    if (table === 'item_scores') {
      const col = columns[index];
      // Convert float to integer for these columns
      if ((col === 'llm_relevance' || col === 'llm_usefulness') && typeof value === 'number') {
        return Math.round(value);
      }
      // Also handle if they're stored as strings
      if ((col === 'llm_relevance' || col === 'llm_usefulness') && typeof value === 'string') {
        return Math.round(parseFloat(value));
      }
    }

    return value;
  });
}

/**
 * Import data from JSON files to PostgreSQL
 */
async function importToPostgres(): Promise<void> {
  console.log('📥 Importing data to PostgreSQL...');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable not set');
    process.exit(1);
  }

  if (!fs.existsSync(EXPORT_PATH)) {
    console.error(`❌ Export directory not found at ${EXPORT_PATH}`);
    console.error('   Run "export" command first');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log('  ✅ Connected to PostgreSQL');

    let totalRows = 0;

    for (const table of TABLES) {
      const filePath = path.join(EXPORT_PATH, `${table}.json`);

      if (!fs.existsSync(filePath)) {
        console.log(`  ⚠️  No export file for ${table}, skipping`);
        continue;
      }

      try {
        const data: ExportedData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        if (data.count === 0) {
          console.log(`  ⏭️  ${table}: 0 rows (empty)`);
          continue;
        }

        // Build INSERT statement
        const columns = data.columns.join(', ');
        const placeholders = data.columns.map((_, i) => `$${i + 1}`).join(', ');
        const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

        // Insert rows in batches
        const batchSize = 100;
        let inserted = 0;

        for (let i = 0; i < data.rows.length; i += batchSize) {
          const batch = data.rows.slice(i, i + batchSize);

          for (const row of batch) {
            try {
              // Sanitize row data before inserting
              const sanitizedRow = sanitizeRow(row, data.columns, table);
              await pool.query(sql, sanitizedRow);
              inserted++;
            } catch (err) {
              // Skip duplicates silently
              if (!(err instanceof Error && err.message.includes('duplicate'))) {
                console.error(`    Error inserting into ${table}:`, err);
              }
            }
          }
        }

        console.log(`  ✅ ${table}: ${inserted}/${data.count} rows`);
        totalRows += inserted;
      } catch (error) {
        console.error(`  ❌ Failed to import ${table}:`, error);
      }
    }

    // Import embeddings (special handling for vector type)
    const embeddingsPath = path.join(EXPORT_PATH, 'item_embeddings.json');
    if (fs.existsSync(embeddingsPath)) {
      try {
        const embeddings = JSON.parse(fs.readFileSync(embeddingsPath, 'utf-8')) as Array<{
          item_id: string;
          embedding: number[];
          embedding_model: string;
          generated_at: number;
        }>;

        const sql = `
          INSERT INTO item_embeddings (item_id, embedding, embedding_model, generated_at)
          VALUES ($1, $2::vector, $3, $4)
          ON CONFLICT (item_id) DO UPDATE SET
            embedding = EXCLUDED.embedding,
            embedding_model = EXCLUDED.embedding_model,
            generated_at = EXCLUDED.generated_at
        `;

        let inserted = 0;
        for (const row of embeddings) {
          try {
            // Convert array to pgvector format: [1,2,3]
            const vectorStr = `[${row.embedding.join(',')}]`;
            await pool.query(sql, [row.item_id, vectorStr, row.embedding_model, row.generated_at]);
            inserted++;
          } catch (err) {
            // Skip errors silently
          }
        }

        console.log(`  ✅ item_embeddings: ${inserted}/${embeddings.length} rows`);
        totalRows += inserted;
      } catch (error) {
        console.error('  ❌ Failed to import embeddings:', error);
      }
    }

    // Import paper_sections (special handling for vector type)
    const paperSectionsPath = path.join(EXPORT_PATH, 'paper_sections.json');
    if (fs.existsSync(paperSectionsPath)) {
      try {
        const sections = JSON.parse(fs.readFileSync(paperSectionsPath, 'utf-8')) as Array<{
          id: string;
          bibcode: string;
          section_id: string;
          section_title: string;
          level: number;
          summary: string;
          full_text: string;
          char_start: number;
          char_end: number;
          embedding: number[] | null;
          created_at: number;
          updated_at: number;
        }>;

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
        for (const row of sections) {
          try {
            // Convert embedding array to pgvector format, or NULL if no embedding
            const vectorStr = row.embedding ? `[${row.embedding.join(',')}]` : null;
            await pool.query(sql, [
              row.id,
              row.bibcode,
              row.section_id,
              row.section_title,
              row.level,
              row.summary,
              row.full_text,
              row.char_start,
              row.char_end,
              vectorStr,
              row.created_at,
              row.updated_at,
            ]);
            inserted++;
          } catch (err) {
            // Log errors for debugging
            if (!(err instanceof Error && err.message.includes('duplicate'))) {
              console.error(`    Error inserting paper_section ${row.id}:`, err instanceof Error ? err.message : String(err));
            }
          }
        }

        console.log(`  ✅ paper_sections: ${inserted}/${sections.length} rows`);
        totalRows += inserted;
      } catch (error) {
        console.error('  ❌ Failed to import paper_sections:', error);
      }
    }

    console.log(`\n📊 Total: ${totalRows} rows imported`);

    // Update search vectors (trigger tsvector generation)
    console.log('\n🔍 Updating search vectors...');
    await pool.query(`
      UPDATE items SET
        updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
      WHERE search_vector IS NULL OR search_vector = ''::tsvector
    `);
    console.log('  ✅ Search vectors updated');

  } finally {
    await pool.end();
  }
}

/**
 * Full migration: export + import
 */
async function migrate(): Promise<void> {
  await exportFromSqlite();
  console.log('\n---\n');
  await importToPostgres();
}

// CLI
const command = process.argv[2];

switch (command) {
  case 'export':
    exportFromSqlite().catch(console.error);
    break;
  case 'import':
    importToPostgres().catch(console.error);
    break;
  case 'migrate':
    migrate().catch(console.error);
    break;
  default:
    console.log(`
SQLite to PostgreSQL Migration Script

Usage:
  npx tsx scripts/migrate-to-postgres.ts <command>

Commands:
  export   Export SQLite data to JSON files
  import   Import JSON files to PostgreSQL (requires DATABASE_URL)
  migrate  Full migration (export + import)

Examples:
  # Export from SQLite
  npx tsx scripts/migrate-to-postgres.ts export

  # Import to PostgreSQL
  DATABASE_URL=postgres://user:pass@host:5432/db npx tsx scripts/migrate-to-postgres.ts import

  # Full migration
  DATABASE_URL=postgres://... npx tsx scripts/migrate-to-postgres.ts migrate
`);
}
