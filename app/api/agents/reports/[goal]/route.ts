/**
 * GET /api/agents/reports/[goal]
 * Return report content. Query ?id=xxx for a specific run; otherwise returns latest for that goal.
 * Uses Postgres when DATABASE_URL is set; else reads from .data/agent-reports/.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { initializeDatabase } from "@/src/lib/db/index";
import { getReport, useReportDb } from "@/src/lib/agents/report-storage";
import { auth } from "@/src/auth";

const REPORT_DIR = path.join(process.cwd(), ".data", "agent-reports");
const VALID_GOALS = ["content_ideas", "market_brief", "competitor_intel"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ goal: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { goal } = await params;
  if (!goal || !VALID_GOALS.includes(goal)) {
    return NextResponse.json({ error: "Invalid goal" }, { status: 400 });
  }

  const id = req.nextUrl.searchParams.get("id") ?? undefined;

  if (useReportDb()) {
    await initializeDatabase();
    const row = await getReport(goal, id ?? undefined, session.user.id);
    if (row) return NextResponse.json(row);
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  let filePath: string;
  const goalDir = path.join(REPORT_DIR, goal);
  const legacyPath = path.join(REPORT_DIR, `${goal}.md`);

  if (id && id !== "latest") {
    filePath = path.join(goalDir, `${id}.md`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: "Report not found." },
        { status: 404 }
      );
    }
  } else {
    if (fs.existsSync(goalDir) && fs.statSync(goalDir).isDirectory()) {
      const files = fs.readdirSync(goalDir).filter((f) => f.endsWith(".md"));
      if (files.length === 0) {
        if (fs.existsSync(legacyPath)) filePath = legacyPath;
        else {
          return NextResponse.json(
            { error: "Report not found. Generate reports first." },
            { status: 404 }
          );
        }
      } else {
        files.sort().reverse();
        filePath = path.join(goalDir, files[0]);
      }
    } else if (fs.existsSync(legacyPath)) {
      filePath = legacyPath;
    } else {
      return NextResponse.json(
        { error: "Report not found. Generate reports first." },
        { status: 404 }
      );
    }
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const stat = fs.statSync(filePath);
    const generatedAt = stat.mtime.toISOString();
    const reportId = path.basename(filePath, ".md");
    return NextResponse.json({
      goal,
      id: reportId,
      generatedAt,
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
