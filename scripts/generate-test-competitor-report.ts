/**
 * Generate a single competitor intel report (30-day) for testing/review.
 * Usage: npx tsx scripts/generate-test-competitor-report.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { initializeDatabase } from "@/src/lib/db/index";
import { runAgentReport } from "@/src/lib/agents/generate-reports";

async function main() {
  console.log("Initializing database...");
  await initializeDatabase();

  console.log("Generating competitor intel report (30-day / month)...");
  const result = await runAgentReport("competitor_intel", "legacy", "month");

  if (!result.ok) {
    console.error("Failed:", result.error);
    process.exit(1);
  }
  console.log("Report ID:", result.id);
  const outPath = path.join(process.cwd(), ".data", "agent-reports", "competitor_intel", `${result.id}.md`);
  console.log("Path:", outPath);
  console.log("\n--- Report content ---\n");
  const fs = await import("fs");
  if (fs.existsSync(outPath)) {
    console.log(fs.readFileSync(outPath, "utf-8"));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
