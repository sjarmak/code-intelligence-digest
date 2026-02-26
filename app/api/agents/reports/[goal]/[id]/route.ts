/**
 * DELETE /api/agents/reports/[goal]/[id]
 * Delete a specific report run.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const REPORT_DIR = path.join(process.cwd(), ".data", "agent-reports");
const VALID_GOALS = ["content_ideas", "market_brief", "competitor_intel"];

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ goal: string; id: string }> }
) {
  const { goal, id } = await params;
  if (!goal || !VALID_GOALS.includes(goal)) {
    return NextResponse.json({ error: "Invalid goal" }, { status: 400 });
  }
  if (!id || id.includes("..") || id.includes("/")) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const filePath =
    id === "latest"
      ? path.join(REPORT_DIR, `${goal}.md`)
      : path.join(REPORT_DIR, goal, `${id}.md`);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  try {
    fs.unlinkSync(filePath);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Agent report delete error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete report" },
      { status: 500 }
    );
  }
}
