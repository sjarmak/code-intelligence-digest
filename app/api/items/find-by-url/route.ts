/**
 * GET /api/items/find-by-url?url=...
 * Find itemId by URL (for matching research papers to feed items)
 */

import { NextRequest, NextResponse } from "next/server";
import { getDbClient } from "@/src/lib/db/driver";
import { initializeDatabase } from "@/src/lib/db/index";
import { logger } from "@/src/lib/logger";

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get("url");

    if (!url) {
      return NextResponse.json(
        { error: "url query parameter is required" },
        { status: 400 }
      );
    }

    const client = await getDbClient();
    // Try exact match first, then try with extracted_url
    const result = await client.query(
      `SELECT id FROM items 
       WHERE url = ? OR extracted_url = ? 
       LIMIT 1`,
      [url, url]
    );
    
    let itemId: string | null = null;
    if (result.rows.length > 0) {
      itemId = (result.rows[0] as { id: string }).id;
    }

    return NextResponse.json({ itemId });
  } catch (error) {
    logger.error("Failed to find item by URL", error);
    return NextResponse.json(
      { error: "Failed to find item by URL" },
      { status: 500 }
    );
  }
}
