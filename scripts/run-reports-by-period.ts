/**
 * Generate reports for day, week, and month; save each to report-{period}.md for verification.
 * Usage: npx tsx scripts/run-reports-by-period.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { initializeDatabase } from "@/src/lib/db/index";
import { runAgentReports, VALID_GOALS } from "@/src/lib/agents/generate-reports";

const REPORT_DIR = path.resolve(process.cwd(), ".data", "agent-reports");
const PERIODS: Array<"day" | "week" | "month"> = ["day", "week", "month"];

/** Parse report markdown for period/window and (competitor_intel only) competitor count. */
function verifyReportSummary(content: string, goal: string, period: string): string {
  const windowMatch = content.match(/Window: last (\d+) days/);
  const periodMatch = content.match(/Period: last (\d+) days/);
  const days = windowMatch?.[1] ?? periodMatch?.[1];
  const label = windowMatch ? "Window" : "Period";
  if (!days) return `${goal} report-${period}: (no period/window line found)`;
  const dayLabel = days === "1" ? "day" : "days";
  let line = `${goal} report-${period}: ${label} ${days} ${dayLabel}`;
  if (goal === "competitor_intel") {
    const sectionCount = (content.match(/^## .+/gm) ?? []).length;
    line += `, ${sectionCount} competitors`;
  }
  return line;
}

async function main() {
  console.log("Initializing database...");
  await initializeDatabase();

  for (const period of PERIODS) {
    console.log(`\n--- Generating reports for period: ${period} ---`);
    const results = await runAgentReports([...VALID_GOALS], "legacy", period);
    for (const goal of VALID_GOALS) {
      const r = results[goal];
      if (!r?.ok || !r.id) {
        console.log(`  ${goal}: FAILED ${r?.error ?? ""}`);
        continue;
      }
      const dir = path.join(REPORT_DIR, goal);
      const srcPath = path.join(dir, `${r.id}.md`);
      const destPath = path.join(dir, `report-${period}.md`);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`  ${goal}: ${r.id} -> report-${period}.md`);
        const content = fs.readFileSync(destPath, "utf-8");
        console.log(`  ✓ ${verifyReportSummary(content, goal, period)}`);
      } else {
        console.log(`  ${goal}: file not found ${srcPath}`);
      }
    }
  }
  console.log("\nDone. Reports saved as report-day.md, report-week.md, report-month.md per goal.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
