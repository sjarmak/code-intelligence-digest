/**
 * GET /api/items/[itemId]/libraries
 * Check if item is in saved_items and/or digest_items
 */

import { NextRequest, NextResponse } from "next/server";
import { isInSavedItems } from "@/src/lib/db/savedItems";
import { isInDigestItems } from "@/src/lib/db/digestItems";
import { initializeDatabase } from "@/src/lib/db/index";
import { logger } from "@/src/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    await initializeDatabase();
    const { itemId } = await params;

    if (!itemId) {
      return NextResponse.json(
        { error: "itemId is required" },
        { status: 400 }
      );
    }

    const [inSavedItems, inDigestItems] = await Promise.all([
      isInSavedItems(itemId),
      isInDigestItems(itemId),
    ]);

    return NextResponse.json({
      inSavedItems,
      inDigestItems,
    });
  } catch (error) {
    logger.error("Failed to check item library membership", error);
    return NextResponse.json(
      { error: "Failed to check item library membership" },
      { status: 500 }
    );
  }
}
