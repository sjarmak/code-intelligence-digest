/**
 * LLM-based shortlist for agent retrieval.
 * Selects and reorders top candidates per agent goal with justifications.
 * Uses the configured quality model (DIGEST_QUALITY_MODEL / getQualityModel()), e.g. Claude Sonnet 4.6.
 */

import { getAgentGoalConfig } from "../../config/agents";
import type { AgentGoal } from "../../config/agents";
import { hasLLMConfigured } from "../llm/config";
import { createChatCompletion } from "../llm/completion";
import { logger } from "../logger";
import type { AgentRankedDoc } from "./agentRank";

export interface ShortlistEntry {
  doc: AgentRankedDoc;
  rank: number;
  selected: boolean;
  reason?: string;
  /** For content_ideas goal: 1–2 concrete content ideas derived from this source */
  contentIdeas?: string[];
}

/** Strip HTML tags and normalize whitespace so report output is plain text. */
function stripHtml(s: string | undefined): string {
  if (s == null || s === "") return "";
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getShortlistInstructionsForGoal(goal: AgentGoal, limit: number): string {
  switch (goal) {
    case "content_ideas":
      return `- Select the best ${limit} sources that clearly support this goal. Prefer articles, webinars, white papers, case studies, and docs; deprioritize social media posts (Instagram, TikTok, Twitter/X, Facebook) unless they are the only strong fit.
- You may select fewer if few are relevant.
`;
    case "market_brief":
      return `- Select the best ${limit} sources that clearly support this goal. You may select fewer if few are relevant.
- For the "reason" field: do NOT just summarize what the article is about. Instead explain how this source directly informs go-to-market strategy—e.g. implications for positioning or messaging, channel or campaign priorities, ICP validation, competitive moves, market timing, pricing/positioning signals, or where we should double down or pivot. One to two sentences, strategy-focused.
`;
    case "competitor_intel":
      return `- Exclude Sourcegraph (our product); only include external competitors and ecosystem tools.
- Include at least 2–3 sources that are primarily about direct code-search/codebase competitors (e.g. Augment Code, Moderne, OpenGrok, GitHub MCP); the rest can be ecosystem tools (Cursor, Copilot, Claude Code, SWE-bench Pro, etc.).
- Maximize diversity: do not use multiple slots on the same product. At most one source per product/company unless they cover clearly different developments (e.g. a launch and a separate partnership).
- Prefer substantive competitor moves: launches, positioning, partnerships, benchmarks, pricing, or ecosystem news. Deprioritize minor version release notes and changelogs—if you include any, at most one per product and only when nothing more substantive is available.
- Select the best ${limit} sources that clearly support this goal. You may select fewer if few are relevant.
`;
    default:
      return `- Select the best ${limit} sources that clearly support this goal. You may select fewer if few are relevant.
`;
  }
}

/**
 * Build a shortlist of docs for an agent goal: quality model selects best subset and adds reasons.
 * If no LLM is configured, returns the top `limit` docs by existing agentScore.
 */
export async function buildAgentShortlist(
  goal: AgentGoal,
  docs: AgentRankedDoc[],
  limit: number
): Promise<ShortlistEntry[]> {
  const config = getAgentGoalConfig(goal);

  if (docs.length === 0) {
    return [];
  }
  if (!hasLLMConfigured()) {
    throw new Error("LLM required for agent shortlist. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (and optionally DIGEST_QUALITY_MODEL).");
  }

  const candidateList = docs.slice(0, 40).map((d, i) => {
    const snippet = (d.snippet ?? d.content ?? "").slice(0, 200);
    return `${i + 1}. ${d.title}\n   ${snippet || "(no snippet)"}`;
  });

  const goalSpecificInstructions = getShortlistInstructionsForGoal(goal, limit);
  const prompt = `You are selecting the most relevant sources for the "${config.name}" agent.

Goal: ${config.description}
Target audience (ICP): ${config.icpDescription}

Candidates (pre-ranked by relevance; you may reorder and drop weak fits):
${candidateList.join("\n\n")}

Instructions:
${goalSpecificInstructions}
- For each selected item, provide a complete "reason" (1–2 full sentences). Do not truncate; give the full thought.
${goal === "content_ideas" ? `- You MUST also add "content_ideas" to each object: an array of 1–2 concrete, actionable content ideas inspired by that source. Examples: "Blog post: How to scale code search in monorepos", "Webinar: Demos of AI coding assistants", "Case study: Enterprise adoption of AI pair programming". Every selected item must include content_ideas.` : ""}
- Use plain text only in all string fields; do not use HTML, markdown, or tags.
- Return a JSON array of objects: [{"index": 1-based number from the list above, "reason": "why it's relevant"${goal === "content_ideas" ? ', "content_ideas": ["idea one", "idea two"]' : ""}}]. Only include selected items, in order of relevance (best first).
- If none are relevant, return [].

Return only the JSON array, no other text.`;

  const maxTokens = goal === "content_ideas" ? 2500 : 3000;
  try {
    const result = await createChatCompletion({
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    });
    const content = (result.content ?? "").trim() || "[]";
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    type SelectedItem = { index: number; reason?: string; content_ideas?: string[]; "content ideas"?: string[] };
    const selected: SelectedItem[] = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    const shortlistResult: ShortlistEntry[] = [];
    let rank = 1;
    for (const entry of selected) {
      const idx = entry.index - 1;
      if (idx >= 0 && idx < docs.length) {
        const reason = stripHtml(entry.reason);
        const rawIdeas = entry.content_ideas ?? (entry as Record<string, unknown>)["content ideas"];
        const ideaList = Array.isArray(rawIdeas)
          ? rawIdeas
          : typeof rawIdeas === "string" && rawIdeas.trim()
            ? [rawIdeas]
            : [];
        const contentIdeas = ideaList
          .map((s) => stripHtml(typeof s === "string" ? s : String(s)))
          .filter(Boolean);
        shortlistResult.push({
          doc: docs[idx],
          rank: rank++,
          selected: true,
          reason: reason || undefined,
          contentIdeas: contentIdeas.length > 0 ? contentIdeas : undefined,
        });
      }
    }
    if (goal === "content_ideas") {
      const withIdeas = shortlistResult.filter((r) => r.contentIdeas?.length);
      logger.info("Content ideas shortlist", { total: shortlistResult.length, withContentIdeas: withIdeas.length });
    }
    // If LLM returned too few or invalid, fill with top by score
    const included = new Set(shortlistResult.map((r) => r.doc.id ?? r.doc.url ?? r.doc.title));
    for (const doc of docs) {
      if (shortlistResult.length >= limit) break;
      const key = doc.id ?? doc.url ?? doc.title;
      if (included.has(key)) continue;
      included.add(key);
      shortlistResult.push({ doc, rank: rank++, selected: true });
    }

    logger.info("Agent shortlist built", { goal, requested: limit, selected: shortlistResult.length });
    return shortlistResult.slice(0, limit);
  } catch (error) {
    logger.error("Agent shortlist LLM failed", { goal, error });
    throw error;
  }
}
