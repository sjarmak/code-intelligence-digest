#!/usr/bin/env tsx
/**
 * Weekly schema-drift check.
 *
 * Compares column sets between production and local Postgres for every
 * table the mirror actively syncs. Reports:
 *
 *   - tables present in prod but missing in local (incoming data would be
 *     silently dropped by the mirror script's "intersect" logic)
 *   - columns present in prod but missing in local (same silent-drop risk)
 *   - columns present in local but missing in prod (harmless, just noise)
 *   - extension deltas
 *
 * Exits non-zero if any PROD-extra shape is detected. Wrapper script runs
 * weekly via launchd; a non-zero exit shows up as a line in the log.
 *
 * Usage:
 *   npx tsx scripts/mirror-check-schema-drift.ts            # human report
 *   npx tsx scripts/mirror-check-schema-drift.ts --json     # JSON report
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface Drift {
  extensionsMissingLocally: string[];
  tablesMissingLocally: string[];
  columnsMissingLocally: Record<string, string[]>;
  columnsMissingInProd: Record<string, string[]>;
}

async function getExtensions(client: Client): Promise<Set<string>> {
  const r = await client.query(`SELECT extname FROM pg_extension`);
  return new Set(r.rows.map((x) => x.extname as string));
}

async function getTables(client: Client): Promise<Set<string>> {
  const r = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  return new Set(r.rows.map((x) => x.tablename as string));
}

async function getColumns(
  client: Client,
  tables: string[]
): Promise<Map<string, Set<string>>> {
  if (tables.length === 0) return new Map();
  const r = await client.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tables]
  );
  const out = new Map<string, Set<string>>();
  for (const row of r.rows) {
    const t = row.table_name as string;
    const c = row.column_name as string;
    if (!out.has(t)) out.set(t, new Set());
    out.get(t)!.add(c);
  }
  return out;
}

function difference<T>(a: Set<T>, b: Set<T>): T[] {
  const out: T[] = [];
  for (const x of a) if (!b.has(x)) out.push(x);
  return out.sort();
}

async function main() {
  const prodUrl = process.env.PRODUCTION_DATABASE_URL;
  const localUrl = process.env.LOCAL_DATABASE_URL;
  if (!prodUrl || !localUrl) {
    console.error('PRODUCTION_DATABASE_URL and LOCAL_DATABASE_URL must both be set');
    process.exit(1);
  }

  const asJson = process.argv.includes('--json');
  const prod = new Client({
    connectionString: prodUrl,
    ssl: { rejectUnauthorized: false },
  });
  const local = new Client({ connectionString: localUrl, ssl: false });
  await Promise.all([prod.connect(), local.connect()]);

  const [prodExt, localExt, prodTables, localTables] = await Promise.all([
    getExtensions(prod),
    getExtensions(local),
    getTables(prod),
    getTables(local),
  ]);

  const sharedTables = [...prodTables].filter((t) => localTables.has(t));
  const [prodCols, localCols] = await Promise.all([
    getColumns(prod, sharedTables),
    getColumns(local, sharedTables),
  ]);

  const drift: Drift = {
    extensionsMissingLocally: difference(prodExt, localExt),
    tablesMissingLocally: difference(prodTables, localTables),
    columnsMissingLocally: {},
    columnsMissingInProd: {},
  };

  for (const table of sharedTables) {
    const p = prodCols.get(table) ?? new Set();
    const l = localCols.get(table) ?? new Set();
    const prodExtra = difference(p, l);
    const localExtra = difference(l, p);
    if (prodExtra.length) drift.columnsMissingLocally[table] = prodExtra;
    if (localExtra.length) drift.columnsMissingInProd[table] = localExtra;
  }

  await Promise.all([prod.end(), local.end()]);

  if (asJson) {
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), drift }, null, 2));
  } else {
    const issues: string[] = [];

    if (drift.extensionsMissingLocally.length) {
      issues.push(
        `Extensions missing locally: ${drift.extensionsMissingLocally.join(', ')}`
      );
    }
    if (drift.tablesMissingLocally.length) {
      issues.push(
        `Tables missing locally: ${drift.tablesMissingLocally.join(', ')}`
      );
    }
    for (const [t, cols] of Object.entries(drift.columnsMissingLocally)) {
      issues.push(`${t}: prod has columns not in local: ${cols.join(', ')}`);
    }
    for (const [t, cols] of Object.entries(drift.columnsMissingInProd)) {
      issues.push(`${t}: local has columns not in prod: ${cols.join(', ')} (harmless)`);
    }

    const prodExtraColsCount = Object.keys(drift.columnsMissingLocally).length;
    const driftySeverity = prodExtraColsCount + drift.tablesMissingLocally.length + drift.extensionsMissingLocally.length;

    if (issues.length === 0) {
      console.log('✅ No schema drift detected.');
    } else {
      if (driftySeverity > 0) {
        console.log('⚠️  Schema drift detected — mirror may be silently dropping data:\n');
      } else {
        console.log('ℹ️  Schema drift detected (local-only changes, harmless):\n');
      }
      for (const issue of issues) console.log(`  - ${issue}`);
      console.log('\nAction: update local schema via bash scripts/mirror-bootstrap.sh --keep-data --schema-only');
    }

    // Exit non-zero only if prod has shape local doesn't — this is the dangerous
    // case where mirror script's "column intersect" drops data.
    process.exit(driftySeverity > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
