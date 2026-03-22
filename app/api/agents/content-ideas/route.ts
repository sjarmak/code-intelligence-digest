/**
 * GET /api/agents/content-ideas
 * Content ideas agent: marketing expert for webinars, blogs, videos, white papers aligned with ICP.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateContentIdeas } from "@/src/lib/agents/content-ideas";
import { logger } from "@/src/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const periodDays = Math.min(Math.max(1, parseInt(searchParams.get("periodDays") || "30", 10)), 90);
    const numIdeas = Math.min(Math.max(1, parseInt(searchParams.get("numIdeas") || "10", 10)), 25);
    const focus = searchParams.get("focus") ?? undefined;
    const traceRaw = (searchParams.get("trace") ?? "").toLowerCase();
    const pipelineTrace = traceRaw === "1" || traceRaw === "true" || traceRaw === "yes";

    const ideas = await generateContentIdeas({
      periodDays,
      numIdeas,
      focus: focus ?? null,
      pipelineTrace,
    });
    logger.info("Content ideas agent completed", {
      periodDays,
      numIdeas: ideas.ideas.length,
    });
    return NextResponse.json(ideas);
  } catch (error) {
    logger.error("Content ideas agent failed", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Content ideas agent failed" },
      { status: 500 }
    );
  }
}
