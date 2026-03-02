/**
 * Generate agent reports (content_ideas, market_brief, competitor_intel).
 * Retrieve → rank → shortlist → format → write to .data/agent-reports/.
 */

import path from "path";
import fs from "fs";
import { retrieveForAgent } from "../pipeline/agentRetrieval";
import { rankForAgent } from "../pipeline/agentRank";
import { buildAgentShortlist, type ShortlistEntry } from "../pipeline/agentShortlist";
import { getAgentGoalConfig } from "../../config/agents";
import type { AgentGoal } from "../../config/agents";
import { getDomainFromUrl } from "../../config/competitor-intel";
import { logger } from "../logger";
import { saveReport } from "./report-storage";
import { gatherCompetitorIntel } from "./competitor-intel";
import { generateMarketBrief } from "./market-brief";
import type { ContentIdea, ContentIdeasOutput } from "./content-ideas";
import { formatCompetitorIntelMarkdown, formatContentIdeasMarkdown, formatMarketBriefMarkdown } from "./format-structured-reports";
import { loadPlaybookState } from "./playbook-state";

const REPORT_DIR = path.resolve(process.cwd(), ".data", "agent-reports");

const VALID_GOALS: AgentGoal[] = ["content_ideas", "market_brief", "competitor_intel"];
export type ReportTimeRange = "day" | "week" | "month" | "year";

const RANGE_TO_DAYS: Record<ReportTimeRange, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

/** Max period days for report generation to avoid OOM (e.g. competitor intel with 365d loads too much). */
const MAX_REPORT_PERIOD_DAYS = 90;

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

/** Build ContentIdeasOutput from LLM shortlist so we can use formatContentIdeasMarkdown. */
function contentIdeasPayloadFromShortlist(
  shortlist: ShortlistEntry[],
  periodDays: number
): ContentIdeasOutput {
  const state = loadPlaybookState();
  const ideas: ContentIdea[] = shortlist.map((entry, i) => {
    const doc = entry.doc;
    const source = doc.url ? getDomainFromUrl(doc.url) : "internal";
    const date = doc.publishedAt ? doc.publishedAt.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const thesis = entry.reason ?? "Selected for relevance to content ideas goal.";
    const keyIdeas = entry.contentIdeas ?? [];
    return {
      title: doc.title ?? "Untitled",
      thesis,
      target_segment: "Other",
      target_persona: "VP Engineering",
      funnel_stage: "awareness",
      channel: "blog",
      why_now: "From selected source; timing supports current GTM priorities.",
      playbook_alignment: state.campaign_themes.slice(0, 2),
      sources: doc.url
        ? [{ title: doc.title ?? "Source", source, url: doc.url, date }]
        : [],
      core_claim: thesis.slice(0, 200),
      key_insights: keyIdeas.length > 0 ? keyIdeas : [thesis.slice(0, 150)],
      content_outline: keyIdeas.length > 0 ? keyIdeas : ["Draft outline from source"],
      proof_required: ["product evidence", "external trend"],
      guardrails: state.messaging_guardrails,
      integration_opportunity: "high_opportunity",
      sourcegraph_integration_play: [
        "Use Sourcegraph as the agent context layer: fetch cross-repo symbols, ownership, and usage paths before generation.",
        "Add a Sourcegraph-backed verification step: compare proposed edits against references/tests before merge.",
      ],
      distribution_plan: {
        primary_format: "Blog post",
        recommended_venue: "Company blog and content hub",
        channel_strategy: "Blog as anchor; distribute via email and social.",
        setup_steps: ["Define thesis and persona", "Draft outline", "Review with PMM"],
      },
      priority_score: 1 - (i + 1) / 100,
    };
  });
  return {
    generated_at: new Date().toISOString().slice(0, 10),
    playbook_version: state.playbook_version,
    periodDays,
    ideas,
  };
}

/** Generate a single agent report; writes to .data/agent-reports/{goal}/{id}.md (never overwrites). */
export async function runAgentReport(
  goal: AgentGoal,
  userId: string = "legacy",
  timeRange?: ReportTimeRange,
  /** When goal is content_ideas, pass market brief findings so ideas are informed by the same research. */
  marketBriefSummary?: string | null,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!VALID_GOALS.includes(goal)) {
    return { ok: false, error: `Invalid goal: ${goal}` };
  }
  const id = reportRunId();
  const goalDir = path.join(REPORT_DIR, goal);
  try {
    const config = getAgentGoalConfig(goal);
    const rawDays = timeRange ? RANGE_TO_DAYS[timeRange] : config.timeHorizonDays;
    const periodDays = Math.min(rawDays, MAX_REPORT_PERIOD_DAYS);
    const limit = goal === "content_ideas" ? 10 : 20;

    let report: string;
    if (goal === "market_brief") {
      const payload = await generateMarketBrief({ periodDays, maxItems: limit });
      report = formatMarketBriefMarkdown("Market Brief Agent Report", payload);
    } else if (goal === "content_ideas") {
      const docs = await retrieveForAgent("content_ideas", { periodDays, maxEnrich: 0 });
      const docsWithBrief = marketBriefSummary?.trim()
        ? [
            ...docs,
            {
              id: "internal://market-brief-highlights",
              source: "web" as const,
              url: "internal://market-brief-highlights",
              title: "Market brief highlights",
              snippet: marketBriefSummary.trim().slice(0, 500),
              content: marketBriefSummary.trim(),
              publishedAt: new Date(),
              metadata: {},
            },
          ]
        : docs;
      const ranked = await rankForAgent("content_ideas", docsWithBrief);
      const shortlist = await buildAgentShortlist("content_ideas", ranked, limit);
      const payload = contentIdeasPayloadFromShortlist(shortlist, periodDays);
      report = formatContentIdeasMarkdown("Content Ideas Agent Report", payload);
    } else if (goal === "competitor_intel") {
      const competitorLimit = 45;
      const competitorTopPer = 8;
      const items = await gatherCompetitorIntel({
        periodDays,
        topPerCompetitor: competitorTopPer,
        topOverall: competitorLimit,
        maxGeneratedQueries: 20,
        webDocsPerQuery: 4,
        maxWebQueriesPerCompetitor: 3,
        internalDocsLimit: 800,
      });
      report = formatCompetitorIntelMarkdown("Competitor Intel Agent Report", {
        generatedAt: new Date().toISOString(),
        periodDays,
        topPerCompetitor: competitorTopPer,
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
  timeRange?: ReportTimeRange,
): Promise<{ [key in AgentGoal]?: { ok: boolean; id?: string; error?: string } }> {
  const results: { [key in AgentGoal]?: { ok: boolean; id?: string; error?: string } } = {};
  let marketBriefMarkdown: string | null = null;

  const runOrder: AgentGoal[] = goals.includes("market_brief")
    ? ["market_brief", ...goals.filter((g) => g !== "market_brief")]
    : goals;

  for (const goal of runOrder) {
    if (!VALID_GOALS.includes(goal)) continue;
    if (goal === "market_brief") {
      results[goal] = await runAgentReport(goal, userId, timeRange);
      if (results[goal]?.ok && results[goal]?.id) {
        const briefPath = path.join(REPORT_DIR, "market_brief", `${results[goal]!.id}.md`);
        if (fs.existsSync(briefPath)) {
          marketBriefMarkdown = fs.readFileSync(briefPath, "utf-8");
        }
      }
    } else if (goal === "content_ideas" && marketBriefMarkdown) {
      results[goal] = await runAgentReport(goal, userId, timeRange, marketBriefMarkdown);
    } else {
      results[goal] = await runAgentReport(goal, userId, timeRange);
    }
  }
  return results;
}

export { VALID_GOALS };
