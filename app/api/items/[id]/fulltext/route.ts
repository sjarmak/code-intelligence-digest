/**
 * GET /api/items/[id]/fulltext
 * Check if an item has full text available and optionally return it
 *
 * Uses PostgreSQL when DATABASE_URL is configured, otherwise falls back to SQLite
 */

import { NextRequest, NextResponse } from "next/server";
import { getDbClient, detectDriver } from "@/src/lib/db/driver";

async function loadFullTextFromDb(itemId: string): Promise<{ text: string; source: string } | null> {
  try {
    const db = await getDbClient();

    const result = await db.query(
      `SELECT full_text, full_text_source FROM items WHERE id = ?`,
      [itemId]
    );

    if (result.rows.length === 0 || !result.rows[0].full_text) {
      return null;
    }

    const row = result.rows[0] as { full_text: string | null; full_text_source: string | null };
    return {
      text: row.full_text!,
      source: row.full_text_source || "unknown",
    };
  } catch (error) {
    console.error(`Failed to load full text for item ${itemId}:`, error);
    return null;
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

    // Check if full text exists
    const fullText = await loadFullTextFromDb(itemId);

    // Check if caller wants the full content
    const includeContent = request.nextUrl.searchParams.get("include_content") === "true";

    if (includeContent && fullText) {
      return NextResponse.json({
        hasFullText: true,
        text: fullText.text,
        source: fullText.source,
        driver,
      });
    }

    return NextResponse.json({
      hasFullText: fullText !== null,
      source: fullText?.source || null,
      driver,
    });
  } catch (error) {
    console.error("Error checking full text:", error);
    return NextResponse.json(
      { error: "Failed to check full text", hasFullText: false },
      { status: 500 }
    );
  }
}
