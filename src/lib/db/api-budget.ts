/**
 * Improved API Budget Management
 *
 * Key improvements:
 * 1. Reserve-based approach: Reserve safety margin (default 20 calls) instead of hardcoded thresholds
 * 2. Capped increments: Never exceed quota_limit
 * 3. Single check pattern: Check once before operation, trust increment tracking
 * 4. Operation-aware: Know how many calls each operation needs
 */

import { getDbClient, detectDriver } from './driver';
import { logger } from '../logger';

export interface ApiBudget {
  callsUsed: number;
  remaining: number;
  quotaLimit: number;
  reserved: number; // Safety margin reserved calls
  available: number; // Actually available for use (remaining - reserved)
}

/**
 * Safety margin reserved to prevent hitting the limit
 * This gives us buffer for concurrent operations and edge cases
 */
const SAFETY_RESERVE = 20;

/**
 * Get current API budget status
 */
export async function getApiBudget(): Promise<ApiBudget> {
  const client = await getDbClient();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const result = await client.query(
    'SELECT calls_used, quota_limit FROM global_api_budget WHERE date = ?',
    [today]
  );

  if (result.rows.length === 0) {
    // Initialize for today with default quota of 1000
    const driver = detectDriver();
    const insertSql = driver === 'postgres'
      ? 'INSERT INTO global_api_budget (date, calls_used, quota_limit) VALUES ($1, 0, 1000) ON CONFLICT (date) DO NOTHING'
      : 'INSERT OR IGNORE INTO global_api_budget (date, calls_used, quota_limit) VALUES (?, 0, 1000)';
    await client.run(insertSql, [today]);
    return {
      callsUsed: 0,
      remaining: 1000,
      quotaLimit: 1000,
      reserved: SAFETY_RESERVE,
      available: 1000 - SAFETY_RESERVE, // 980
    };
  }

  const row = result.rows[0] as { calls_used: number; quota_limit: number };
  const remaining = Math.max(0, row.quota_limit - row.calls_used); // Never go negative
  const available = Math.max(0, remaining - SAFETY_RESERVE); // Available after reserve

  return {
    callsUsed: row.calls_used,
    remaining,
    quotaLimit: row.quota_limit,
    reserved: SAFETY_RESERVE,
    available,
  };
}

/**
 * Check if we have enough budget for an operation
 * @param requiredCalls Number of calls the operation needs (default: 1)
 * @returns true if we have enough budget, false otherwise
 */
export async function hasBudgetFor(requiredCalls: number = 1): Promise<boolean> {
  const budget = await getApiBudget();
  return budget.available >= requiredCalls;
}

/**
 * Increment API calls with automatic capping at quota limit
 * This prevents going over the limit even with concurrent operations
 */
export async function incrementApiCalls(count: number): Promise<ApiBudget> {
  const client = await getDbClient();
  const driver = detectDriver();
  const today = new Date().toISOString().split('T')[0];

  // Use atomic increment with capping: never exceed quota_limit
  // SQLite uses MIN(), PostgreSQL uses LEAST()
  const updateSql = driver === 'postgres'
    ? `INSERT INTO global_api_budget (date, calls_used, last_updated_at, quota_limit)
       VALUES ($1, $2, EXTRACT(EPOCH FROM NOW())::INTEGER, 1000)
       ON CONFLICT(date) DO UPDATE SET
         calls_used = LEAST(global_api_budget.calls_used + $3, global_api_budget.quota_limit),
         last_updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER`
    : `INSERT INTO global_api_budget (date, calls_used, quota_limit)
       VALUES (?, ?, 1000)
       ON CONFLICT(date) DO UPDATE SET
         calls_used = MIN(calls_used + ?, quota_limit),
         last_updated_at = strftime('%s', 'now')`;

  await client.run(updateSql, [today, count, count]);

  // Return updated budget
  return await getApiBudget();
}

/**
 * Legacy compatibility: Keep old function name for now
 * @deprecated Use incrementApiCalls instead
 */
export async function incrementGlobalApiCalls(count: number): Promise<{ callsUsed: number; remaining: number }> {
  const budget = await incrementApiCalls(count);
  return {
    callsUsed: budget.callsUsed,
    remaining: budget.remaining,
  };
}

/**
 * Legacy compatibility: Keep old function name for now
 * @deprecated Use getApiBudget instead
 */
export async function getGlobalApiBudget(): Promise<{ callsUsed: number; remaining: number; quotaLimit: number }> {
  const budget = await getApiBudget();
  return {
    callsUsed: budget.callsUsed,
    remaining: budget.remaining,
    quotaLimit: budget.quotaLimit,
  };
}

