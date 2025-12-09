/**
 * GET /api/admin/starred - Get starred items with optional filtering
 * PATCH /api/admin/starred/:inoreaderItemId - Rate a starred item
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getStarredItems,
  rateItem,
  countStarredItems,
  countUnratedStarredItems,
  RelevanceRating,
} from "../../../../src/lib/db/starredItems";
import { logger } from "../../../../src/lib/logger";
import { initializeDatabase } from "../../../../src/lib/db/index";
import { z } from "zod";

const RateStarredSchema = z.object({
  rating: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.null(),
  ]),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();

    const url = new URL(request.url);
    const onlyUnrated = url.searchParams.get("onlyUnrated") === "true";
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    const items = await getStarredItems({
      onlyRated: !onlyUnrated,
      limit,
      offset,
    });

    const total = await countStarredItems();
    const unrated = await countUnratedStarredItems();

    return NextResponse.json(
      {
        success: true,
        count: items.length,
        total,
        unrated,
        items: items.map((item: any) => ({
          id: item.id,
          itemId: item.itemId,
          inoreaderItemId: item.inoreaderItemId,
          title: item.title,
          url: item.url,
          sourceTitle: item.sourceTitle,
          publishedAt: new Date(item.publishedAt * 1000).toISOString(),
          summary: item.summary,
          relevanceRating: item.relevanceRating,
          notes: item.notes,
          starredAt: new Date(item.starredAt * 1000).toISOString(),
          ratedAt: item.ratedAt ? new Date(item.ratedAt * 1000).toISOString() : null,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Failed to get starred items", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Verify auth
    const authHeader = request.headers.get("authorization");
    const adminToken = process.env.ADMIN_API_TOKEN;

    if (adminToken && authHeader !== `Bearer ${adminToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initializeDatabase();

    // Extract inoreaderItemId from URL
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    const inoreaderItemId = pathParts[pathParts.length - 1];

    if (!inoreaderItemId) {
      return NextResponse.json(
        { error: "Missing inoreaderItemId in URL" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { rating, notes } = RateStarredSchema.parse(body);

    await rateItem(inoreaderItemId, rating as RelevanceRating, notes);

    return NextResponse.json(
      {
        success: true,
        message: `Rated item ${inoreaderItemId}`,
        inoreaderItemId,
        rating,
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Failed to rate starred item", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request",
          details: error.issues,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
