/**
 * Generate and write agent reports (content-ideas, market-brief, competitor-intel).
 * Uses pipeline directly: retrieve -> rank -> shortlist. Writes to .data/agent-reports/.
 *
 * Usage: npx tsx scripts/run-agent-reports.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { initializeDatabase } from "@/src/lib/db/index";
import { retrieveForAgent } from "@/src/lib/pipeline/agentRetrieval";
import { rankForAgent } from "@/src/lib/pipeline/agentRank";
import { buildAgentShortlist } from "@/src/lib/pipeline/agentShortlist";
import { getAgentGoalConfig } from "@/src/config/agents";
import type { AgentGoal } from "@/src/config/agents";
import { logger } from "@/src/lib/logger";

const REPORT_DIR = path.resolve(process.cwd(), ".data", "agent-reports");
const GOALS: AgentGoal[] = ["content_ideas", "market_brief", "competitor_intel"];

function formatReport(goal: AgentGoal, shortlist: Awaited<ReturnType<typeof buildAgentShortlist>>): string {
  const config = getAgentGoalConfig(goal);
  const lines: string[] = [
    `# ${config.name} Agent Report`,
    `Generated: ${new Date().toISOString()}`,
    "",
    `## Goal`,
    config.description,
    "",
    `## Target audience (ICP)`,
    config.icpDescription,
    "",
    `## Selected sources (${shortlist.length})`,
    "",
  ];
  shortlist.forEach((entry, i) => {
    lines.push(`### ${i + 1}. ${entry.doc.title}`);
    if (entry.doc.url) lines.push(`URL: ${entry.doc.url}`);
    if (entry.reason) lines.push(`**Why:** ${entry.reason}`);
    if (entry.doc.snippet) lines.push(`Snippet: ${entry.doc.snippet.slice(0, 300)}${entry.doc.snippet.length > 300 ? "..." : ""}`);
    lines.push("");
  });
  return lines.join("\n");
}

async function main() {
  console.log("Initializing database...");
  await initializeDatabase();

  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  for (const goal of GOALS) {
    console.log(`\n--- ${goal} ---`);
    try {
      const config = getAgentGoalConfig(goal);
      const periodDays = config.timeHorizonDays;
      const limit = goal === "content_ideas" ? 10 : 20;

      console.log(`  Retrieving (period=${periodDays}d)...`);
      const docs = await retrieveForAgent(goal, { periodDays, maxEnrich: 0 });
      console.log(`  Retrieved ${docs.length} docs`);

      if (docs.length === 0) {
        console.log(`  No docs; skipping rank/shortlist`);
        const outPath = path.join(REPORT_DIR, `${goal}.md`);
        fs.writeFileSync(outPath, `# ${config.name}\n\nNo documents retrieved for period ${periodDays} days.\n`, "utf-8");
        continue;
      }

      console.log(`  Ranking...`);
      const ranked = await rankForAgent(goal, docs);
      console.log(`  Shortlisting (limit=${limit})...`);
      const shortlist = await buildAgentShortlist(goal, ranked, limit);

      const report = formatReport(goal, shortlist);
      const outPath = path.join(REPORT_DIR, `${goal}.md`);
      fs.writeFileSync(outPath, report, "utf-8");
      console.log(`  Wrote ${outPath}`);
    } catch (err) {
      logger.error(`Agent report failed: ${goal}`, { error: err });
      console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\nDone. Reports in .data/agent-reports/");
}

main();
