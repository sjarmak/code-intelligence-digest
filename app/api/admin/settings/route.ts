/**
 * GET /api/admin/settings
 * POST /api/admin/settings
 * 
 * Get or update admin settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAdminSetting, setAdminSetting } from '@/src/lib/db/item-relevance';
import { logger } from '@/src/lib/logger';
import { blockInProduction } from '@/src/lib/auth/guards';

interface SettingsResponse {
  enableItemRelevanceTuning: boolean;
  [key: string]: unknown;
}

export async function GET(): Promise<NextResponse> {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    const enableItemRelevanceTuning = getAdminSetting('enable_item_relevance_tuning') === 'true';

    const settings: SettingsResponse = {
      enableItemRelevanceTuning,
    };

    return NextResponse.json(settings);
  } catch (error) {
    logger.error('[SETTINGS] Failed to get settings', error);

    return NextResponse.json(
      {
        error: 'Failed to get settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    const body = await request.json() as Record<string, unknown>;

    // Update enableItemRelevanceTuning
    if ('enableItemRelevanceTuning' in body) {
      const enabled = body.enableItemRelevanceTuning === true;
      setAdminSetting('enable_item_relevance_tuning', enabled ? 'true' : 'false');
      logger.info(`Updated enableItemRelevanceTuning: ${enabled}`);
    }

    // Return updated settings
    const enableItemRelevanceTuning = getAdminSetting('enable_item_relevance_tuning') === 'true';

    const settings: SettingsResponse = {
      enableItemRelevanceTuning,
    };

    return NextResponse.json({
      success: true,
      settings,
    });
  } catch (error) {
    logger.error('[SETTINGS] Failed to update settings', error);

    return NextResponse.json(
      {
        error: 'Failed to update settings',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
