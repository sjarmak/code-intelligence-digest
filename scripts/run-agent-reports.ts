/**
 * Generate and write agent reports (content-ideas, market-brief, competitor-intel).
 * Uses shared lib: retrieve -> rank -> shortlist -> write to .data/agent-reports/.
 *
 * Usage: npx tsx scripts/run-agent-reports.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { initializeDatabase } from "@/src/lib/db/index";
import { runAgentReports, VALID_GOALS } from "@/src/lib/agents/generate-reports";

async function main() {
  console.log("Initializing database...");
  await initializeDatabase();

  console.log("\nGenerating reports for:", VALID_GOALS.join(", "));
  const results = await runAgentReports([...VALID_GOALS]);

  for (const goal of VALID_GOALS) {
    const r = results[goal];
    console.log(`  ${goal}: ${r?.ok ? "OK" : "FAILED" + (r?.error ? ` (${r.error})` : "")}`);
  }
  console.log("\nDone. Reports in .data/agent-reports/");
}

main();
