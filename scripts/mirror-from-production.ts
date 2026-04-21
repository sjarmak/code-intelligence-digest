#!/usr/bin/env tsx
/**
 * Hourly production → local Postgres mirror.
 *
 * Pulls row-level deltas from prod using watermark columns (per table),
 * streams them via COPY into a temp table, then upserts into the local
 * table. Snapshot tables are truncated + re-copied each run. Tables
 * classified as "local-only" (user-written state) and pure caches are
 * never touched. Watermarks live in the local `mirror_watermarks` table.
 *
 * Usage:
 *   npx tsx scripts/mirror-from-production.ts              # all tables
 *   npx tsx scripts/mirror-from-production.ts --only=items # subset (comma-sep)
 *   npx tsx scripts/mirror-from-production.ts --dry-run    # report, no writes
 *
 * Env (via .env.local):
 *   PRODUCTION_DATABASE_URL - prod Postgres
 *   LOCAL_DATABASE_URL      - local Postgres (must be local host)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { Client } from 'pg';
import { from as copyFrom, to as copyTo } from 'pg-copy-streams';
import { pipeline } from 'stream/promises';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

type Strategy = 'incremental' | 'snapshot';

interface MirrorTable {
  name: string;
  strategy: Strategy;
  pk: string[];
  watermarkCol?: string;
}

// Ordering matters: parent tables before FK-dependent children so upserts
// in a fresh mirror can satisfy constraints row-by-row.
const MIRROR_TABLES: MirrorTable[] = [
  // Parents (no incoming FKs from mirrored tables)
  { name: 'feeds', strategy: 'snapshot', pk: ['id'] },
  { name: 'items', strategy: 'incremental', pk: ['id'], watermarkCol: 'updated_at' },
  { name: 'ads_papers', strategy: 'incremental', pk: ['bibcode'], watermarkCol: 'updated_at' },
  { name: 'paper_sections', strategy: 'incremental', pk: ['id'], watermarkCol: 'updated_at' },
  { name: 'paper_tags', strategy: 'snapshot', pk: ['id'] },
  { name: 'ads_libraries', strategy: 'snapshot', pk: ['id'] },
  { name: 'agent_runs', strategy: 'incremental', pk: ['id'], watermarkCol: 'created_at' },
  { name: 'generated_newsletters', strategy: 'incremental', pk: ['id'], watermarkCol: 'created_at' },
  { name: 'generated_podcast_audio', strategy: 'incremental', pk: ['id'], watermarkCol: 'created_at' },
  { name: 'agent_reports', strategy: 'incremental', pk: ['goal', 'id'], watermarkCol: 'generated_at' },
  // Small snapshot tables
  { name: 'usage_quota', strategy: 'snapshot', pk: ['key'] },
  { name: 'digest_selections', strategy: 'snapshot', pk: ['id'] },
  { name: 'global_api_budget', strategy: 'snapshot', pk: ['date'] },
  { name: 'sync_state', strategy: 'snapshot', pk: ['id'] },
  { name: 'admin_settings', strategy: 'snapshot', pk: ['key'] },
  // Children (depend on parents above)
  { name: 'item_embeddings', strategy: 'incremental', pk: ['item_id'], watermarkCol: 'generated_at' },
  { name: 'item_scores', strategy: 'incremental', pk: ['item_id', 'scored_at'], watermarkCol: 'scored_at' },
  { name: 'digest_items', strategy: 'incremental', pk: ['id'], watermarkCol: 'updated_at' },
  { name: 'paper_annotations', strategy: 'incremental', pk: ['id'], watermarkCol: 'updated_at' },
  { name: 'paper_tag_links', strategy: 'snapshot', pk: ['bibcode', 'tag_id'] },
  { name: 'ads_library_papers', strategy: 'snapshot', pk: ['library_id', 'bibcode'] },
];

// Defensive: never touch user-written or cache tables.
const PROTECTED_TABLES = new Set([
  'starred_items',
  'saved_items',
  'item_relevance',
  'user_paper_favorites',
  'user_podcast_audio',
  'cache_metadata',
  'user_cache',
  'mirror_watermarks', // state owned by this script
]);

interface TableResult {
  name: string;
  strategy: Strategy;
  rowsSynced: number;
  durationMs: number;
  error?: string;
}

async function ensureWatermarksTable(local: Client): Promise<void> {
  await local.query(`
    CREATE TABLE IF NOT EXISTS mirror_watermarks (
      table_name TEXT PRIMARY KEY,
      last_watermark BIGINT NOT NULL DEFAULT 0,
      last_synced_at BIGINT NOT NULL DEFAULT 0,
      rows_synced BIGINT NOT NULL DEFAULT 0
    )
  `);
}

async function getWatermark(local: Client, tableName: string): Promise<number> {
  const r = await local.query(
    `SELECT last_watermark FROM mirror_watermarks WHERE table_name = $1`,
    [tableName]
  );
  return r.rows.length > 0 ? Number(r.rows[0].last_watermark) : 0;
}

async function setWatermark(
  local: Client,
  tableName: string,
  watermark: number,
  rowsSynced: number
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await local.query(
    `INSERT INTO mirror_watermarks (table_name, last_watermark, last_synced_at, rows_synced)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (table_name) DO UPDATE SET
       last_watermark = EXCLUDED.last_watermark,
       last_synced_at = EXCLUDED.last_synced_at,
       rows_synced = mirror_watermarks.rows_synced + EXCLUDED.rows_synced`,
    [tableName, watermark, now, rowsSynced]
  );
}

async function getColumns(client: Client, tableName: string): Promise<string[]> {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return r.rows.map((x) => x.column_name);
}

function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

async function syncIncremental(
  prod: Client,
  local: Client,
  table: MirrorTable,
  dryRun: boolean
): Promise<number> {
  const { name, pk, watermarkCol } = table;
  if (!watermarkCol) throw new Error(`${name}: incremental requires watermarkCol`);

  const [prodCols, localCols] = await Promise.all([
    getColumns(prod, name),
    getColumns(local, name),
  ]);
  // Only sync columns that exist in BOTH — defensive against schema drift.
  const cols = prodCols.filter((c) => localCols.includes(c));
  if (cols.length === 0) {
    throw new Error(`${name}: no columns in common between prod and local`);
  }
  const colList = cols.map(quoteIdent).join(', ');

  const watermark = await getWatermark(local, name);
  const qTable = quoteIdent(name);
  const qWatermark = quoteIdent(watermarkCol);

  const countRes = await prod.query(
    `SELECT COUNT(*)::BIGINT AS c, COALESCE(MAX(${qWatermark}), 0)::BIGINT AS m
     FROM ${qTable} WHERE ${qWatermark} > $1`,
    [watermark]
  );
  const rowCount = Number(countRes.rows[0].c);
  const maxWatermark = Number(countRes.rows[0].m);

  if (rowCount === 0) {
    return 0;
  }
  if (dryRun) {
    console.log(
      `    [dry-run] ${name}: ${rowCount} rows since watermark ${watermark}, new watermark would be ${maxWatermark}`
    );
    return rowCount;
  }

  const tempTable = `_sync_${name}_${Date.now()}`;
  const qTemp = quoteIdent(tempTable);

  await local.query('BEGIN');
  try {
    await local.query(
      `CREATE TEMP TABLE ${qTemp} (LIKE ${qTable} INCLUDING DEFAULTS) ON COMMIT DROP`
    );

    const copyOutSql = `COPY (SELECT ${colList} FROM ${qTable} WHERE ${qWatermark} > ${watermark}) TO STDOUT`;
    const copyInSql = `COPY ${qTemp} (${colList}) FROM STDIN`;

    const sourceStream = prod.query(copyTo(copyOutSql));
    const sinkStream = local.query(copyFrom(copyInSql));
    await pipeline(sourceStream, sinkStream);

    const updateCols = cols.filter((c) => !pk.includes(c));
    if (updateCols.length === 0) {
      // PK-only table; ON CONFLICT DO NOTHING is enough.
      await local.query(
        `INSERT INTO ${qTable} (${colList}) SELECT ${colList} FROM ${qTemp}
         ON CONFLICT (${pk.map(quoteIdent).join(', ')}) DO NOTHING`
      );
    } else {
      const updateClause = updateCols
        .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
        .join(', ');
      await local.query(
        `INSERT INTO ${qTable} (${colList}) SELECT ${colList} FROM ${qTemp}
         ON CONFLICT (${pk.map(quoteIdent).join(', ')}) DO UPDATE SET ${updateClause}`
      );
    }

    await setWatermark(local, name, maxWatermark, rowCount);
    await local.query('COMMIT');
    return rowCount;
  } catch (err) {
    await local.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

async function syncSnapshot(
  prod: Client,
  local: Client,
  table: MirrorTable,
  dryRun: boolean
): Promise<number> {
  const { name } = table;
  const [prodCols, localCols] = await Promise.all([
    getColumns(prod, name),
    getColumns(local, name),
  ]);
  const cols = prodCols.filter((c) => localCols.includes(c));
  if (cols.length === 0) {
    throw new Error(`${name}: no columns in common between prod and local`);
  }
  const colList = cols.map(quoteIdent).join(', ');
  const qTable = quoteIdent(name);

  const countRes = await prod.query(`SELECT COUNT(*)::BIGINT AS c FROM ${qTable}`);
  const rowCount = Number(countRes.rows[0].c);

  if (dryRun) {
    console.log(`    [dry-run] ${name}: would snapshot ${rowCount} rows`);
    return rowCount;
  }

  await local.query('BEGIN');
  try {
    await local.query(`TRUNCATE ${qTable} CASCADE`);
    const copyOutSql = `COPY (SELECT ${colList} FROM ${qTable}) TO STDOUT`;
    const copyInSql = `COPY ${qTable} (${colList}) FROM STDIN`;
    const sourceStream = prod.query(copyTo(copyOutSql));
    const sinkStream = local.query(copyFrom(copyInSql));
    await pipeline(sourceStream, sinkStream);
    await local.query('COMMIT');
    return rowCount;
  } catch (err) {
    await local.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

function assertLocalUrl(url: string): void {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  if (!isLocal) {
    throw new Error(
      `LOCAL_DATABASE_URL host "${host}" is not local; refusing to run to avoid writing to prod.`
    );
  }
}

async function main() {
  const prodUrl = process.env.PRODUCTION_DATABASE_URL;
  const localUrl = process.env.LOCAL_DATABASE_URL;
  if (!prodUrl) throw new Error('PRODUCTION_DATABASE_URL not set');
  if (!localUrl) throw new Error('LOCAL_DATABASE_URL not set');
  if (prodUrl === localUrl) throw new Error('PRODUCTION and LOCAL URLs are identical');
  assertLocalUrl(localUrl);

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const onlySet = onlyArg
    ? new Set(onlyArg.split('=')[1].split(',').map((s) => s.trim()))
    : null;

  const tables = onlySet
    ? MIRROR_TABLES.filter((t) => onlySet.has(t.name))
    : MIRROR_TABLES;

  for (const t of tables) {
    if (PROTECTED_TABLES.has(t.name)) {
      throw new Error(`Refusing to sync protected table: ${t.name}`);
    }
  }

  const prod = new Client({
    connectionString: prodUrl,
    ssl: { rejectUnauthorized: false },
  });
  const local = new Client({ connectionString: localUrl, ssl: false });
  await Promise.all([prod.connect(), local.connect()]);

  console.log(`Mirror: ${tables.length} tables, dryRun=${dryRun}\n`);
  await ensureWatermarksTable(local);

  const startAll = Date.now();
  const results: TableResult[] = [];

  for (const t of tables) {
    const start = Date.now();
    try {
      const rows =
        t.strategy === 'incremental'
          ? await syncIncremental(prod, local, t, dryRun)
          : await syncSnapshot(prod, local, t, dryRun);
      const durationMs = Date.now() - start;
      results.push({
        name: t.name,
        strategy: t.strategy,
        rowsSynced: rows,
        durationMs,
      });
      const tag = rows === 0 ? '  ' : '✅';
      console.log(`  ${tag} ${t.strategy.padEnd(11)} ${t.name.padEnd(30)} ${rows.toString().padStart(6)} rows  ${durationMs}ms`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - start;
      results.push({
        name: t.name,
        strategy: t.strategy,
        rowsSynced: 0,
        durationMs,
        error: msg,
      });
      console.error(`  ❌ ${t.strategy.padEnd(11)} ${t.name.padEnd(30)} FAILED  ${durationMs}ms`);
      console.error(`     ${msg}`);
    }
  }

  await Promise.all([prod.end(), local.end()]);

  const totalRows = results.reduce((s, r) => s + r.rowsSynced, 0);
  const failed = results.filter((r) => r.error).length;
  const totalMs = Date.now() - startAll;
  console.log(
    `\n${failed === 0 ? '✅' : '⚠️'}  ${results.length - failed}/${results.length} tables, ${totalRows} rows, ${totalMs}ms`
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
