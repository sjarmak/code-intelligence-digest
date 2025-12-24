/**
 * GET /api/config/date-bounds
 * Returns the earliest and latest available dates from the database
 */

import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/src/lib/db/index";
import { getEarliestPublishedDate } from "@/src/lib/db/items";
import { logger } from "@/src/lib/logger";

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();

    const earliestDate = await getEarliestPublishedDate();
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    if (!earliestDate) {
      // No items in database, return reasonable defaults
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      return NextResponse.json({
        earliestDate: twoYearsAgo.toISOString().split('T')[0],
        latestDate: today.toISOString().split('T')[0],
      });
    }

    return NextResponse.json({
      earliestDate: earliestDate.toISOString().split('T')[0],
      latestDate: today.toISOString().split('T')[0],
    });
  } catch (error) {
    logger.error("Failed to get date bounds", { error });
    return NextResponse.json(
      {
        error: "Failed to get date bounds",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

