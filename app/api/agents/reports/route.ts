/**
 * GET /api/agents/reports
 * List all agent report runs. Uses Postgres when DATABASE_URL is set (production); else files in .data/agent-reports/.
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { initializeDatabase } from "@/src/lib/db/index";
import { listReports, useReportDb } from "@/src/lib/agents/report-storage";

const REPORT_DIR = path.join(process.cwd(), ".data", "agent-reports");
const GOALS = ["content_ideas", "market_brief", "competitor_intel"] as const;

export async function GET() {
  try {
    if (useReportDb()) {
      await initializeDatabase();
      const reports = await listReports();
      return NextResponse.json({ reports });
    }

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
