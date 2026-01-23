/**
 * API endpoint: GET /api/admin/api-budget
 * 
 * Check global Inoreader API call budget across all syncs.
 * Resets at midnight UTC.
 */

import { NextResponse } from 'next/server';
import { initializeDatabase, getGlobalApiBudget } from '@/src/lib/db/index';
import { blockInProduction } from '@/src/lib/auth/guards';

export async function GET() {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    await initializeDatabase();
    
    const budget = getGlobalApiBudget();
    const today = new Date().toISOString().split('T')[0];
    
    return NextResponse.json({
      date: today,
      callsUsed: budget.callsUsed,
      remaining: budget.remaining,
      quotaLimit: budget.quotaLimit,
      percentUsed: Math.round((budget.callsUsed / budget.quotaLimit) * 100),
      message:
        budget.remaining > 10
          ? `Plenty of budget remaining (${budget.remaining}/${budget.quotaLimit})`
          : budget.remaining > 0
            ? `Low budget (${budget.remaining}/${budget.quotaLimit} calls remaining)`
            : `Budget exhausted (${budget.callsUsed}/${budget.quotaLimit})`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to get budget',
      },
      { status: 500 }
    );
  }
}
