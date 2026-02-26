/**
 * GET /api/agents/market-brief
 * Market brief agent: potential leads, tech/market landscape shifts for GTM strategy.
 */

import { NextRequest, NextResponse } from "next/server";
import { retrieveForAgent } from "@/src/lib/pipeline/agentRetrieval";
import { rankForAgent } from "@/src/lib/pipeline/agentRank";
import { buildAgentShortlist } from "@/src/lib/pipeline/agentShortlist";
import { logger } from "@/src/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const periodDays = Math.min(Math.max(1, parseInt(searchParams.get("periodDays") || "14", 10)), 90);
    const maxItems = Math.min(Math.max(5, parseInt(searchParams.get("maxItems") || "20", 10)), 50);
    const focus = searchParams.get("focus") ?? undefined;

    const docs = await retrieveForAgent("market_brief", {
      periodDays,
      query: focus ?? null,
      maxEnrich: 0,
    });

    const ranked = await rankForAgent("market_brief", docs);
    const shortlist = await buildAgentShortlist("market_brief", ranked, maxItems);

    const sources = shortlist.map((e) => ({
      title: e.doc.title,
      url: e.doc.url,
      snippet: e.doc.snippet,
      reason: e.reason,
      rank: e.rank,
    }));

    const response = {
      goal: "market_brief",
      periodDays,
      maxItems: sources.length,
      sources,
      generatedAt: new Date().toISOString(),
    };

    logger.info("Market brief agent completed", { periodDays, numSources: sources.length });
    return NextResponse.json(response);
  } catch (error) {
    logger.error("Market brief agent failed", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Market brief agent failed" },
      { status: 500 }
    );
  }
}
