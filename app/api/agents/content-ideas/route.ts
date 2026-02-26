/**
 * GET /api/agents/content-ideas
 * Content ideas agent: marketing expert for webinars, blogs, videos, white papers aligned with ICP.
 */

import { NextRequest, NextResponse } from "next/server";
import { retrieveForAgent } from "@/src/lib/pipeline/agentRetrieval";
import { rankForAgent } from "@/src/lib/pipeline/agentRank";
import { buildAgentShortlist } from "@/src/lib/pipeline/agentShortlist";
import { logger } from "@/src/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const periodDays = Math.min(Math.max(1, parseInt(searchParams.get("periodDays") || "30", 10)), 90);
    const numIdeas = Math.min(Math.max(1, parseInt(searchParams.get("numIdeas") || "10", 10)), 25);
    const focus = searchParams.get("focus") ?? undefined;

    const docs = await retrieveForAgent("content_ideas", {
      periodDays,
      query: focus ?? null,
      maxEnrich: 0,
    });

    const ranked = await rankForAgent("content_ideas", docs);
    const shortlist = await buildAgentShortlist("content_ideas", ranked, numIdeas);

    const sources = shortlist.map((e) => ({
      title: e.doc.title,
      url: e.doc.url,
      snippet: e.doc.snippet,
      reason: e.reason,
      rank: e.rank,
    }));

    const response = {
      goal: "content_ideas",
      periodDays,
      numIdeas: sources.length,
      sources,
      generatedAt: new Date().toISOString(),
    };

    logger.info("Content ideas agent completed", { periodDays, numSources: sources.length });
    return NextResponse.json(response);
  } catch (error) {
    logger.error("Content ideas agent failed", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Content ideas agent failed" },
      { status: 500 }
    );
  }
}
