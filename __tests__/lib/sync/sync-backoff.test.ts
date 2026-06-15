/**
 * Tests for the sync circuit breaker + exponential backoff (bd-kc1).
 *
 * Before bd-kc1, daily-sync handled Inoreader failures two wrong ways:
 *   - auth/config errors paused the sync and required a manual clear to recover;
 *   - 429s exited cleanly and the hourly cron retried forever with no backoff.
 *
 * sync-backoff wraps the pure backoff math (src/lib/backoff) with persistence in
 * the cache_metadata KV so failures accumulate across runs and the retry window
 * grows exponentially, then auto-recovers. The cache layer is mocked with an
 * in-memory store and the clock is faked, so these tests are deterministic and
 * need no Postgres.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface StoredRow {
  count: number;
  expiresAt: number;
  lastRefreshAt: number;
}

const store = new Map<string, StoredRow>();

vi.mock('@/src/lib/db/cache', () => ({
  getCacheMetadata: vi.fn(async (key: string) => {
    const row = store.get(key);
    return row
      ? { key, count: row.count, expiresAt: row.expiresAt, lastRefreshAt: row.lastRefreshAt }
      : null;
  }),
  // Mirror the real setCacheMetadata: expiresAt = now + ttlSeconds (epoch seconds).
  setCacheMetadata: vi.fn(async (key: string, count: number, ttlSeconds: number) => {
    const now = Math.floor(Date.now() / 1000);
    store.set(key, { count, expiresAt: now + ttlSeconds, lastRefreshAt: now });
  }),
}));

import {
  getCircuitState,
  recordSyncFailure,
  resetSyncBackoff,
} from '@/src/lib/sync/sync-backoff';

const SYNC_ID = 'daily-sync';
// Matches backoff.ts: INITIAL_DELAY_MS = 60s, BACKOFF_MULTIPLIER = 2, MAX_DELAY_MS = 8h.
const INITIAL_DELAY_S = 60;
const MAX_DELAY_S = 8 * 60 * 60;
const START_MS = 1_700_000_000_000;

beforeEach(() => {
  store.clear();
  vi.useFakeTimers();
  vi.setSystemTime(START_MS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sync-backoff circuit breaker', () => {
  it('reports a closed circuit when no failures have been recorded', async () => {
    const state = await getCircuitState(SYNC_ID);
    expect(state.open).toBe(false);
    expect(state.attempts).toBe(0);
    expect(state.nextRetryAt).toBe(0);
  });

  it('opens the circuit on the first failure with the initial backoff delay', async () => {
    const result = await recordSyncFailure(SYNC_ID, '429');
    expect(result.open).toBe(true);
    expect(result.attempts).toBe(1);

    const nowS = Math.floor(START_MS / 1000);
    expect(result.nextRetryAt).toBe(nowS + INITIAL_DELAY_S);

    const state = await getCircuitState(SYNC_ID);
    expect(state.open).toBe(true);
    expect(state.attempts).toBe(1);
  });

  it('grows the retry delay exponentially across consecutive failures', async () => {
    const nowS = Math.floor(START_MS / 1000);

    const first = await recordSyncFailure(SYNC_ID, 'auth');
    expect(first.nextRetryAt).toBe(nowS + INITIAL_DELAY_S); // 60s

    const second = await recordSyncFailure(SYNC_ID, 'auth');
    expect(second.attempts).toBe(2);
    expect(second.nextRetryAt).toBe(nowS + INITIAL_DELAY_S * 2); // 120s

    const third = await recordSyncFailure(SYNC_ID, 'auth');
    expect(third.attempts).toBe(3);
    expect(third.nextRetryAt).toBe(nowS + INITIAL_DELAY_S * 4); // 240s
  });

  it('caps the backoff delay at the configured maximum', async () => {
    // Drive enough failures that the uncapped delay would exceed MAX_DELAY.
    let last = await recordSyncFailure(SYNC_ID, 'persistent');
    for (let i = 0; i < 14; i++) {
      last = await recordSyncFailure(SYNC_ID, 'persistent');
    }
    const nowS = Math.floor(START_MS / 1000);
    expect(last.nextRetryAt).toBe(nowS + MAX_DELAY_S);
  });

  it('half-opens the circuit once the backoff window elapses', async () => {
    await recordSyncFailure(SYNC_ID, '429');

    // Still inside the window -> open.
    vi.setSystemTime(START_MS + (INITIAL_DELAY_S - 1) * 1000);
    expect((await getCircuitState(SYNC_ID)).open).toBe(true);

    // Past the window -> half-open (retry allowed), attempt count preserved.
    vi.setSystemTime(START_MS + (INITIAL_DELAY_S + 1) * 1000);
    const state = await getCircuitState(SYNC_ID);
    expect(state.open).toBe(false);
    expect(state.attempts).toBe(1);
  });

  it('closes the circuit and resets the attempt counter on success', async () => {
    await recordSyncFailure(SYNC_ID, '429');
    await recordSyncFailure(SYNC_ID, '429');
    expect((await getCircuitState(SYNC_ID)).attempts).toBe(2);

    await resetSyncBackoff(SYNC_ID);
    const state = await getCircuitState(SYNC_ID);
    expect(state.open).toBe(false);
    expect(state.attempts).toBe(0);
  });

  it('restarts backoff from the initial delay after a reset', async () => {
    await recordSyncFailure(SYNC_ID, '429');
    await recordSyncFailure(SYNC_ID, '429');
    await resetSyncBackoff(SYNC_ID);

    const afterReset = await recordSyncFailure(SYNC_ID, '429');
    expect(afterReset.attempts).toBe(1);
    const nowS = Math.floor(START_MS / 1000);
    expect(afterReset.nextRetryAt).toBe(nowS + INITIAL_DELAY_S);
  });

  it('tracks circuits for distinct syncs independently', async () => {
    await recordSyncFailure('daily-sync', '429');
    expect((await getCircuitState('daily-sync')).open).toBe(true);
    expect((await getCircuitState('weekly-sync')).open).toBe(false);
  });
});
