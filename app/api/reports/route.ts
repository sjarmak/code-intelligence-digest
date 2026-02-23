/**
 * GET /api/reports
 * List agent run outputs. Query: agentId?, jobId?, limit? (default 50).
 */

import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/src/lib/db/index";
import { listAgentRuns } from "@/src/lib/db/agent-runs";
import type { AgentId, JobId } from "@/src/config/agent-jobs";

const VALID_AGENT_IDS: AgentId[] = ["competitive_intel", "icp_market", "gtm_content"];
const VALID_JOB_IDS: JobId[] = [
  "daily_competitor_report",
  "weekly_competitor_summary",
  "daily_icp_brief",
  "daily_content_ideas",
];

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();

    const { searchParams } = request.nextUrl;
    const agentId = searchParams.get("agentId") as AgentId | null;
    const jobId = searchParams.get("jobId") as JobId | null;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);

    if (agentId != null && !VALID_AGENT_IDS.includes(agentId)) {
      return NextResponse.json(
        { error: `agentId must be one of: ${VALID_AGENT_IDS.join(", ")}` },
        { status: 400 }
      );
    }
    if (jobId != null && !VALID_JOB_IDS.includes(jobId)) {
      return NextResponse.json(
        { error: `jobId must be one of: ${VALID_JOB_IDS.join(", ")}` },
        { status: 400 }
      );
    }

    const runs = await listAgentRuns({
      agentId: agentId ?? undefined,
      jobId: jobId ?? undefined,
      limit,
    });

    return NextResponse.json({
      runs: runs.map((r) => ({
        id: r.id,
        agentId: r.agentId,
        jobId: r.jobId,
        title: r.title,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "List failed" },
      { status: 500 }
    );
  }
}
