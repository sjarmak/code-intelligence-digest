/**
 * DELETE /api/agents/reports/[goal]/[id]
 * Delete a specific report run. Uses Postgres when DATABASE_URL is set; also removes file if present.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { initializeDatabase } from "@/src/lib/db/index";
import { deleteReport, isAgentReportsDbEnabled } from "@/src/lib/agents/report-storage";
import { auth } from "@/src/auth";

const REPORT_DIR = path.join(process.cwd(), ".data", "agent-reports");
const VALID_GOALS = ["content_ideas", "market_brief", "competitor_intel"];

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ goal: string; id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { goal, id } = await params;
  if (!goal || !VALID_GOALS.includes(goal)) {
    return NextResponse.json({ error: "Invalid goal" }, { status: 400 });
  }
  if (!id || id.includes("..") || id.includes("/")) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  if (id === "latest") {
    return NextResponse.json({ error: "Cannot delete by id 'latest'" }, { status: 400 });
  }

  if (isAgentReportsDbEnabled()) {
    await initializeDatabase();
    const deleted = await deleteReport(goal, id, session.user.id);
    if (!deleted) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    const filePath = path.join(REPORT_DIR, goal, `${id}.md`);
    const metadataPath = path.join(REPORT_DIR, goal, `${id}.json`);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(metadataPath)) {
      try {
        fs.unlinkSync(metadataPath);
      } catch {
        // ignore
      }
    }
    return new NextResponse(null, { status: 204 });
  }

  const filePath = path.join(REPORT_DIR, goal, `${id}.md`);
  const metadataPath = path.join(REPORT_DIR, goal, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  try {
    fs.unlinkSync(filePath);
    if (fs.existsSync(metadataPath)) {
      fs.unlinkSync(metadataPath);
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Agent report delete error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete report" },
      { status: 500 }
    );
  }
}
