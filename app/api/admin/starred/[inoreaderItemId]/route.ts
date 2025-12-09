/**
 * PATCH /api/admin/starred/:inoreaderItemId - Rate a starred item
 */

import { NextRequest, NextResponse } from "next/server";
import { rateItem, RelevanceRating } from "../../../../../src/lib/db/starredItems";
import { logger } from "../../../../../src/lib/logger";
import { initializeDatabase } from "../../../../../src/lib/db/index";
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ inoreaderItemId: string }> }
) {
  const { inoreaderItemId } = await params;
  try {
    // Verify auth
    const authHeader = request.headers.get("authorization");
    const adminToken = process.env.ADMIN_API_TOKEN;

    if (adminToken && authHeader !== `Bearer ${adminToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await initializeDatabase();

    if (!inoreaderItemId) {
      return NextResponse.json(
        { error: "Missing inoreaderItemId" },
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
