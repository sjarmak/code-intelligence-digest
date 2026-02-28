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
import { saveReport } from "./report-storage";
import { gatherCompetitorIntel } from "./competitor-intel";
import { generateMarketBrief } from "./market-brief";
import { generateContentIdeas } from "./content-ideas";
import { formatCompetitorIntelMarkdown, formatContentIdeasMarkdown, formatMarketBriefMarkdown } from "./format-structured-reports";

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
  const escapeForHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  shortlist.forEach((entry, i) => {
    lines.push(`### ${i + 1}. ${entry.doc.title}`);
    if (entry.doc.url) lines.push(`URL: ${entry.doc.url}`);
    const reason = stripHtml(entry.reason);
    if (reason) {
      // Single HTML block (no blank line) so markdown doesn't close the block and render </details> as text
      lines.push(`<details><summary><strong>Why</strong></summary><div>${escapeForHtml(reason)}</div></details>`);
      lines.push("");
    }
    if (goal === "content_ideas" && entry.contentIdeas?.length) {
      const ideasHtml = entry.contentIdeas
        .map((idea) => `<li>${escapeForHtml(stripHtml(idea))}</li>`)
        .join("");
      lines.push(`<details><summary><strong>Content ideas</strong></summary><ul>${ideasHtml}</ul></details>`);
      lines.push("");
    }
    const fullSnippet = stripHtml(entry.doc.snippet ?? "");
    if (fullSnippet) {
      lines.push(`<details><summary><strong>Snippet</strong></summary><div>${escapeForHtml(fullSnippet)}</div></details>`);
      lines.push("");
    }
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
  goal: AgentGoal,
  userId: string = "legacy",
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

    let report: string;
    if (goal === "market_brief") {
      const payload = await generateMarketBrief({ periodDays, maxItems: limit });
      report = formatMarketBriefMarkdown("Market Brief Agent Report", payload);
    } else if (goal === "content_ideas") {
      const payload = await generateContentIdeas({ periodDays, numIdeas: limit });
      report = formatContentIdeasMarkdown("Content Ideas Agent Report", payload);
    } else if (goal === "competitor_intel") {
      const items = await gatherCompetitorIntel({
        periodDays,
        topPerCompetitor: 5,
        topOverall: limit,
        // Keep on-demand report generation responsive in production.
        maxGeneratedQueries: 16,
        webDocsPerQuery: 3,
        maxWebQueriesPerCompetitor: 2,
      });
      report = formatCompetitorIntelMarkdown("Competitor Intel Agent Report", {
        generatedAt: new Date().toISOString(),
        periodDays,
        topPerCompetitor: 5,
        items,
      });
    } else {
      const docs = await retrieveForAgent(goal, { periodDays, maxEnrich: 0 });
      if (docs.length === 0) {
        report = `# ${config.name}\n\nNo documents retrieved for period ${periodDays} days.\n`;
      } else {
        const ranked = await rankForAgent(goal, docs);
        const shortlist = await buildAgentShortlist(goal, ranked, limit);
        report = formatReport(goal, shortlist);
      }
    }

    if (!fs.existsSync(goalDir)) fs.mkdirSync(goalDir, { recursive: true });
    const outPath = path.join(goalDir, `${id}.md`);
    fs.writeFileSync(outPath, report, "utf-8");
    const generatedAt = new Date().toISOString();
    await saveReport(goal, id, report, generatedAt, userId).catch((err) =>
      logger.warn("Agent report DB save failed", { goal, id, error: err })
    );
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
  goals: AgentGoal[],
  userId: string = "legacy",
): Promise<{ [key in AgentGoal]?: { ok: boolean; id?: string; error?: string } }> {
  const results: { [key in AgentGoal]?: { ok: boolean; id?: string; error?: string } } = {};
  for (const goal of goals) {
    if (!VALID_GOALS.includes(goal)) continue;
    results[goal] = await runAgentReport(goal, userId);
  }
  return results;
}

export { VALID_GOALS };
