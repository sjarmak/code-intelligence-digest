#!/usr/bin/env tsx
/**
 * Orphan sweep for stored audio files.
 *
 * Audio bytes are stored before the generated_podcast_audio row is written.
 * When that row never lands — the DB write fails, or the request is abandoned
 * mid-flight — the file is left on disk referenced by nothing, and nothing
 * else ever collects it.
 *
 * This deletes stored objects that no row references and that are older than
 * the grace window. The window matters: a file written seconds ago probably
 * belongs to a render that has not persisted its row yet.
 *
 * Run daily. Start with --dry-run when pointing it at a new store.
 *
 * Usage:
 *   npx tsx scripts/reconcile-audio-storage.ts             # sweep
 *   npx tsx scripts/reconcile-audio-storage.ts --dry-run   # report, no deletes
 *   npx tsx scripts/reconcile-audio-storage.ts --grace-hours=72
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { getLocalStorage } from '../src/lib/storage/local';
import { listReferencedAudioKeys } from '../src/lib/db/podcast-audio';
import {
  reconcileAudioStorage,
  DEFAULT_GRACE_MS,
} from '../src/lib/storage/reconcile-audio';

function parseGraceMs(argv: string[]): number {
  const arg = argv.find((a) => a.startsWith('--grace-hours='));
  if (!arg) return DEFAULT_GRACE_MS;

  const hours = Number(arg.split('=')[1]);
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`--grace-hours must be a non-negative number, got: ${arg.split('=')[1]}`);
  }
  return hours * 60 * 60 * 1000;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const graceMs = parseGraceMs(process.argv);

  const result = await reconcileAudioStorage(
    getLocalStorage(),
    listReferencedAudioKeys,
    { graceMs, dryRun }
  );

  const mb = (result.reclaimedBytes / 1024 / 1024).toFixed(1);
  console.log(
    `${dryRun ? '[dry-run] ' : ''}scanned=${result.scanned} referenced=${result.referenced} ` +
      `within-grace=${result.withinGrace} orphaned=${result.orphaned} ` +
      `deleted=${result.deleted} ${dryRun ? 'reclaimable' : 'reclaimed'}=${mb}MB`
  );

  for (const failure of result.failures) {
    console.error(`failed to delete ${failure.key}: ${failure.error}`);
  }

  // A sweep that could not delete what it identified has not done its job.
  if (result.failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Audio storage reconciliation failed:', error);
  process.exit(1);
});
