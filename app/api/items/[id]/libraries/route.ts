/**
 * GET /api/items/[id]/libraries
 * Check if an item is in saved items or digest items libraries (per-user).
 * Production uses PostgreSQL only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDbClient } from "@/src/lib/db/driver";
import { auth } from "@/src/auth";
import { LEGACY_USER_ID } from "@/src/lib/db/constants";

async function checkItemInLibraries(
  itemId: string,
  userId: string
): Promise<{ inSavedItems: boolean; inDigestItems: boolean }> {
  try {
    const db = await getDbClient();
    let inSavedItems = false;
    let inDigestItems = false;

    try {
      const savedResult = await db.query(
        `SELECT 1 FROM saved_items WHERE user_id = ? AND item_id = ? LIMIT 1`,
        [userId, itemId]
      );
      inSavedItems = savedResult.rows.length > 0;
    } catch {
      // Table might not exist, that's okay
    }

    try {
      const digestResult = await db.query(
        `SELECT 1 FROM digest_items WHERE user_id = ? AND item_id = ? LIMIT 1`,
        [userId, itemId]
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
    const session = await auth();
    const userId = session?.user?.id ?? LEGACY_USER_ID;
    const { id } = await params;
    const itemId = decodeURIComponent(id);

    const { inSavedItems, inDigestItems } = await checkItemInLibraries(
      itemId,
      userId
    );

    return NextResponse.json({
      itemId,
      inSavedItems,
      inDigestItems,
      userId,
    });
  } catch (error) {
    console.error("Error checking item libraries:", error);
    return NextResponse.json(
      { error: "Failed to check item libraries", inSavedItems: false, inDigestItems: false },
      { status: 500 }
    );
  }
}
