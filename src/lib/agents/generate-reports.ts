/**
 * Generate agent reports (content_ideas, market_brief, competitor_intel).
 * Retrieve → rank → shortlist → format → write to .data/agent-reports/.
 */

import path from "path";
import fs from "fs";
import { retrieveForAgent } from "../pipeline/agentRetrieval";
import { rankForAgent } from "../pipeline/agentRank";
import { buildAgentShortlist } from "../pipeline/agentShortlist";
import { getAgentGoalConfig } from "../../config/agents";
import type { AgentGoal } from "../../config/agents";
import { logger } from "../logger";

const REPORT_DIR = path.resolve(process.cwd(), ".data", "agent-reports");

const VALID_GOALS: AgentGoal[] = ["content_ideas", "market_brief", "competitor_intel"];

function stripHtml(s: string | undefined): string {
  if (s == null || s === "") return "";
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function formatReport(
  goal: AgentGoal,
  shortlist: Awaited<ReturnType<typeof buildAgentShortlist>>
): string {
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
    const reason = stripHtml(entry.reason);
    if (reason) lines.push(`**Why:** ${reason}`);
    if (goal === "content_ideas" && entry.contentIdeas?.length) {
      lines.push(`**Content ideas:**`);
      entry.contentIdeas.forEach((idea) => lines.push(`- ${stripHtml(idea)}`));
    }
    const snippet = stripHtml(entry.doc.snippet?.slice(0, 300));
    if (snippet)
      lines.push(
        `Snippet: ${snippet}${(entry.doc.snippet?.length ?? 0) > 300 ? "..." : ""}`
      );
    lines.push("");
  });
  return lines.join("\n");
}

/** Filesystem-safe id for a report run (no overwrite). */
export function reportRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Generate a single agent report; writes to .data/agent-reports/{goal}/{id}.md (never overwrites). */
export async function runAgentReport(
  goal: AgentGoal
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!VALID_GOALS.includes(goal)) {
    return { ok: false, error: `Invalid goal: ${goal}` };
  }
  const id = reportRunId();
  const goalDir = path.join(REPORT_DIR, goal);
  try {
    const config = getAgentGoalConfig(goal);
    const periodDays = config.timeHorizonDays;
    const limit = goal === "content_ideas" ? 10 : 20;

    const docs = await retrieveForAgent(goal, { periodDays, maxEnrich: 0 });

    let report: string;
    if (docs.length === 0) {
      report = `# ${config.name}\n\nNo documents retrieved for period ${periodDays} days.\n`;
    } else {
      const ranked = await rankForAgent(goal, docs);
      const shortlist = await buildAgentShortlist(goal, ranked, limit);
      report = formatReport(goal, shortlist);
    }

    if (!fs.existsSync(goalDir)) fs.mkdirSync(goalDir, { recursive: true });
    const outPath = path.join(goalDir, `${id}.md`);
    fs.writeFileSync(outPath, report, "utf-8");
    logger.info("Agent report generated", { goal, id, path: outPath });
    return { ok: true, id };
  } catch (err) {
    logger.error(`Agent report failed: ${goal}`, { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Generate reports for the given goals. Call initializeDatabase() before this if needed. Never overwrites. */
export async function runAgentReports(
  goals: AgentGoal[]
): Promise<{ [key in AgentGoal]?: { ok: boolean; id?: string; error?: string } }> {
  const results: { [key in AgentGoal]?: { ok: boolean; id?: string; error?: string } } = {};
  for (const goal of goals) {
    if (!VALID_GOALS.includes(goal)) continue;
    results[goal] = await runAgentReport(goal);
  }
  return results;
}

export { VALID_GOALS };
