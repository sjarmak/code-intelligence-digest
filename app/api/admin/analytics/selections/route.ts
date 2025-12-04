/**
 * API route: GET /api/admin/analytics/selections
 * Analyze which items were selected for digests and why
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { getDigestSelections, getSelectionStats } from "@/src/lib/db/selections";

/**
 * GET /api/admin/analytics/selections?period=week&category=research
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const period = searchParams.get("period") || "week";
    const category = searchParams.get("category");
    const showReasons = searchParams.get("reasons") !== "false";

    logger.info(`[SELECTIONS] Analyzing digest selections for period: ${period}`);

    // Initialize database
    await initializeDatabase();

    // Get selection statistics
    const stats = await getSelectionStats(period);

    // Get detailed selections if category specified
    let categorySelections = undefined;
    if (category) {
      categorySelections = await getDigestSelections(category, period);
      logger.info(
        `[SELECTIONS] Found ${categorySelections.length} selections for ${category}/${period}`
      );
    }

    // Analyze diversity reasons
    let reasonAnalysis = undefined;
    if (showReasons && categorySelections) {
      const reasonCounts = new Map<string, number>();
      const selectedCount = categorySelections.filter((s) =>
        s.diversityReason?.startsWith("Selected")
      ).length;
      const excludedCount = categorySelections.filter((s) =>
        s.diversityReason && !s.diversityReason.startsWith("Selected")
      ).length;

      for (const selection of categorySelections) {
        if (selection.diversityReason) {
          const key = selection.diversityReason.split(" (")[0]; // Group by main reason
          reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
        }
      }

      reasonAnalysis = {
        selectedCount,
        excludedCount,
        reasonBreakdown: Object.fromEntries(reasonCounts),
      };
    }

    const response: Record<string, unknown> = {
      period,
      overallStats: stats,
    };

    if (category && categorySelections) {
      response.category = category;
      response.selections = categorySelections.map((s) => ({
        itemId: s.itemId,
        rank: s.rank,
        diversityReason: s.diversityReason,
        selectedAt: new Date(s.selectedAt * 1000).toISOString(),
      }));
    }

    if (reasonAnalysis) {
      response.reasonAnalysis = reasonAnalysis;
    }

    return NextResponse.json(response);
  } catch (error) {
    logger.error("[SELECTIONS] Error in /api/admin/analytics/selections", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch selections analytics",
      },
      { status: 400 }
    );
  }
}
