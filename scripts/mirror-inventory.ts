#!/usr/bin/env tsx
/**
 * Phase 1 inventory: probe production Postgres for table stats, extensions,
 * FKs, and timestamp column coverage. Output is a markdown table + JSON file
 * that feed into the Phase 2 mirror allow-list classification.
 *
 * Usage: npx tsx scripts/mirror-inventory.ts
 * Requires PRODUCTION_DATABASE_URL in .env.local.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface TableInfo {
  name: string;
  rowCount: number;
  sizeBytes: number;
  sizeHuman: string;
  hasUpdatedAt: boolean;
  hasCreatedAt: boolean;
  timestampCol: string | null;
  hasTimestampIndex: boolean;
  primaryKey: string[];
  fkOutgoing: Array<{ column: string; refTable: string; refColumn: string }>;
  fkIncoming: Array<{ fromTable: string; fromColumn: string }>;
}

async function main() {
  const prodUrl = process.env.PRODUCTION_DATABASE_URL;
  if (!prodUrl) {
    console.error('PRODUCTION_DATABASE_URL not set in .env.local');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: prodUrl,
    ssl: { rejectUnauthorized: false },
  });

  console.log('Connected. Probing...\n');

  const versionResult = await pool.query('SELECT version()');
  console.log('Server:', versionResult.rows[0].version, '\n');

  const extResult = await pool.query(
    `SELECT extname, extversion FROM pg_extension ORDER BY extname`
  );
  console.log('Extensions:');
  for (const r of extResult.rows) {
    console.log(`  - ${r.extname} ${r.extversion}`);
  }
  console.log();

  const tablesResult = await pool.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);

  const tables: TableInfo[] = [];

  for (const { tablename } of tablesResult.rows) {
    const countResult = await pool.query(
      `SELECT COUNT(*)::BIGINT AS c FROM ${JSON.stringify(tablename).replace(/"/g, '"')}`
    );
    const rowCount = Number(countResult.rows[0].c);

    const sizeResult = await pool.query(
      `SELECT pg_total_relation_size($1) AS bytes,
              pg_size_pretty(pg_total_relation_size($1)) AS pretty`,
      [tablename]
    );
    const sizeBytes = Number(sizeResult.rows[0].bytes);
    const sizeHuman = sizeResult.rows[0].pretty;

    const colsResult = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [tablename]
    );
    const columns = colsResult.rows.map((r) => r.column_name);
    const hasUpdatedAt = columns.includes('updated_at');
    const hasLastUpdatedAt = columns.includes('last_updated_at');
    const hasCreatedAt = columns.includes('created_at');
    const timestampCol = hasUpdatedAt
      ? 'updated_at'
      : hasLastUpdatedAt
      ? 'last_updated_at'
      : hasCreatedAt
      ? 'created_at'
      : null;

    let hasTimestampIndex = false;
    if (timestampCol) {
      const idxResult = await pool.query(
        `SELECT indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = $1
           AND indexdef ILIKE '%' || $2 || '%'`,
        [tablename, timestampCol]
      );
      hasTimestampIndex = idxResult.rows.length > 0;
    }

    const pkResult = await pool.query(
      `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary`,
      [`public.${tablename}`]
    );
    const primaryKey = pkResult.rows.map((r) => r.attname);

    const fkOutResult = await pool.query(
      `SELECT
         kcu.column_name,
         ccu.table_name AS ref_table,
         ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND tc.table_name = $1`,
      [tablename]
    );
    const fkOutgoing = fkOutResult.rows.map((r) => ({
      column: r.column_name,
      refTable: r.ref_table,
      refColumn: r.ref_column,
    }));

    const fkInResult = await pool.query(
      `SELECT
         tc.table_name AS from_table,
         kcu.column_name AS from_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND ccu.table_name = $1`,
      [tablename]
    );
    const fkIncoming = fkInResult.rows.map((r) => ({
      fromTable: r.from_table,
      fromColumn: r.from_column,
    }));

    tables.push({
      name: tablename,
      rowCount,
      sizeBytes,
      sizeHuman,
      hasUpdatedAt: hasUpdatedAt || hasLastUpdatedAt,
      hasCreatedAt,
      timestampCol,
      hasTimestampIndex,
      primaryKey,
      fkOutgoing,
      fkIncoming,
    });
  }

  tables.sort((a, b) => b.sizeBytes - a.sizeBytes);

  console.log('| Table | Rows | Size | Timestamp | Idx? | PK | FK out |');
  console.log('|---|---:|---:|---|---|---|---|');
  for (const t of tables) {
    const fk = t.fkOutgoing.map((f) => `${f.column}→${f.refTable}`).join(', ') || '—';
    console.log(
      `| ${t.name} | ${t.rowCount.toLocaleString()} | ${t.sizeHuman} | ${t.timestampCol ?? '—'} | ${t.hasTimestampIndex ? 'y' : 'n'} | ${t.primaryKey.join(',') || '—'} | ${fk} |`
    );
  }

  const totalBytes = tables.reduce((s, t) => s + t.sizeBytes, 0);
  console.log(`\nTotal size: ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB across ${tables.length} tables`);

  const outPath = path.resolve(process.cwd(), 'docs/mirror-inventory.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        probedAt: new Date().toISOString(),
        serverVersion: versionResult.rows[0].version,
        extensions: extResult.rows,
        totalBytes,
        tables,
      },
      null,
      2
    )
  );
  console.log(`\nWrote ${outPath}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
