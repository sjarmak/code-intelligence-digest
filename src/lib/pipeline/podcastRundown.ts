/**
 * Stage B: Podcast rundown generation (editorial clustering)
 * Uses gpt-4o-mini to select stories, cluster by theme, decide order
 * Produces segments with time budgets, transitions, and attribution plan
 */

import OpenAI from "openai";
import { Category } from "../model";
import { PodcastItemDigest, filterPodcastDigestsByQuality } from "./podcastDigest";
import { PromptProfile } from "./promptProfile";
import { logger } from "../logger";

/**
 * Check if URL is valid for podcast (not Inoreader, not empty, http/https)
 */
function isValidPodcastUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  if (url.includes("inoreader.com") || url.includes("google.com/reader")) return false;
  if (url.includes("reddit.com/r/") || url.includes("reddit.com/u/")) return false;
  if (url.includes("news.google.com/rss/")) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

export interface PodcastSegment {
  name: string;
  time_seconds: number;
  stories_used: string[]; // URLs
  key_points_to_say: string[];
  nuance_or_uncertainty: string[];
  transition_line: string;
}

export interface PodcastLightningRound {
  headline: string;
  url: string;
}

export interface PodcastRundown {
  episode_title: string;
  cold_open: string; // Hook, 2-3 sentences
  segments: PodcastSegment[]; // Max 4
  lightning_round: PodcastLightningRound[];
  cut_list: string[]; // Stories not covered
  attribution_plan: Array<{
    url: string;
    spoken_attribution: string;
  }>;
  total_time_seconds: number;
}

/**
 * Lazy-load OpenAI client
 */
function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new OpenAI({ apiKey });
}

/**
 * Format digests as JSON context for rundown generation
 */
function formatDigestsForRundown(digests: PodcastItemDigest[]): string {
  return JSON.stringify(
    digests.map((d, idx) => ({
      index: idx,
      url: d.url,
      title: d.title,
      source: d.source_name,
      gist: d.one_sentence_gist,
      key_facts: d.key_facts.slice(0, 3), // Top 3 facts
      takeaway: d.one_line_takeaway,
      who_affected: d.who_affected,
      uncertainty: d.uncertainty_or_conflicts,
      credibility: d.credibility_notes,
      relevance: d.relevance_to_focus,
    })),
    null,
    2
  );
}

/**
 * Generate podcast rundown from digests
 */
export async function generatePodcastRundown(
  digests: PodcastItemDigest[],
  period: "week" | "month",
  _categories: Category[],
  profile: PromptProfile | null
): Promise<PodcastRundown> {
  // Filter digests with invalid URLs before processing
  const validDigests = digests.filter(d => isValidPodcastUrl(d.url));
  if (validDigests.length < digests.length) {
    logger.info(`Filtered out ${digests.length - validDigests.length} digests with invalid URLs before rundown generation`);
  }

  // Apply quality review filter
  const qualityDigests = filterPodcastDigestsByQuality(validDigests);

  if (qualityDigests.length === 0) {
    return generateFallbackRundown([], period, []);
  }

  logger.info(
    `Generating podcast rundown for ${qualityDigests.length} digests, period=${period}, categories=${_categories.join(",")}`
  );

  const digestContext = formatDigestsForRundown(qualityDigests);
  const periodLabel = period === "week" ? "weekly" : "monthly";
  const categoryLabels = _categories.join(", ");

  const client = getClient();
  if (!client) {
    logger.warn("OPENAI_API_KEY not set, using fallback rundown");
    return generateFallbackRundown(qualityDigests, period, _categories);
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 8000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `You are a podcast producer building a 5–10 minute (300–600 seconds) ${periodLabel} tech podcast rundown.

Categories: ${categoryLabels}
${profile ? `User focus topics: ${profile.focusTopics.join(", ")}` : ""}

Item digests (JSON):
${digestContext}

EDITORIAL TASK:
1. Pick 3–5 stories max (aim for 4)
2. Cluster by theme (not source)
3. Allocate time: ~90–120 sec per segment, 30–60 sec lightning round
4. Decide order for comprehension and engagement
5. Prefer high-credibility and high-relevance items
6. Note what you're NOT covering (cut list)
7. Plan how to attribute each story aloud

TARGET STRUCTURE (300–600 seconds):
- Cold open: 20–30s hook (what's in today's episode)
- Intro: 30–45s (3 bullet points about what's coming)
- 3–4 main segments: ~90–150s each
- Lightning round (optional): 60–90s (3 small items, 1–2 sentences each)
- Outro: 20–30s (recap + show notes pointer)

OUTPUT STRICT JSON (no markdown):
{
  "episode_title": "string (catchy, not hype)",
  "cold_open": "string (2–3 sentences, conversational, clear value)",
  "segments": [
    {
      "name": "string (theme name, e.g., 'Code Search Tooling')",
      "time_seconds": 120,
      "stories_used": ["url1", "url2"],
      "key_points_to_say": ["string", "..."],
      "nuance_or_uncertainty": ["string", "..."],
      "transition_line": "string (1-liner to next segment)"
    }
  ],
  "lightning_round": [
    {"headline": "string (1 sentence)", "url": "string"}
  ],
  "cut_list": ["string", "..."],
  "attribution_plan": [
    {"url": "string", "spoken_attribution": "string (e.g., 'According to the Pragmatic Engineer post...'}"}
  ]
}

TONE RULES:
- No hype ("this is insane", "game-changer")
- Measured verbs: "suggests", "indicates", "reports"
- Separate "what we know" (facts) vs "what we think" (analysis) vs "what we're unsure about"
- Always prefer primary sources (official docs, filings, research papers)
- Be clear about credibility and conflicts of interest

CONSTRAINTS:
- Max 4 main segments
- Total 300–600 seconds
- At least 3 stories covered in main segments
- Lightning round max 3 items
- Cold open under 30 seconds
- Every story must have audible attribution in attribution_plan

Return ONLY valid JSON.`,
        },
      ],
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No rundown from LLM");
    }

    const rundown = JSON.parse(content) as PodcastRundown;

    // Validate and normalize
    const segments = (rundown.segments || []).slice(0, 4);
    const totalTime = segments.reduce((sum, s) => sum + (s.time_seconds || 0), 0) +
                      ((rundown.lightning_round?.length || 0) > 0 ? 60 : 0) + 60; // Add lightning + intro/outro

    return {
      episode_title: rundown.episode_title || "Code Intelligence Digest",
      cold_open: rundown.cold_open || "Latest in code search, AI agents, and developer tools.",
      segments,
      lightning_round: rundown.lightning_round || [],
      cut_list: rundown.cut_list || [],
      attribution_plan: rundown.attribution_plan || [],
      total_time_seconds: Math.min(600, Math.max(300, totalTime)),
    };
  } catch (error) {
    logger.warn("LLM rundown generation failed, using fallback", { error });
    return generateFallbackRundown(digests, period, _categories);
  }
}

/**
 * Fallback rundown when LLM fails
 */
function generateFallbackRundown(
  digests: PodcastItemDigest[],
  period: "week" | "month",
  _categories: Category[]
): PodcastRundown {
  const periodLabel = period === "week" ? "weekly" : "monthly";

  // Take top 4 digests
  const topDigests = digests.slice(0, 4);

  const segments: PodcastSegment[] = topDigests.map((d, idx) => ({
    name: d.one_line_takeaway.substring(0, 50),
    time_seconds: 120,
    stories_used: [d.url],
    key_points_to_say: d.key_facts.slice(0, 2),
    nuance_or_uncertainty: d.uncertainty_or_conflicts,
    transition_line: idx < topDigests.length - 1 ? "Next up..." : "Finally...",
  }));

  const attributionPlan = digests.map(d => ({
    url: d.url,
    spoken_attribution: `According to ${d.source_name}...`,
  }));

  return {
    episode_title: `Code Intelligence Digest – ${periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)}`,
    cold_open: `Welcome to this week's digest. We're covering ${topDigests.length} stories on code intelligence, agents, and developer tools.`,
    segments,
    lightning_round: digests.slice(4, 7).map(d => ({
      headline: d.one_sentence_gist.substring(0, 80),
      url: d.url,
    })),
    cut_list: digests.slice(7).map(d => d.title),
    attribution_plan: attributionPlan,
    total_time_seconds: 420,
  };
}
