/**
 * GET /api/agents/reports/[goal]
 * Return the latest report content for a goal (content_ideas | market_brief | competitor_intel).
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const REPORT_DIR = path.join(process.cwd(), ".data", "agent-reports");
const VALID_GOALS = ["content_ideas", "market_brief", "competitor_intel"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ goal: string }> }
) {
  const { goal } = await params;
  if (!goal || !VALID_GOALS.includes(goal)) {
    return NextResponse.json({ error: "Invalid goal" }, { status: 400 });
  }

  const filePath = path.join(REPORT_DIR, `${goal}.md`);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: "Report not found. Run the agent report script to generate." },
      { status: 404 }
    );
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const stat = fs.statSync(filePath);
    return NextResponse.json({
      goal,
      generatedAt: stat.mtime.toISOString(),
      content,
    });
  } catch (error) {
    console.error("Agent report read error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read report" },
      { status: 500 }
    );
  }
}
