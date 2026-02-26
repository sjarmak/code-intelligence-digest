/**
 * GET /api/agents/reports
 * List latest agent report runs (reads .data/agent-reports/*.md by mtime).
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const REPORT_DIR = path.join(process.cwd(), ".data", "agent-reports");
const GOALS = ["content_ideas", "market_brief", "competitor_intel"] as const;

export async function GET() {
  try {
    if (!fs.existsSync(REPORT_DIR)) {
      return NextResponse.json({ reports: [] });
    }

    const reports: { goal: string; generatedAt: string | null }[] = [];

    for (const goal of GOALS) {
      const filePath = path.join(REPORT_DIR, `${goal}.md`);
      if (!fs.existsSync(filePath)) {
        reports.push({ goal, generatedAt: null });
        continue;
      }
      const stat = fs.statSync(filePath);
      const generatedAt = stat.mtime.toISOString();
      reports.push({ goal, generatedAt });
    }

    return NextResponse.json({ reports });
  } catch (error) {
    console.error("Agent reports list error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list reports" },
      { status: 500 }
    );
  }
}
