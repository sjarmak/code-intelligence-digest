/**
 * Orphan sweep for stored audio.
 *
 * An audio file is written before its generated_podcast_audio row is persisted.
 * When the row never lands — the DB write fails, or the request is abandoned
 * mid-flight — the file stays on disk referenced by nothing. Under the local
 * adapter that costs disk; under S3/GCS/R2 it becomes a billing line.
 *
 * The sweep lists stored objects, subtracts everything the database still
 * references, and deletes what is left once it is old enough that no in-flight
 * render could still be about to claim it.
 */

import { logger } from "../logger";
import type { ReconcilableStorage } from "../audio/types";

/**
 * How long an unreferenced object is left alone before it counts as an orphan.
 * Must comfortably outlast a render flight: a file written seconds ago very
 * likely belongs to a request that has not persisted its row yet.
 */
export const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;

export interface ReconcileOptions {
  /** Minimum age before an unreferenced object may be deleted */
  graceMs?: number;
  /** Report what would be deleted without deleting it */
  dryRun?: boolean;
  /** Injectable clock for tests */
  now?: number;
  /**
   * Delete orphans even when the reference set came back empty. That
   * combination is the wrong-database signature, so the sweep refuses it by
   * default; set this only for a store confirmed to be genuinely all-orphan.
   */
  allowEmptyReferenceSet?: boolean;
}

/**
 * Raised when the sweep would delete a whole non-empty store because the
 * database resolved zero references.
 *
 * The wrapper preflight proves LOCAL_DATABASE_URL points at *a* local postgres.
 * It cannot prove it is the instance whose generated_podcast_audio rows back
 * this store. Point the sweep at a second local instance and the reference read
 * succeeds, returns nothing, and every stored object looks orphaned — a silent
 * total deletion rather than an error. Zero references against a non-empty
 * store is that read's exact signature, and is never a steady state once any
 * audio row exists.
 */
export class EmptyReferenceSetError extends Error {
  constructor(
    readonly scanned: number,
    readonly orphaned: number
  ) {
    super(
      `Refusing to sweep: the database resolved no audio references against a non-empty store ` +
        `(scanned=${scanned} referenced=0 orphaned=${orphaned}). This is what reading the wrong ` +
        `database looks like. Confirm LOCAL_DATABASE_URL points at the instance backing this ` +
        `store; pass allowEmptyReferenceSet if the store really is all-orphan.`
    );
    this.name = "EmptyReferenceSetError";
  }
}

export interface ReconcileResult {
  scanned: number;
  referenced: number;
  withinGrace: number;
  orphaned: number;
  deleted: number;
  /** Bytes held by orphans — reclaimed unless this was a dry run */
  reclaimedBytes: number;
  failures: Array<{ key: string; error: string }>;
}

/**
 * Delete stored objects that no database row references.
 *
 * `loadReferencedKeys` is called first and its failure propagates untouched:
 * a partial or failed reference read must never be read as "unreferenced",
 * because that deletes live audio.
 */
export async function reconcileAudioStorage(
  storage: ReconcilableStorage,
  loadReferencedKeys: () => Promise<Set<string>>,
  options: ReconcileOptions = {}
): Promise<ReconcileResult> {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? Date.now();

  // List first, resolve references second. A row persisted between the two
  // reads then lands inside the reference set rather than outside it — the
  // safe direction. The reverse order would classify it as an orphan.
  const objects = await storage.listObjects();
  const referencedKeys = await loadReferencedKeys();

  const result: ReconcileResult = {
    scanned: objects.length,
    referenced: 0,
    withinGrace: 0,
    orphaned: 0,
    deleted: 0,
    reclaimedBytes: 0,
    failures: [],
  };

  // Classify everything before deleting anything: the wrong-database interlock
  // below needs the final counts, and it has to run while the store is intact.
  const orphans: typeof objects = [];
  for (const object of objects) {
    if (referencedKeys.has(object.key)) {
      result.referenced++;
      continue;
    }

    if (now - object.modifiedAtMs < graceMs) {
      result.withinGrace++;
      continue;
    }

    orphans.push(object);
    result.orphaned++;
    result.reclaimedBytes += object.bytes;
  }

  // Gate on orphaned, not scanned: with nothing to delete there is no
  // destructive act to interlock, and a fresh store whose first row has not
  // landed yet would otherwise fail every run.
  if (
    !dryRun &&
    result.orphaned > 0 &&
    result.referenced === 0 &&
    !(options.allowEmptyReferenceSet ?? false)
  ) {
    logger.error("Refusing audio sweep: no references resolved against a non-empty store", {
      scanned: result.scanned,
      orphaned: result.orphaned,
    });
    throw new EmptyReferenceSetError(result.scanned, result.orphaned);
  }

  for (const object of orphans) {
    if (dryRun) continue;

    // One unlink failure (permissions, a racing delete) must not abandon the
    // rest of the sweep — record it and keep going.
    try {
      const removed = await storage.deleteObject(object.key);
      if (removed) {
        result.deleted++;
        logger.info("Deleted orphaned audio object", {
          key: object.key,
          bytes: object.bytes,
          ageHours: Math.round((now - object.modifiedAtMs) / 3_600_000),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failures.push({ key: object.key, error: message });
      logger.error("Failed to delete orphaned audio object", {
        key: object.key,
        error: message,
      });
    }
  }

  logger.info("Audio storage reconciliation complete", {
    ...result,
    failures: result.failures.length,
    dryRun,
    graceHours: Math.round(graceMs / 3_600_000),
  });

  return result;
}
