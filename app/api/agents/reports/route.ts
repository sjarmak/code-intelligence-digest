/**
 * GET /api/agents/reports
 * List all agent report runs (one entry per file in .data/agent-reports/{goal}/*.md).
 * Also supports legacy single .md per goal for backward compatibility.
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

    const reports: { goal: string; id: string; generatedAt: string }[] = [];

    for (const goal of GOALS) {
      const goalDir = path.join(REPORT_DIR, goal);
      if (fs.existsSync(goalDir) && fs.statSync(goalDir).isDirectory()) {
        const files = fs.readdirSync(goalDir).filter((f) => f.endsWith(".md"));
        for (const file of files) {
          const id = file.replace(/\.md$/, "");
          const filePath = path.join(goalDir, file);
          const stat = fs.statSync(filePath);
          reports.push({ goal, id, generatedAt: stat.mtime.toISOString() });
        }
      }
      // Legacy: single file per goal at REPORT_DIR/{goal}.md
      const legacyPath = path.join(REPORT_DIR, `${goal}.md`);
      if (fs.existsSync(legacyPath)) {
        const stat = fs.statSync(legacyPath);
        reports.push({ goal, id: "latest", generatedAt: stat.mtime.toISOString() });
      }
    }

    reports.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
    return NextResponse.json({ reports });
  } catch (error) {
    console.error("Agent reports list error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list reports" },
      { status: 500 }
    );
  }
}
