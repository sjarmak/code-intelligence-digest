/**
 * POST /api/reports/run
 * Run one or all daily GTM/marketing agent jobs. Requires signed-in user.
 * Body: { agentId?: string, jobId?: string } for one job, or { runAllDaily?: true } for all daily jobs.
 * Works in production (unlike admin run-agent-job).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { runAgentJob } from "@/src/lib/agents/run-job";
import { getJobConfig, getJobsForSchedule } from "@/src/config/agent-jobs";
import type { AgentId, JobId } from "@/src/config/agent-jobs";

const VALID_AGENT_IDS: AgentId[] = ["competitive_intel", "icp_market", "gtm_content"];
const VALID_JOB_IDS: JobId[] = [
  "daily_competitor_report",
  "weekly_competitor_summary",
  "daily_icp_brief",
  "daily_content_ideas",
];

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in to run report generation." }, { status: 401 });
  }

  try {
    let body: { agentId?: string; jobId?: string; runAllDaily?: boolean };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }

    const runAllDaily = body.runAllDaily === true;
    const agentId = body.agentId as AgentId | undefined;
    const jobId = body.jobId as JobId | undefined;

    if (runAllDaily) {
      await initializeDatabase();
      const dailyJobs = getJobsForSchedule("daily");
      const results: { agentId: string; jobId: string; runId?: string; title?: string; error?: string }[] = [];
      for (const job of dailyJobs) {
        try {
          const result = await runAgentJob(job.agentId, job.jobId);
          if (result) {
            results.push({ agentId: job.agentId, jobId: job.jobId, runId: result.runId, title: result.title });
            logger.info("[REPORTS-RUN] Completed", { agentId: job.agentId, jobId: job.jobId, runId: result.runId });
          } else {
            results.push({ agentId: job.agentId, jobId: job.jobId, error: "No output (e.g. no LLM configured)" });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ agentId: job.agentId, jobId: job.jobId, error: msg });
          logger.error("[REPORTS-RUN] Job failed", { agentId: job.agentId, jobId: job.jobId, error: msg });
        }
      }
      return NextResponse.json({ success: true, runAllDaily: true, results });
    }

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
      return NextResponse.json({ error: `Unknown job: ${agentId}/${jobId}` }, { status: 404 });
    }

    await initializeDatabase();
    const result = await runAgentJob(agentId, jobId);
    if (!result) {
      return NextResponse.json(
        { error: "Job did not produce a run (e.g. no LLM configured)." },
        { status: 500 }
      );
    }

    logger.info("[REPORTS-RUN] Completed", { agentId, jobId, runId: result.runId });
    return NextResponse.json({
      success: true,
      runId: result.runId,
      title: result.title,
    });
  } catch (error) {
    logger.error("[REPORTS-RUN] Failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Report generation failed" },
      { status: 500 }
    );
  }
}
