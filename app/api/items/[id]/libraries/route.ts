/**
 * GET /api/items/[id]/libraries
 * Check if an item is in saved items or digest items libraries
 *
 * Uses PostgreSQL when DATABASE_URL is configured, otherwise falls back to SQLite
 */

import { NextRequest, NextResponse } from "next/server";
import { getDbClient, detectDriver } from "@/src/lib/db/driver";

async function checkItemInLibraries(itemId: string): Promise<{ inSavedItems: boolean; inDigestItems: boolean }> {
  try {
    const db = await getDbClient();

    // Check if saved_items table exists and if item is in it
    let inSavedItems = false;
    let inDigestItems = false;

    try {
      const savedResult = await db.query(
        `SELECT 1 FROM saved_items WHERE item_id = ? LIMIT 1`,
        [itemId]
      );
      inSavedItems = savedResult.rows.length > 0;
    } catch {
      // Table might not exist, that's okay
    }

    try {
      const digestResult = await db.query(
        `SELECT 1 FROM digest_items WHERE item_id = ? LIMIT 1`,
        [itemId]
      );
      inDigestItems = digestResult.rows.length > 0;
    } catch {
      // Table might not exist, that's okay
    }

    return { inSavedItems, inDigestItems };
  } catch (error) {
    console.error(`Failed to check libraries for item ${itemId}:`, error);
    return { inSavedItems: false, inDigestItems: false };
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const itemId = decodeURIComponent(id);
    const driver = detectDriver();

    const { inSavedItems, inDigestItems } = await checkItemInLibraries(itemId);

    return NextResponse.json({
      itemId,
      inSavedItems,
      inDigestItems,
      driver,
    });
  } catch (error) {
    console.error("Error checking item libraries:", error);
    return NextResponse.json(
      { error: "Failed to check item libraries", inSavedItems: false, inDigestItems: false },
      { status: 500 }
    );
  }
}
