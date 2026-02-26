/**
 * GET /api/reports/[id]
 * Get one agent run output (full markdown and metadata).
 */

import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/src/lib/db/index";
import { getAgentRun } from "@/src/lib/db/agent-runs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Report id required" }, { status: 400 });
    }

    await initializeDatabase();
    const run = await getAgentRun(id);
    if (!run) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: run.id,
      agentId: run.agentId,
      jobId: run.jobId,
      title: run.title,
      outputMarkdown: run.outputMarkdown,
      outputMetadata: run.outputMetadata
        ? (JSON.parse(run.outputMetadata) as Record<string, unknown>)
        : null,
      createdAt: run.createdAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fetch failed" },
      { status: 500 }
    );
  }
}
