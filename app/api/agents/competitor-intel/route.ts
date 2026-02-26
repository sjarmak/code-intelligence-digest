/**
 * GET /api/agents/competitor-intel
 * Competitor intel agent: direct competitors + whole-product ecosystem (Cursor, Copilot, etc.).
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
    const maxItems = Math.min(Math.max(5, parseInt(searchParams.get("maxItems") || "25", 10)), 50);
    const filter = searchParams.get("filter") ?? undefined;

    const docs = await retrieveForAgent("competitor_intel", {
      periodDays,
      query: filter ?? null,
      maxEnrich: 0,
    });

    const ranked = await rankForAgent("competitor_intel", docs);
    const shortlist = await buildAgentShortlist("competitor_intel", ranked, maxItems);

    const sources = shortlist.map((e) => ({
      title: e.doc.title,
      url: e.doc.url,
      snippet: e.doc.snippet,
      reason: e.reason,
      rank: e.rank,
    }));

    const response = {
      goal: "competitor_intel",
      periodDays,
      maxItems: sources.length,
      sources,
      generatedAt: new Date().toISOString(),
    };

    logger.info("Competitor intel agent completed", { periodDays, numSources: sources.length });
    return NextResponse.json(response);
  } catch (error) {
    logger.error("Competitor intel agent failed", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Competitor intel agent failed" },
      { status: 500 }
    );
  }
}
