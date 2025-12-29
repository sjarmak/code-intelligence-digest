/**
 * Budget Guard: Simplified budget checking for sync operations
 *
 * Philosophy: Check once before starting, then trust increment tracking
 * No redundant checks during execution - single decision point
 */

import { getApiBudget, hasBudgetFor, ApiBudget } from '../db/api-budget';
import { logger } from '../logger';

/**
 * Expected calls per operation
 */
export const OPERATION_COSTS = {
  getUserInfo: 1,
  getSubscriptions: 1,
  getStreamContents: 1,
  dailySyncMin: 1, // Minimum: just getUserInfo if cached
  dailySyncMax: 5, // Maximum: getUserInfo + multiple stream fetches
  weeklySyncMin: 1,
  weeklySyncMax: 3,
} as const;

/**
 * Check if we can start a sync operation
 * Returns budget info and whether we should proceed
 */
export async function checkSyncBudget(
  operation: 'daily' | 'weekly',
  context?: string
): Promise<{
  canProceed: boolean;
  budget: ApiBudget;
  reason?: string;
}> {
  const budget = await getApiBudget();
  const requiredCalls = operation === 'daily'
    ? OPERATION_COSTS.dailySyncMax
    : OPERATION_COSTS.weeklySyncMax;

  // Check if we have enough available budget (after reserve)
  if (budget.available < requiredCalls) {
    const reason = `Insufficient budget: need ${requiredCalls} calls but only ${budget.available} available (${budget.callsUsed}/${budget.quotaLimit} used, ${budget.reserved} reserved)`;
    logger.warn(`[BUDGET] ${context || operation} sync: ${reason}`);
    return {
      canProceed: false,
      budget,
      reason,
    };
  }

  // Log budget status
  const percentUsed = Math.round((budget.callsUsed / budget.quotaLimit) * 100);
  if (percentUsed >= 90) {
    logger.warn(`[BUDGET] ${context || operation} sync: CRITICAL - ${percentUsed}% used (${budget.remaining} remaining, ${budget.available} available after reserve)`);
  } else if (percentUsed >= 75) {
    logger.warn(`[BUDGET] ${context || operation} sync: WARNING - ${percentUsed}% used (${budget.remaining} remaining, ${budget.available} available)`);
  } else {
    logger.info(`[BUDGET] ${context || operation} sync: ${percentUsed}% used (${budget.remaining} remaining, ${budget.available} available)`);
  }

  return {
    canProceed: true,
    budget,
  };
}

