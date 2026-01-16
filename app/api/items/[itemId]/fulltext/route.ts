/**
 * GET /api/items/[itemId]/fulltext
 * Retrieve full text for an item (if available)
 */

import { NextRequest, NextResponse } from "next/server";
import { loadItem } from "@/src/lib/db/items";
import { logger } from "@/src/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;

    if (!itemId) {
      return NextResponse.json(
        { error: "itemId is required" },
        { status: 400 }
      );
    }

    const item = await loadItem(itemId);

    if (!item) {
      return NextResponse.json(
        { error: "Item not found" },
        { status: 404 }
      );
    }

    const hasFullText = !!item.fullText;

    return NextResponse.json({
      fullText: item.fullText || null,
      hasFullText,
    });
  } catch (error) {
    logger.error("Failed to get item full text", error);
    return NextResponse.json(
      { error: "Failed to get item full text" },
      { status: 500 }
    );
  }
}
