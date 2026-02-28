/**
 * POST /api/agents/reports/generate
 * Generate agent reports for selected goals.
 * Body: {
 *   goals: ("content_ideas" | "market_brief" | "competitor_intel")[],
 *   timeRange?: "day" | "week" | "month" | "year"
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/src/lib/db/index";
import { runAgentReports, type ReportTimeRange } from "@/src/lib/agents/generate-reports";
import type { AgentGoal } from "@/src/config/agents";
import { auth } from "@/src/auth";

const VALID_GOALS: AgentGoal[] = ["content_ideas", "market_brief", "competitor_intel"];
const VALID_TIME_RANGES: ReportTimeRange[] = ["day", "week", "month", "year"];

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    let body: { goals?: unknown; timeRange?: unknown };
    try {
      body = (await request.json()) as { goals?: unknown; timeRange?: unknown };
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body. Use { goals: [\"content_ideas\", ...], timeRange?: \"day|week|month|year\" }." },
        { status: 400 }
      );
    }

    const raw = Array.isArray(body.goals) ? body.goals : [];
    const goals = raw.filter((g): g is AgentGoal => typeof g === "string" && VALID_GOALS.includes(g as AgentGoal));

    if (goals.length === 0) {
      return NextResponse.json(
        { error: `At least one goal required. Valid: ${VALID_GOALS.join(", ")}` },
        { status: 400 }
      );
    }

    const timeRange =
      typeof body.timeRange === "string" && VALID_TIME_RANGES.includes(body.timeRange as ReportTimeRange)
        ? (body.timeRange as ReportTimeRange)
        : undefined;

    await initializeDatabase();
    const results = await runAgentReports(goals, session.user.id, timeRange);

    return NextResponse.json({ success: true, results, timeRange: timeRange ?? "default" });
  } catch (error) {
    console.error("Agent reports generate failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generate failed" },
      { status: 500 }
    );
  }
}
