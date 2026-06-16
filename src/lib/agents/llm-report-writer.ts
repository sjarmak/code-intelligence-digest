/**
 * LLM-backed report writer: uses the quality model (e.g. Sonnet 4.6) to synthesize
 * Executive Delta, Content Ideas, and Competitor Intel reports from structured payloads.
 * Drops off-topic items and produces markdown. Callers fall back to format*Markdown when
 * LLM is unavailable or the call fails.
 */

import { createChatCompletion } from "../llm/completion";
import { hasLLMConfigured } from "../llm/config";
import { logger } from "../logger";
import { isAgentLlmTimeoutError, withAgentLlmTimeout } from "./llm-timeout";
import { resolveAgentPrompt } from "./prompt-store";
import type { MarketBriefOutput } from "./market-brief";
import type { ContentIdeasOutput } from "./content-ideas";
import type { RankedCompetitorIntelItem } from "./competitor-intel";

const MAX_ITEM_TITLE = 120;
const MAX_ITEM_SUMMARY = 280;
const MAX_PAYLOAD_ITEMS = 20;
const MAX_CONTENT_IDEAS = 6;
const MAX_COMPETITOR_ITEMS = 35;

function getContentIdeasLlmModel(): string | undefined {
  const override = process.env.CONTENT_IDEAS_LLM_MODEL?.trim();
  if (override) return override;
  return undefined;
}

function stoppedForLength(reason?: string): boolean {
  return reason === "length" || reason === "max_tokens";
}

function truncate(s: string, max: number): string {
  const t = (s ?? "").trim();
  return t.length <= max ? t : t.slice(0, max) + "…";
}

function buildMarketBriefContext(payload: MarketBriefOutput): string {
  const period = payload.periodDays != null ? `Period: last ${payload.periodDays} days` : "";
  const exec = payload.executive_delta.slice(0, MAX_PAYLOAD_ITEMS).map((d, i) => ({
    bucket: "executive" as const,
    n: i + 1,
    title: truncate(d.title, MAX_ITEM_TITLE),
    why_it_matters: truncate(d.why_it_matters, MAX_ITEM_SUMMARY),
    alignment: d.playbook_alignment,
    evidence: d.evidence.map((e) => `${e.source}: ${e.url}`).join("; "),
    integration: d.integration_opportunity,
    owner_action: `${d.recommended_action.owner}: ${truncate(d.recommended_action.action, 100)}`,
  }));
  const watch = payload.watch_items.slice(0, 10).map((d, i) => ({
    bucket: "watch" as const,
    n: i + 1,
    title: truncate(d.title, MAX_ITEM_TITLE),
    summary: truncate(d.summary, MAX_ITEM_SUMMARY),
    evidence: d.evidence.map((e) => e.source).join(", "),
  }));
  const inv = payload.invalidations_to_monitor.slice(0, 8);
  return JSON.stringify(
    { period, playbook_version: payload.playbook_version, brief_date: payload.brief_date, executive_delta: exec, watch_items: watch, invalidations_to_monitor: inv },
    null,
    0
  );
}

function buildContentIdeasContext(payload: ContentIdeasOutput): string {
  const period = payload.periodDays != null ? `Period: last ${payload.periodDays} days` : "";
  const ideas = payload.ideas.slice(0, MAX_CONTENT_IDEAS).map((d, i) => ({
    n: i + 1,
    title: truncate(d.title, MAX_ITEM_TITLE),
    thesis: truncate(d.thesis, 260),
    segment_persona: `${d.target_segment} / ${d.target_persona}`,
    stage: d.funnel_stage,
    why_now: truncate(d.why_now, 160),
    core_claim: truncate(d.core_claim, 180),
    key_insights: (d.key_insights ?? []).slice(0, 3).map((s) => truncate(s, 140)),
    content_outline: (d.content_outline ?? []).slice(0, 3).map((s) => truncate(s, 140)),
    integration_play: (d.sourcegraph_integration_play ?? []).slice(0, 2),
    primary_format: d.distribution_plan?.primary_format,
    sources: (d.sources ?? []).slice(0, 3).map((s) => ({
      source: s.source,
      title: truncate(s.title, 120),
      url: s.url,
      date: s.date,
    })),
  }));
  return JSON.stringify(
    {
      period,
      playbook_version: payload.playbook_version,
      generated_at: payload.generated_at,
      llm_debug: payload.llm_debug,
      ideas,
    },
    null,
    0
  );
}

function stripDroppedIdeasSection(markdown: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const isDroppedHeader =
      /^\s*(#{1,6}\s*)?dropped ideas\b/i.test(line) ||
      /^\s*dropped ideas\s*:/i.test(line);
    if (isDroppedHeader) {
      skipping = true;
      continue;
    }
    const startsNewIdea = /^\s*###\s+\d+\./.test(line);
    const startsMajorSection = /^\s*##\s+/.test(line);
    if (skipping && (startsNewIdea || startsMajorSection)) {
      skipping = false;
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n").trim();
}

function buildCompetitorIntelContext(items: RankedCompetitorIntelItem[], periodDays: number): string {
  const list = items.slice(0, MAX_COMPETITOR_ITEMS).map((d, i) => ({
    n: i + 1,
    competitor: d.competitor,
    title: truncate(d.title, MAX_ITEM_TITLE),
    date: d.date,
    source: d.source,
    source_type: d.source_type,
    url: d.url,
    confidence: d.confidence,
    update_type: d.update_type,
    summary: truncate(d.summary, MAX_ITEM_SUMMARY),
    overlap: d.overlap_with_sourcegraph,
    why_it_matters: truncate(d.why_it_matters, 120),
    integration: d.integration_opportunity,
    actionability: d.actionability,
    evidence_notes: d.evidence_notes.slice(0, 3),
  }));
  return JSON.stringify({ periodDays, items: list }, null, 0);
}

/**
 * Call the quality model to synthesize the Market Brief markdown. Returns null if LLM is not configured or the call fails.
 */
export async function writeMarketBriefWithLLM(
  payload: MarketBriefOutput,
  title: string
): Promise<string | null> {
  if (!hasLLMConfigured()) return null;
  const context = buildMarketBriefContext(payload);
  const user = `Write the Market Brief report in markdown.

Title: ${title}
${payload.periodDays != null ? `Period: last ${payload.periodDays} days` : ""}
Playbook version: ${payload.playbook_version}
Brief date: ${payload.brief_date}

Structured candidate items (drop off-topic; keep only GTM-relevant; you may shorten the lists):

${context}

Start the report with: # ${title}
Then: Generated: ${payload.brief_date}
Playbook version: ${payload.playbook_version}
${payload.periodDays != null ? `Period: last ${payload.periodDays} days` : ""}

Then write ## Executive Delta, ## Watch Items, and if applicable ## Invalidations To Monitor. Use only the information from the JSON above; do not invent items or links.`;

  const { system } = resolveAgentPrompt("market_brief_system");

  try {
    const res = await withAgentLlmTimeout(
      "market brief report writer",
      createChatCompletion({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 4000,
      }),
    );
    const raw = (res.content ?? "").trim();
    if (!raw) return null;
    return stripDroppedIdeasSection(raw);
  } catch (e) {
    logger.warn(
      isAgentLlmTimeoutError(e)
        ? "LLM market brief synthesis timed out, will use template fallback"
        : "LLM market brief synthesis failed, will use template fallback",
      {
      error: e instanceof Error ? e.message : String(e),
      },
    );
    return null;
  }
}

/**
 * Call the quality model to synthesize the Content Ideas markdown. Returns null if LLM is not configured or the call fails.
 */
export async function writeContentIdeasWithLLM(
  payload: ContentIdeasOutput,
  title: string
): Promise<string | null> {
  if (!hasLLMConfigured()) {
    payload.llm_debug = {
      ...(payload.llm_debug ?? {}),
      report_writer: { status: "skipped", error: "LLM not configured" },
    };
    return null;
  }
  if (payload.llm_debug?.structured_synthesis_timed_out) {
    payload.llm_debug = {
      ...(payload.llm_debug ?? {}),
      report_writer: { status: "skipped", error: "Skipped after structured synthesis timeout" },
    };
    logger.info("Skipping content ideas report writer after structured synthesis timeout", {
      generated_at: payload.generated_at,
      periodDays: payload.periodDays ?? null,
    });
    return null;
  }
  const context = buildContentIdeasContext(payload);
  const user = `Write the Content Ideas report in markdown.

Title: ${title}
${payload.periodDays != null ? `Period: last ${payload.periodDays} days` : ""}
Playbook version: ${payload.playbook_version}
Generated: ${payload.generated_at}

Structured candidate ideas (drop off-topic; keep only GTM-relevant; you may shorten the list):
Keep only source-grounded and audience-relevant ideas:

${context}

Start the report with: # ${title}
Then: Generated: ${payload.generated_at}
Playbook version: ${payload.playbook_version}
${payload.periodDays != null ? `Period: last ${payload.periodDays} days` : ""}

Then write ## Prioritized Ideas. Use only the information from the JSON above; do not invent items or links.`;

  const { system } = resolveAgentPrompt("content_ideas_system");

  try {
    const res = await withAgentLlmTimeout(
      "content ideas report writer",
      createChatCompletion({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        model: getContentIdeasLlmModel(),
        max_tokens: 2200,
      }),
    );
    const raw = (res.content ?? "").trim();
    if (!raw) {
      payload.llm_debug = {
        ...(payload.llm_debug ?? {}),
        report_writer: {
          status: "error",
          provider: res.provider,
          model: res.model,
          error: "Empty content",
        },
      };
      return null;
    }
    payload.llm_debug = {
      ...(payload.llm_debug ?? {}),
      report_writer: {
        status: "success",
        provider: res.provider,
        model: res.model,
      },
    };
    return raw;
  } catch (e) {
    payload.llm_debug = {
      ...(payload.llm_debug ?? {}),
      report_writer: {
        status: isAgentLlmTimeoutError(e) ? "timeout" : "error",
        error: e instanceof Error ? e.message : String(e),
      },
    };
    logger.warn(
      isAgentLlmTimeoutError(e)
        ? "LLM content ideas synthesis timed out, will use template fallback"
        : "LLM content ideas synthesis failed, will use template fallback",
      {
      error: e instanceof Error ? e.message : String(e),
      },
    );
    return null;
  }
}

/**
 * Call the quality model to synthesize the Competitor Intel markdown. Returns null if LLM is not configured or the call fails.
 */
export async function writeCompetitorIntelWithLLM(
  items: RankedCompetitorIntelItem[],
  periodDays: number,
  title: string,
  generatedAt: string
): Promise<string | null> {
  if (!hasLLMConfigured()) return null;
  const context = buildCompetitorIntelContext(items, periodDays);
  const user = `Write the Competitor Intel report in markdown.

Title: ${title}
Generated: ${generatedAt}
Window: last ${periodDays} days

Structured items (group by competitor; drop off-topic):

${context}

Start the report with: # ${title}
Then: Generated: ${generatedAt}
Window: last ${periodDays} days

Then write one ## CompetitorName section per competitor, with ### Title and bullets for each item. Use only the information from the JSON above; do not invent items or links.`;

  const { system } = resolveAgentPrompt("competitor_intel_system");

  try {
    const res = await withAgentLlmTimeout(
      "competitor intel report writer",
      createChatCompletion({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 4500,
      }),
    );
    const raw = (res.content ?? "").trim();
    if (!raw) return null;
    if (stoppedForLength(res.finish_reason)) {
      logger.warn("LLM competitor intel synthesis hit token limit, will use template fallback", {
        finish_reason: res.finish_reason,
      });
      return null;
    }
    return raw;
  } catch (e) {
    logger.warn(
      isAgentLlmTimeoutError(e)
        ? "LLM competitor intel synthesis timed out, will use template fallback"
        : "LLM competitor intel synthesis failed, will use template fallback",
      {
      error: e instanceof Error ? e.message : String(e),
      },
    );
    return null;
  }
}
