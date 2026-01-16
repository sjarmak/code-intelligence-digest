/**
 * GET /api/saved-items
 * POST /api/saved-items
 * DELETE /api/saved-items
 * Manage saved items library
 */

import { NextRequest, NextResponse } from "next/server";
import { getSavedItems, addToSavedItems, removeFromSavedItems } from "@/src/lib/db/savedItems";
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
    const itemId = searchParams.get("itemId");

    if (!itemId) {
      return NextResponse.json(
        { error: "itemId query parameter is required" },
        { status: 400 }
      );
    }

    await removeFromSavedItems(itemId);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to remove item from saved items", error);
    return NextResponse.json(
      { error: "Failed to remove item from saved items" },
      { status: 500 }
    );
  }
}
