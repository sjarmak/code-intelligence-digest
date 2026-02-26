/**
 * POST /api/admin/run-agent-job
 * Run one GTM/marketing agent job once (for testing or manual trigger).
 * Body: { agentId: string, jobId: string }
 * In production this is disabled; use the cron script or Render cron instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { blockInProduction } from "@/src/lib/auth/guards";
import { runAgentJob } from "@/src/lib/agents/run-job";
import { getJobConfig } from "@/src/config/agent-jobs";
import type { AgentId, JobId } from "@/src/config/agent-jobs";

const VALID_AGENT_IDS: AgentId[] = ["competitive_intel", "icp_market", "gtm_content"];
const VALID_JOB_IDS: JobId[] = [
  "daily_competitor_report",
  "weekly_competitor_summary",
  "daily_icp_brief",
  "daily_content_ideas",
];

export async function POST(request: NextRequest) {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    let body: { agentId?: string; jobId?: string };
    try {
      body = (await request.json()) as { agentId?: string; jobId?: string };
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body. Use { agentId, jobId }." },
        { status: 400 }
      );
    }

    const agentId = (body.agentId ?? request.nextUrl.searchParams.get("agentId")) as AgentId | null;
    const jobId = (body.jobId ?? request.nextUrl.searchParams.get("jobId")) as JobId | null;

    if (!agentId || !VALID_AGENT_IDS.includes(agentId)) {
      return NextResponse.json(
        { error: `agentId required and must be one of: ${VALID_AGENT_IDS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!jobId || !VALID_JOB_IDS.includes(jobId)) {
      return NextResponse.json(
        { error: `jobId required and must be one of: ${VALID_JOB_IDS.join(", ")}` },
        { status: 400 }
      );
    }

    const job = getJobConfig(agentId, jobId);
    if (!job) {
      return NextResponse.json(
        { error: `Unknown job: ${agentId}/${jobId}` },
        { status: 404 }
      );
    }

    await initializeDatabase();

    const result = await runAgentJob(agentId, jobId);
    if (!result) {
      return NextResponse.json(
        { error: "Job did not produce a run (e.g. no LLM client)." },
        { status: 500 }
      );
    }

    logger.info("[RUN-AGENT-JOB] Completed", { agentId, jobId, runId: result.runId });
    return NextResponse.json({
      success: true,
      runId: result.runId,
      title: result.title,
    });
  } catch (error) {
    logger.error("[RUN-AGENT-JOB] Failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Job failed" },
      { status: 500 }
    );
  }
}
