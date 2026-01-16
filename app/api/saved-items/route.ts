/**
 * GET /api/saved-items
 * POST /api/saved-items
 * DELETE /api/saved-items
 * Manage saved items library
 */

import { NextRequest, NextResponse } from "next/server";
import { getSavedItems, addToSavedItems, removeFromSavedItems, removeMultipleFromSavedItems, removeAllFromSavedItems } from "@/src/lib/db/savedItems";
import { initializeDatabase } from "@/src/lib/db/index";
import { logger } from "@/src/lib/logger";

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : undefined;

    const items = await getSavedItems(limit, offset);

    return NextResponse.json({
      items,
      count: items.length,
    });
  } catch (error) {
    logger.error("Failed to get saved items", error);
    return NextResponse.json(
      { error: "Failed to get saved items" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    const body = await request.json();
    const { itemId } = body;

    if (!itemId || typeof itemId !== "string") {
      return NextResponse.json(
        { error: "itemId is required and must be a string" },
        { status: 400 }
      );
    }

    await addToSavedItems(itemId);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to add item to saved items", error);
    return NextResponse.json(
      { error: "Failed to add item to saved items" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await initializeDatabase();
    const searchParams = request.nextUrl.searchParams;
    const removeAll = searchParams.get("all") === "true";

    // Handle "remove all" case
    if (removeAll) {
      await removeAllFromSavedItems();
      return NextResponse.json({ success: true, message: "All items removed" });
    }

    // Try to get itemIds from request body (bulk delete)
    try {
      const body = await request.json().catch(() => null);
      if (body && Array.isArray(body.itemIds) && body.itemIds.length > 0) {
        await removeMultipleFromSavedItems(body.itemIds);
        return NextResponse.json({ success: true, message: `${body.itemIds.length} items removed` });
      }
    } catch {
      // If body parsing fails, fall through to single item delete
    }

    // Handle single item delete (backward compatibility)
    const itemId = searchParams.get("itemId");
    if (itemId) {
      await removeFromSavedItems(itemId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "itemId query parameter or itemIds in body is required" },
      { status: 400 }
    );
  } catch (error) {
    logger.error("Failed to remove item(s) from saved items", error);
    return NextResponse.json(
      { error: "Failed to remove item(s) from saved items" },
      { status: 500 }
    );
  }
}
