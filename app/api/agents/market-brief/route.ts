/**
 * GET /api/agents/market-brief
 * Market brief agent: potential leads, tech/market landscape shifts for GTM strategy.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateMarketBrief } from "@/src/lib/agents/market-brief";
import { logger } from "@/src/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const periodDays = Math.min(Math.max(1, parseInt(searchParams.get("periodDays") || "14", 10)), 90);
    const maxItems = Math.min(Math.max(5, parseInt(searchParams.get("maxItems") || "20", 10)), 50);
    const focus = searchParams.get("focus") ?? undefined;

    const brief = await generateMarketBrief({
      periodDays,
      maxItems,
      focus: focus ?? null,
    });
    logger.info("Market brief agent completed", {
      periodDays,
      executiveDeltaCount: brief.executive_delta.length,
      watchCount: brief.watch_items.length,
    });
    return NextResponse.json(brief);
  } catch (error) {
    logger.error("Market brief agent failed", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Market brief agent failed" },
      { status: 500 }
    );
  }
}
