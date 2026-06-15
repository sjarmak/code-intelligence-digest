/**
 * Circuit breaker + exponential backoff for resumable syncs (bd-kc1).
 *
 * Before bd-kc1, daily-sync handled Inoreader failures two ways, both wrong:
 *   - auth/config errors paused the sync and required a manual clear to recover;
 *   - 429s exited cleanly and the hourly cron retried forever with no backoff.
 *
 * This wraps the pure backoff math in ./backoff with persistence in the
 * cache_metadata KV table, so consecutive failures accumulate across runs:
 *   - count           -> consecutive failure attempts
 *   - last_refresh_at -> last failure time (epoch seconds)
 *   - expires_at      -> nextRetryAt (epoch seconds); the circuit is OPEN while now < expires_at
 *
 * Recovery is automatic: once the backoff window elapses the circuit half-opens
 * and the next run may attempt (resuming from the persisted continuation token).
 * A successful sync calls resetSyncBackoff to close the circuit.
 */

import { calculateNextRetry } from "../backoff";
import { getCacheMetadata, setCacheMetadata } from "../db/cache";
import { logger } from "../logger";

const KEY_PREFIX = "sync-backoff:";

function keyFor(syncId: string): string {
  return `${KEY_PREFIX}${syncId}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface CircuitState {
  /** True while the backoff window is still in the future — skip the run. */
  open: boolean;
  /** Consecutive failures recorded so far. */
  attempts: number;
  /** Epoch seconds when the circuit half-opens and a retry is allowed (0 if closed). */
  nextRetryAt: number;
}

/**
 * Read the current circuit state for a sync without mutating it.
 */
export async function getCircuitState(syncId: string): Promise<CircuitState> {
  const meta = await getCacheMetadata(keyFor(syncId));
  const attempts = meta?.count ?? 0;
  const nextRetryAt = meta?.expiresAt ?? 0;

  if (attempts <= 0 || nextRetryAt <= 0) {
    return { open: false, attempts: 0, nextRetryAt: 0 };
  }

  return { open: nextRetryAt > nowSeconds(), attempts, nextRetryAt };
}

/**
 * Record a sync failure and push the next retry out exponentially.
 * Returns the new (open) circuit state.
 */
export async function recordSyncFailure(
  syncId: string,
  reason: string,
): Promise<CircuitState> {
  const existing = await getCacheMetadata(keyFor(syncId));
  const attempts = (existing?.count ?? 0) + 1;

  const nextRetryAtMs = calculateNextRetry(attempts, Date.now());
  const nextRetryAt = Math.floor(nextRetryAtMs / 1000);
  const delaySeconds = Math.max(1, nextRetryAt - nowSeconds());

  await setCacheMetadata(keyFor(syncId), attempts, delaySeconds);

  logger.warn(
    `[SYNC-BACKOFF] ${syncId} failure #${attempts} (${reason}); circuit open until ${new Date(nextRetryAtMs).toISOString()}`,
  );

  return { open: true, attempts, nextRetryAt };
}

/**
 * Clear backoff state after a successful sync (circuit closed, attempts reset).
 * No-op when the circuit is already closed.
 */
export async function resetSyncBackoff(syncId: string): Promise<void> {
  const existing = await getCacheMetadata(keyFor(syncId));
  if (!existing || existing.count === 0) {
    return;
  }

  // count=0 + immediate expiry => getCircuitState reports closed with zero attempts.
  await setCacheMetadata(keyFor(syncId), 0, 0);
  logger.info(`[SYNC-BACKOFF] ${syncId} recovered; circuit closed`);
}
