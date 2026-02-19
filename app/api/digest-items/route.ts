/**
 * GET /api/digest-items
 * POST /api/digest-items
 * DELETE /api/digest-items
 * Manage digest items library
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { LEGACY_USER_ID } from "@/src/lib/db/constants";
import { getDigestItems, addToDigestItems, addMultipleToDigestItems, removeFromDigestItems, removeMultipleFromDigestItems, removeAllFromDigestItems } from "@/src/lib/db/digestItems";
import { initializeDatabase } from "@/src/lib/db/index";
import { logger } from "@/src/lib/logger";

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const session = await auth();
    const userId = session?.user?.id ?? LEGACY_USER_ID;
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : undefined;

    const items = await getDigestItems(limit, offset, userId);

    return NextResponse.json({
      items,
      count: items.length,
    });
  } catch (error) {
    logger.error("Failed to get digest items", error);
    return NextResponse.json(
      { error: "Failed to get digest items" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    const body = await request.json();
    const session = await auth();
    const userId = session?.user?.id ?? LEGACY_USER_ID;

    // Handle bulk add
    if (Array.isArray(body.itemIds) && body.itemIds.length > 0) {
      const result = await addMultipleToDigestItems(body.itemIds, userId);
      return NextResponse.json({ 
        success: true, 
        message: `${result.success} items added${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
        added: result.success,
        failed: result.failed
      });
    }

    // Handle single item add
    const { itemId } = body;

    if (!itemId || typeof itemId !== "string") {
      return NextResponse.json(
        { error: "itemId is required and must be a string" },
        { status: 400 }
      );
    }

    await addToDigestItems(itemId, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to add item to digest items", error);
    return NextResponse.json(
      { error: "Failed to add item to digest items" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await initializeDatabase();
    const session = await auth();
    const userId = session?.user?.id ?? LEGACY_USER_ID;
    const searchParams = request.nextUrl.searchParams;
    const removeAll = searchParams.get("all") === "true";

    // Handle "remove all" case
    if (removeAll) {
      await removeAllFromDigestItems(userId);
      return NextResponse.json({ success: true, message: "All items removed" });
    }

    // Try to get itemIds from request body (bulk delete)
    try {
      const body = await request.json().catch(() => null);
      if (body && Array.isArray(body.itemIds) && body.itemIds.length > 0) {
        await removeMultipleFromDigestItems(body.itemIds, userId);
        return NextResponse.json({ success: true, message: `${body.itemIds.length} items removed` });
      }
    } catch {
      // If body parsing fails, fall through to single item delete
    }

    // Handle single item delete (backward compatibility)
    const itemId = searchParams.get("itemId");
    if (itemId) {
      await removeFromDigestItems(itemId, userId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "itemId query parameter or itemIds in body is required" },
      { status: 400 }
    );
  } catch (error) {
    logger.error("Failed to remove item(s) from digest items", error);
    return NextResponse.json(
      { error: "Failed to remove item(s) from digest items" },
      { status: 500 }
    );
  }
}
