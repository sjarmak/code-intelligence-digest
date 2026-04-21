#!/usr/bin/env tsx
/**
 * Deletion reconciliation for the production → local mirror.
 *
 * The hourly mirror script is watermark-driven: it sees INSERTs and UPDATEs
 * via updated_at/created_at/scored_at/generated_at but cannot observe hard
 * DELETEs. This script runs daily to reconcile: it pulls the current PK set
 * from prod for each reconcilable table, and deletes from local any rows
 * whose PKs no longer exist upstream.
 *
 * Tables classified "append-only" (item_scores, agent_runs,
 * generated_newsletters, generated_podcast_audio) are skipped — their data
 * model doesn't allow hard deletes.
 *
 * Local-only tables (starred_items, saved_items, item_relevance,
 * user_paper_favorites, user_podcast_audio) are NEVER touched here —
 * they hold user-written state independent of prod.
 *
 * Usage:
 *   npx tsx scripts/mirror-reconcile-deletes.ts              # all tables
 *   npx tsx scripts/mirror-reconcile-deletes.ts --dry-run    # report, no deletes
 *   npx tsx scripts/mirror-reconcile-deletes.ts --only=items # subset (comma-sep)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { Client } from 'pg';
import { from as copyFrom, to as copyTo } from 'pg-copy-streams';
import { pipeline } from 'stream/promises';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface ReconcileTable {
  name: string;
  pk: string[];
}

const RECONCILE_TABLES: ReconcileTable[] = [
  { name: 'items', pk: ['id'] },
  { name: 'item_embeddings', pk: ['item_id'] },
  { name: 'paper_sections', pk: ['id'] },
  { name: 'ads_papers', pk: ['bibcode'] },
  { name: 'digest_items', pk: ['id'] },
  { name: 'paper_annotations', pk: ['id'] },
  { name: 'agent_reports', pk: ['goal', 'id'] },
];

const PROTECTED = new Set([
  'starred_items',
  'saved_items',
  'item_relevance',
  'user_paper_favorites',
  'user_podcast_audio',
  'cache_metadata',
  'user_cache',
  'mirror_watermarks',
]);

function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function assertLocalUrl(url: string): void {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  if (!isLocal) {
    throw new Error(
      `LOCAL_DATABASE_URL host "${host}" is not local; refusing to delete from non-local DB.`
    );
  }
}

async function reconcileTable(
  prod: Client,
  local: Client,
  table: ReconcileTable,
  dryRun: boolean
): Promise<{ localRows: number; prodRows: number; deleted: number; durationMs: number }> {
  const start = Date.now();
  const { name, pk } = table;
  const qTable = quoteIdent(name);
  const pkList = pk.map(quoteIdent).join(', ');

  // Get current counts for reporting.
  const [localCount, prodCount] = await Promise.all([
    local.query(`SELECT COUNT(*)::BIGINT AS c FROM ${qTable}`),
    prod.query(`SELECT COUNT(*)::BIGINT AS c FROM ${qTable}`),
  ]);
  const localRows = Number(localCount.rows[0].c);
  const prodRows = Number(prodCount.rows[0].c);

  // If local has fewer rows than prod, nothing to delete.
  if (localRows <= prodRows - 1) {
    // Still could be stale rows even if local is smaller — e.g., prod added
    // 10 and deleted 5, net +5 but local holds 5 stale. So we still probe.
  }

  // Stream PKs from prod into a temp table on local, then do NOT-IN DELETE.
  const tempTable = `_recon_${name}_${Date.now()}`;
  const qTemp = quoteIdent(tempTable);

  await local.query('BEGIN');
  try {
    // LIKE ... INCLUDING DEFAULTS copies too much; build a minimal temp with just PK cols.
    const pkCols = await Promise.all(
      pk.map((col) =>
        local.query(
          `SELECT data_type FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
          [name, col]
        )
      )
    );
    const pkColDefs = pk
      .map((col, i) => `${quoteIdent(col)} ${pkCols[i].rows[0]?.data_type || 'text'}`)
      .join(', ');
    await local.query(`CREATE TEMP TABLE ${qTemp} (${pkColDefs}) ON COMMIT DROP`);

    const copyOut = `COPY (SELECT ${pkList} FROM ${qTable}) TO STDOUT`;
    const copyIn = `COPY ${qTemp} (${pkList}) FROM STDIN`;
    const source = prod.query(copyTo(copyOut));
    const sink = local.query(copyFrom(copyIn));
    await pipeline(source, sink);

    // Compute staleness: rows in local whose PK is NOT in the prod snapshot.
    const notInClause =
      pk.length === 1
        ? `${quoteIdent(pk[0])} NOT IN (SELECT ${quoteIdent(pk[0])} FROM ${qTemp})`
        : `(${pkList}) NOT IN (SELECT ${pkList} FROM ${qTemp})`;

    const staleRes = await local.query(
      `SELECT COUNT(*)::BIGINT AS c FROM ${qTable} WHERE ${notInClause}`
    );
    const staleCount = Number(staleRes.rows[0].c);

    if (dryRun || staleCount === 0) {
      await local.query('ROLLBACK');
      return {
        localRows,
        prodRows,
        deleted: dryRun ? staleCount : 0,
        durationMs: Date.now() - start,
      };
    }

    // Safety: never delete more than 10% of a table in one run — abort if prod
    // appears empty or catastrophically smaller, to avoid cascading wipeout
    // from a transient prod issue.
    const pctStale = (staleCount / Math.max(localRows, 1)) * 100;
    if (pctStale > 10) {
      await local.query('ROLLBACK');
      throw new Error(
        `refusing to delete ${staleCount} rows from ${name} (${pctStale.toFixed(1)}% of local); ` +
          `run with --dry-run to inspect or investigate prod`
      );
    }

    const delRes = await local.query(
      `DELETE FROM ${qTable} WHERE ${notInClause}`
    );
    await local.query('COMMIT');
    return {
      localRows,
      prodRows,
      deleted: delRes.rowCount ?? 0,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    await local.query('ROLLBACK').catch(() => {});
    throw err;
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
    ? RECONCILE_TABLES.filter((t) => onlySet.has(t.name))
    : RECONCILE_TABLES;

  for (const t of tables) {
    if (PROTECTED.has(t.name)) {
      throw new Error(`Refusing to reconcile protected table: ${t.name}`);
    }
  }

  const prod = new Client({
    connectionString: prodUrl,
    ssl: { rejectUnauthorized: false },
  });
  const local = new Client({ connectionString: localUrl, ssl: false });
  await Promise.all([prod.connect(), local.connect()]);

  console.log(`Reconcile: ${tables.length} tables, dryRun=${dryRun}\n`);

  const startAll = Date.now();
  let totalDeleted = 0;
  let failed = 0;

  for (const t of tables) {
    try {
      const r = await reconcileTable(prod, local, t, dryRun);
      totalDeleted += r.deleted;
      const tag = r.deleted === 0 ? '  ' : dryRun ? '🔍' : '🗑️';
      const verb = dryRun ? 'would delete' : 'deleted';
      console.log(
        `  ${tag} ${t.name.padEnd(20)}  prod=${r.prodRows.toString().padStart(6)}  local=${r.localRows.toString().padStart(6)}  ${verb}=${r.deleted.toString().padStart(4)}  ${r.durationMs}ms`
      );
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ ${t.name.padEnd(20)}  FAILED: ${msg}`);
    }
  }

  await Promise.all([prod.end(), local.end()]);
  const totalMs = Date.now() - startAll;
  console.log(
    `\n${failed === 0 ? '✅' : '⚠️'}  ${tables.length - failed}/${tables.length} tables, ${totalDeleted} rows ${dryRun ? 'would be' : ''} deleted, ${totalMs}ms`
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
