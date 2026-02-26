/**
 * LLM-based shortlist for agent retrieval.
 * Selects and reorders top candidates per agent goal with justifications.
 * Uses Anthropic Claude Sonnet 4.6 (ANTHROPIC_API_KEY).
 */

import Anthropic from "@anthropic-ai/sdk";
import { getAgentGoalConfig } from "../../config/agents";
import type { AgentGoal } from "../../config/agents";
import { logger } from "../logger";
import type { AgentRankedDoc } from "./agentRank";

const AGENT_MODEL = "claude-sonnet-4-6";

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

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
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
- Include at least 2–3 sources that are primarily about direct code-search/codebase competitors (e.g. Augment Code, Moderne, OpenGrok, GitHub MCP); the rest can be ecosystem tools (Cursor, Copilot, Claude Code, etc.).
- Select the best ${limit} sources that clearly support this goal. You may select fewer if few are relevant.
`;
    default:
      return `- Select the best ${limit} sources that clearly support this goal. You may select fewer if few are relevant.
`;
  }
}

/**
 * Build a shortlist of docs for an agent goal: Claude Sonnet 4.6 selects best subset and adds reasons.
 * If ANTHROPIC_API_KEY is not set, returns the top `limit` docs by existing agentScore.
 */
export async function buildAgentShortlist(
  goal: AgentGoal,
  docs: AgentRankedDoc[],
  limit: number
): Promise<ShortlistEntry[]> {
  const config = getAgentGoalConfig(goal);
  const client = getAnthropic();

  if (!client || docs.length === 0) {
    return docs.slice(0, limit).map((doc, i) => ({
      doc,
      rank: i + 1,
      selected: true,
    }));
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
- For each selected item, provide a short reason (one sentence) why it is useful for this goal.
${goal === "content_ideas" ? `- For content_ideas only: also add "content_ideas": an array of 1–2 concrete content ideas inspired by this source (e.g. "Blog post: How to scale code search in monorepos", "Webinar: Demos of AI coding assistants"). Be specific and actionable.` : ""}
- Use plain text only in all string fields; do not use HTML, markdown, or tags.
- Return a JSON array of objects: [{"index": 1-based number from the list above, "reason": "why it's relevant"${goal === "content_ideas" ? ', "content_ideas": ["idea1", "idea2"]' : ""}}]. Only include selected items, in order of relevance (best first).
- If none are relevant, return [].

Return only the JSON array, no other text.`;

  try {
    const response = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const content = (textBlock && "text" in textBlock ? textBlock.text : "").trim() || "[]";
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    type SelectedItem = { index: number; reason?: string; content_ideas?: string[] };
    const selected: SelectedItem[] = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    const result: ShortlistEntry[] = [];
    let rank = 1;
    for (const entry of selected) {
      const idx = entry.index - 1;
      if (idx >= 0 && idx < docs.length) {
        const reason = stripHtml(entry.reason);
        const contentIdeas = (entry.content_ideas ?? [])
          .map((s) => stripHtml(s))
          .filter(Boolean);
        result.push({
          doc: docs[idx],
          rank: rank++,
          selected: true,
          reason: reason || undefined,
          contentIdeas: contentIdeas.length > 0 ? contentIdeas : undefined,
        });
      }
    }
    // If LLM returned too few or invalid, fill with top by score
    const included = new Set(result.map((r) => r.doc.id ?? r.doc.url ?? r.doc.title));
    for (const doc of docs) {
      if (result.length >= limit) break;
      const key = doc.id ?? doc.url ?? doc.title;
      if (included.has(key)) continue;
      included.add(key);
      result.push({ doc, rank: rank++, selected: true });
    }

    logger.info("Agent shortlist built", { goal, requested: limit, selected: result.length });
    return result.slice(0, limit);
  } catch (error) {
    logger.warn("Agent shortlist LLM failed, using score order", { goal, error });
    return docs.slice(0, limit).map((doc, i) => ({
      doc,
      rank: i + 1,
      selected: true,
    }));
  }
}
