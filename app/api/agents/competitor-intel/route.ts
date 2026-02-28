/**
 * GET /api/agents/competitor-intel
 * Retrieval + triage for Sourcegraph-relevant competitor intelligence.
 */

import { NextRequest, NextResponse } from "next/server";
import { gatherCompetitorIntel } from "@/src/lib/agents/competitor-intel";
import { logger } from "@/src/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const periodDays = Math.min(Math.max(30, parseInt(searchParams.get("periodDays") || "90", 10)), 180);
    const topPerCompetitor = Math.min(Math.max(1, parseInt(searchParams.get("topPerCompetitor") || "5", 10)), 10);
    const topOverall = Math.min(Math.max(5, parseInt(searchParams.get("topOverall") || "20", 10)), 50);
    const competitorId = searchParams.get("competitorId") || undefined;

    const items = await gatherCompetitorIntel({
      periodDays,
      topPerCompetitor,
      topOverall,
      competitorId,
      maxGeneratedQueries: 16,
      webDocsPerQuery: 3,
      maxWebQueriesPerCompetitor: 2,
    });

    const response = {
      goal: "competitor_intel",
      periodDays,
      topPerCompetitor,
      topOverall: items.length,
      competitorId: competitorId ?? null,
      items,
      generatedAt: new Date().toISOString(),
    };

    logger.info("Competitor intel agent completed", {
      periodDays,
      competitorId,
      itemCount: items.length,
    });

    return NextResponse.json(response);
  } catch (error) {
    logger.error("Competitor intel agent failed", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Competitor intel agent failed" },
      { status: 500 },
    );
  }
}
