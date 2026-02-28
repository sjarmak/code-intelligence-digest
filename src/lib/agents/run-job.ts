/**
 * Execute a single GTM/marketing agent job: load items by scope, optional web search, run LLM, save output.
 */

import type { FeedItem } from "../model";
import { loadItemsByCategory } from "../db/items";
import { getJobConfig, type AgentId, type JobId } from "../../config/agent-jobs";
import { mentionsCompetitor } from "../../config/products";
import { createChatCompletion } from "../llm/completion";
import { webSearchForAgentContext } from "../search/url-finder";
import { saveAgentRun } from "../db/agent-runs";
import { logger } from "../logger";
import { gatherCompetitorIntel } from "./competitor-intel";
import { generateMarketBrief } from "./market-brief";
import { generateContentIdeas } from "./content-ideas";
import { formatContentIdeasMarkdown, formatMarketBriefMarkdown } from "./format-structured-reports";

const MAX_CONTEXT_ITEMS = 50;
const MAX_CHARS_PER_ITEM = 4000;

function itemTextForFilter(item: FeedItem): string {
  const parts = [
    item.title ?? "",
    item.summary ?? "",
    item.contentSnippet ?? "",
    item.fullText ?? "",
  ].filter(Boolean);
  return parts.join("\n");
}

function itemContextBlock(item: FeedItem, index: number): string {
  const parts = [
    item.title ?? "",
    `Source: ${item.sourceTitle ?? "Unknown"}`,
    item.summary ?? "",
    item.contentSnippet ?? "",
  ];
  let text = parts.filter(Boolean).join("\n");
  if (item.fullText && item.fullText.length > 0) {
    const truncated =
      item.fullText.length > MAX_CHARS_PER_ITEM
        ? item.fullText.slice(0, MAX_CHARS_PER_ITEM) + "\n[... truncated ...]"
        : item.fullText;
    text += "\n\n" + truncated;
  }
  return `--- [${index + 1}] ${item.title ?? item.id} ---\n${text}`;
}

/**
 * Load items for the job's scope: multiple categories, optional competitor-only filter.
 * Returns items sorted by publishedAt desc, limited to maxItems.
 */
async function loadItemsForScope(
  categories: readonly string[],
  competitorsOnly: boolean,
  periodDays: number,
  maxItems: number
): Promise<FeedItem[]> {
  const byId = new Map<string, FeedItem>();
  for (const category of categories) {
    const items = await loadItemsByCategory(category, periodDays);
    for (const item of items) {
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
  }
  let list = Array.from(byId.values());
  if (competitorsOnly) {
    list = list.filter((item) => mentionsCompetitor(itemTextForFilter(item)));
  }
  list.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return list.slice(0, Math.min(maxItems, MAX_CONTEXT_ITEMS));
}

/**
 * Run one agent job and persist the result.
 * Returns the agent run id, or null if job config not found or LLM unavailable.
 */
export async function runAgentJob(
  agentId: AgentId,
  jobId: JobId
): Promise<{ runId: string; title: string } | null> {
  const job = getJobConfig(agentId, jobId);
  if (!job) {
    logger.warn("Agent job not found", { agentId, jobId });
    return null;
  }

  // Competitor intel scheduled jobs persist strict, structured output
  // using the retrieval+triage contract (no narrative rewrite).
  if (agentId === "competitive_intel") {
    const periodDays = job.periodDays ?? 90;
    const topPerCompetitor = jobId === "weekly_competitor_summary" ? 7 : 5;
    const topOverall = jobId === "weekly_competitor_summary" ? 30 : 20;
    const items = await gatherCompetitorIntel({
      periodDays,
      topPerCompetitor,
      topOverall,
      maxGeneratedQueries: 12,
      webDocsPerQuery: 2,
      maxWebQueriesPerCompetitor: 2,
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    const title = `${job.name} (${dateStr})`;

    const payload = {
      goal: "competitor_intel",
      periodDays,
      topPerCompetitor,
      topOverall: items.length,
      items,
      generatedAt: new Date().toISOString(),
    };

    const markdown = [
      `# ${title}`,
      "",
      "```json",
      JSON.stringify(payload, null, 2),
      "```",
      "",
    ].join("\n");

    const runId = await saveAgentRun(agentId, jobId, title, markdown, {
      itemCount: items.length,
      periodDays,
      topPerCompetitor,
      topOverall: items.length,
      structuredOutput: true,
    });

    logger.info("Agent job completed with structured competitor intel", {
      agentId,
      jobId,
      runId,
      itemCount: items.length,
    });
    return { runId, title };
  }

  if (agentId === "icp_market") {
    const periodDays = job.periodDays ?? 14;
    const payload = await generateMarketBrief({ periodDays, maxItems: job.maxItems ?? 20 });
    const dateStr = new Date().toISOString().slice(0, 10);
    const title = `${job.name} (${dateStr})`;
    const markdown = formatMarketBriefMarkdown(title, payload);
    const runId = await saveAgentRun(agentId, jobId, title, markdown, {
      itemCount: payload.executive_delta.length + payload.watch_items.length,
      periodDays,
      structuredOutput: true,
      playbookVersion: payload.playbook_version,
      structuredPayload: payload,
    });
    logger.info("Agent job completed with structured market brief", {
      agentId,
      jobId,
      runId,
    });
    return { runId, title };
  }

  if (agentId === "gtm_content") {
    const periodDays = job.periodDays ?? 30;
    const payload = await generateContentIdeas({ periodDays, numIdeas: job.maxItems ?? 10 });
    const dateStr = new Date().toISOString().slice(0, 10);
    const title = `${job.name} (${dateStr})`;
    const markdown = formatContentIdeasMarkdown(title, payload);
    const runId = await saveAgentRun(agentId, jobId, title, markdown, {
      itemCount: payload.ideas.length,
      periodDays,
      structuredOutput: true,
      playbookVersion: payload.playbook_version,
      structuredPayload: payload,
    });
    logger.info("Agent job completed with structured content ideas", {
      agentId,
      jobId,
      runId,
    });
    return { runId, title };
  }

  const periodDays = job.periodDays ?? 3;
  const maxItems = job.maxItems ?? 25;
  const items = await loadItemsForScope(
    job.scope.categories,
    job.scope.competitorsOnly ?? false,
    periodDays,
    maxItems
  );

  if (items.length === 0) {
    logger.info("No items for agent job, skipping", {
      agentId,
      jobId,
      categories: job.scope.categories,
      competitorsOnly: job.scope.competitorsOnly,
    });
    const dateStr = new Date().toISOString().slice(0, 10);
    const title = `${job.name} (${dateStr}) – no sources`;
    const runId = await saveAgentRun(
      agentId,
      jobId,
      title,
      "_No recent items matched the scope. Try again after more content is synced._",
      { itemCount: 0 }
    );
    return { runId, title };
  }

  let context = items.map((item, i) => itemContextBlock(item, i)).join("\n\n");
  const dateStr = new Date().toISOString().slice(0, 10);

  if (job.webSearchQueries) {
    const queries = job.webSearchQueries(dateStr);
    const webResults = await webSearchForAgentContext(queries);
    if (webResults.length > 0) {
      const webBlock = webResults
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title} — ${r.snippet ? r.snippet.slice(0, 300) + (r.snippet.length > 300 ? "…" : "") : "No snippet"} — ${r.url}`
        )
        .join("\n");
      context += "\n\n--- Web search results (for verification and additional context) ---\n" + webBlock;
      logger.info("Agent job web search added to context", {
        agentId,
        jobId,
        resultCount: webResults.length,
      });
    }
  }

  const { system, user } = job.buildPrompt(context, dateStr);

  try {
    const result = await createChatCompletion({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 2000,
    });
    const content = result.content.trim() || "_Model returned empty response._";

    const title = `${job.name} (${dateStr})`;
    const runId = await saveAgentRun(agentId, jobId, title, content, {
      itemCount: items.length,
      periodDays,
    });
    logger.info("Agent job completed", {
      agentId,
      jobId,
      runId,
      itemCount: items.length,
      model: result.model,
    });
    return { runId, title };
  } catch (error) {
    logger.error("Agent job LLM call failed", {
      agentId,
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
