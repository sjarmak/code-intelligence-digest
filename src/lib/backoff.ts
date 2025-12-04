/**
 * Exponential backoff utilities for handling API failures
 */

import { logger } from "./logger";

export interface BackoffState {
  attempts: number;
  lastFailureAt: number;
  nextRetryAt: number;
}

const BACKOFF_MULTIPLIER = 2; // 2x exponential backoff
const INITIAL_DELAY_MS = 60 * 1000; // 1 minute
const MAX_DELAY_MS = 8 * 60 * 60 * 1000; // 8 hours

// Utility for parsing backoff state from cache metadata keys
// Format: "backoff_feeds_attempts_3_lastFailure_1701700000"
// Exported for future use in cache analysis tools
export function parseBackoffKey(key: string): BackoffState | null {
  const match = key.match(/backoff_(\w+)_attempts_(\d+)_lastFailure_(\d+)/);
  if (!match) return null;

  const attempts = parseInt(match[2], 10);
  const lastFailureAt = parseInt(match[3], 10) * 1000; // Convert to ms

  return {
    attempts,
    lastFailureAt,
    nextRetryAt: calculateNextRetry(attempts, lastFailureAt),
  };
}

/**
 * Calculate next retry time based on attempts and last failure
 */
export function calculateNextRetry(attempts: number, lastFailureAtMs: number): number {
  const delayMs = Math.min(INITIAL_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempts - 1), MAX_DELAY_MS);
  return lastFailureAtMs + delayMs;
}

/**
 * Create a backoff key for storage in cache_metadata
 */
export function createBackoffKey(resource: string, attempts: number, lastFailureAtMs: number): string {
  const lastFailureAt = Math.floor(lastFailureAtMs / 1000);
  return `backoff_${resource}_attempts_${attempts}_lastFailure_${lastFailureAt}`;
}

/**
 * Check if we should retry based on backoff state
 */
export function shouldRetry(state: BackoffState): boolean {
  const now = Date.now();
  return now >= state.nextRetryAt;
}

/**
 * Get human-readable backoff status
 */
export function getBackoffStatus(state: BackoffState): {
  attempts: number;
  lastFailureAge: string;
  nextRetryIn: string;
  canRetry: boolean;
} {
  const now = Date.now();
  const ageMs = now - state.lastFailureAt;
  const remainingMs = Math.max(0, state.nextRetryAt - now);

  const formatTime = (ms: number): string => {
    if (ms < 60 * 1000) return `${Math.round(ms / 1000)}s`;
    if (ms < 60 * 60 * 1000) return `${Math.round(ms / (60 * 1000))}m`;
    return `${Math.round(ms / (60 * 60 * 1000))}h`;
  };

  return {
    attempts: state.attempts,
    lastFailureAge: formatTime(ageMs),
    nextRetryIn: formatTime(remainingMs),
    canRetry: shouldRetry(state),
  };
}

/**
 * Record a failure and return next backoff state
 */
export function recordFailure(attempts: number = 0, lastFailureAtMs: number = Date.now()): BackoffState {
  const nextAttempts = attempts + 1;
  const nextRetryAt = calculateNextRetry(nextAttempts, lastFailureAtMs);

  logger.warn(`API failure recorded (attempt ${nextAttempts}), next retry in ${formatDelay(nextRetryAt - Date.now())}`);

  return {
    attempts: nextAttempts,
    lastFailureAt: lastFailureAtMs,
    nextRetryAt,
  };
}

/**
 * Reset backoff (on successful fetch)
 */
export function resetBackoff(): BackoffState {
  return {
    attempts: 0,
    lastFailureAt: 0,
    nextRetryAt: 0,
  };
}

function formatDelay(delayMs: number): string {
  if (delayMs < 60 * 1000) return `${Math.round(delayMs / 1000)}s`;
  if (delayMs < 60 * 60 * 1000) return `${Math.round(delayMs / (60 * 1000))}m`;
  return `${Math.round(delayMs / (60 * 60 * 1000))}h`;
}
