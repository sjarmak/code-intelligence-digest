/**
 * Stage C: Podcast script generation
 * Uses gpt-5.2-pro to write conversational HOST + COHOST script
 * Facts-first tone, natural attribution, measured language
 */

import OpenAI from "openai";
import { Category } from "../model";
import { PodcastItemDigest } from "./podcastDigest";
import { PodcastRundown } from "./podcastRundown";
import { PromptProfile } from "./promptProfile";
import { logger } from "../logger";

/**
 * Check if URL is valid for podcast script (not Inoreader, not Reddit, not Google News redirect)
 */
function isValidScriptUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  if (url.includes("inoreader.com") || url.includes("google.com/reader")) return false;
  if (url.includes("reddit.com/r/") || url.includes("reddit.com/u/")) return false;
  if (url.includes("news.google.com/rss/")) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

export interface PodcastScript {
  transcript: string; // Full markdown script with timestamps
  segments: Array<{
    title: string;
    startTime: string;
    endTime: string;
    duration: number; // seconds
  }>;
  estimatedDuration: string; // "MM:SS"
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
 * Format digests as concise context for scriptwriter
 */
function formatDigestsForScript(digests: PodcastItemDigest[]): string {
  return digests
    .map(
      (d) => `
[${d.url}]
Title: "${d.title}"
Source: ${d.source_name}
Gist: ${d.one_sentence_gist}

Key Facts:
${d.key_facts.map((f) => `- ${f}`).join("\n")}

Takeaway: ${d.one_line_takeaway}
Uncertainty: ${d.uncertainty_or_conflicts.join("; ") || "None noted"}
Credibility: ${d.credibility_notes}
---
`
    )
    .join("\n");
}

/**
 * Estimate duration from word count (~150 wpm)
 */
function estimateDuration(wordCount: number): number {
  return Math.ceil((wordCount / 150) * 60);
}

/**
 * Format seconds as MM:SS
 */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Generate podcast script from rundown and digests
 */
export async function generatePodcastScript(
  digests: PodcastItemDigest[],
  rundown: PodcastRundown,
  period: "week" | "month",
  _categories: Category[],
  profile: PromptProfile | null,
  _voiceStyle: string = "conversational"
): Promise<PodcastScript> {
  // Filter digests with invalid URLs before processing
  const validDigests = digests.filter(d => isValidScriptUrl(d.url));
  if (validDigests.length < digests.length) {
    logger.info(`Filtered out ${digests.length - validDigests.length} digests with invalid URLs before script generation`);
  }

  if (validDigests.length === 0) {
    return {
      transcript: "[INTRO MUSIC]\n\nHOST: No items available this week.\n\n[OUTRO MUSIC]",
      segments: [],
      estimatedDuration: "2:00",
    };
  }

  logger.info(
    `Generating podcast script for ${validDigests.length} digests, period=${period}`
  );

  const digestContext = formatDigestsForScript(validDigests);
  // periodLabel and categoryLabels are embedded in the prompt below

  const client = getClient();
  if (!client) {
    logger.warn("OPENAI_API_KEY not set, using fallback script");
    return generateFallbackScript(validDigests, rundown, _voiceStyle);
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-5.2-pro",
      max_completion_tokens: 5000,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: `Write a conversational HOST + COHOST podcast script based on this rundown.

RUNDOWN:
Title: ${rundown.episode_title}
Cold Open: ${rundown.cold_open}
Duration Target: ${rundown.total_time_seconds} seconds

Segments:
${rundown.segments
  .map(
    (s, idx) => `
${idx + 1}. ${s.name} (${s.time_seconds}s)
   Key points: ${s.key_points_to_say.join("; ")}
   Uncertainty: ${s.nuance_or_uncertainty.join("; ") || "None"}
   Transition: "${s.transition_line}"
`
  )
  .join("")}

ITEM DIGESTS (facts-first, use these and ONLY these):
${digestContext}

ATTRIBUTION PLAN:
${rundown.attribution_plan.map((a) => `- ${a.url}: "${a.spoken_attribution}"`).join("\n")}

VOICE STYLE: ${_voiceStyle}
Categories: ${_categories.join(", ")}
${profile ? `USER FOCUS: ${profile.focusTopics.join(", ")}` : ""}

SCRIPT REQUIREMENTS:
1. Two speakers: HOST and COHOST (natural back-and-forth)
2. Start with [INTRO MUSIC] (10-15s exactly)
3. Cold open (20-30s): Hook, why listeners should care
4. Intro segment: "Here's what we're covering today: [3 bullets]" (30-45s)
5. MAIN SEGMENTS: Follow the rundown segment list EXACTLY
   - Each segment MUST fit within its time_seconds budget (±5s tolerance)
   - Include segment markers like "[0:45] Segment Name"
   - Facts first → Why it matters → Uncertainty
   - Use stories_used URLs for attribution
6. Natural transitions between segments (use provided transition_line)
7. Use audible attributions from plan above (e.g., "According to Pragmatic Engineer...")
8. Include [PAUSE] for natural breaks between segments
9. Lightning round (if applicable): "Quick hits..." (60-90s max)
10. Outro (20-30s): "Thanks for listening, show notes below..."
11. [OUTRO MUSIC] (10-15s)

TIMING CONSTRAINTS (STRICT):
- Total duration must be 300-600 seconds (5-10 minutes)
- Each segment must fit allocated time_seconds from rundown
- Aim for ~150 wpm (word count / 150 = minutes)
- [INTRO MUSIC] to [OUTRO MUSIC] should be marked with time codes

TONE RULES (critical):
- NO hype, swagger, or "tech bro" language
- Measured verbs: "suggests", "indicates", "reports", "claims"
- Always separate: "What we know" vs "What we think" vs "What we're unsure about"
- Natural, conversational speech (short sentences, contractions OK)
- Curiosity and clarity over cleverness
- Facts substantiated by source attribution
- Opinions clearly labeled ("I think..." or "This suggests...")
- Warmth and professionalism, not jokes or dunking

OUTPUT FORMAT:
Markdown with:
- Speaker labels: **HOST:** or **COHOST:**
- Segment markers: [MM:SS] Segment Name (start of each segment)
- Music cues: [INTRO MUSIC], [PAUSE], [OUTRO MUSIC]
- NO fabricated facts—use only provided digests
- Mark unsupported claims as [NEEDS SUPPORT]

Write the complete script in markdown. No JSON, no preamble, no explanations.`,
        },
      ],
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No script from LLM");
    }

    // Parse script into segments
    const segments = parseScriptSegments(content, rundown.segments);
    const wordCount = content.split(/\s+/).length;
    const durationSeconds = estimateDuration(wordCount);
    const estimatedDuration = formatTime(durationSeconds);

    return {
      transcript: content,
      segments,
      estimatedDuration,
    };
  } catch (error) {
    logger.warn("LLM script generation failed, using fallback", { error });
    return generateFallbackScript(validDigests, rundown, _voiceStyle);
  }
}

/**
 * Parse script into segments with timing
 */
function parseScriptSegments(
  script: string,
  rundownSegments: Array<{ name: string; time_seconds: number }>
): Array<{
  title: string;
  startTime: string;
  endTime: string;
  duration: number;
}> {
  const segments: Array<{
    title: string;
    startTime: string;
    endTime: string;
    duration: number;
  }> = [];

  let cumulativeSeconds = 0;

  for (const segment of rundownSegments) {
    const startTime = formatTime(cumulativeSeconds);
    const endTime = formatTime(cumulativeSeconds + segment.time_seconds);

    segments.push({
      title: segment.name,
      startTime,
      endTime,
      duration: segment.time_seconds,
    });

    cumulativeSeconds += segment.time_seconds;
  }

  return segments;
}

/**
 * Fallback script when LLM fails
 */
function generateFallbackScript(
  digests: PodcastItemDigest[],
  rundown: PodcastRundown,
  _voiceStyle: string
): PodcastScript {
  let script = "[INTRO MUSIC]\n\n";
  script += `**HOST:** Welcome to this week's code intelligence digest. I'm your host.\n\n`;
  script += `**COHOST:** And I'm your co-host. Today we're covering ${digests.length} stories on code search, agents, and developer tools.\n\n`;

  let cumulativeSeconds = 40;

  for (const segment of rundown.segments) {
    script += `## [${formatTime(cumulativeSeconds)}] ${segment.name}\n\n`;

    script += `**HOST:** Let's start with this. ${segment.key_points_to_say.slice(0, 2).join(" Also, ")}\n\n`;

    if (segment.nuance_or_uncertainty.length > 0) {
      script += `**COHOST:** That said, there's some uncertainty here: ${segment.nuance_or_uncertainty[0]}\n\n`;
    }

    script += `[PAUSE]\n\n`;

    cumulativeSeconds += segment.time_seconds;
  }

  script += `**HOST:** That's all for this week. Thanks for listening. Check the show notes for all links.\n\n`;
  script += `[OUTRO MUSIC]`;

  const segments = rundown.segments.map((s, idx) => ({
    title: s.name,
    startTime: formatTime(idx === 0 ? 40 : 40 + rundown.segments.slice(0, idx).reduce((sum, x) => sum + x.time_seconds, 0)),
    endTime: formatTime(40 + rundown.segments.slice(0, idx + 1).reduce((sum, x) => sum + x.time_seconds, 0)),
    duration: s.time_seconds,
  }));

  return {
    transcript: script,
    segments,
    estimatedDuration: formatTime(40 + rundown.total_time_seconds),
  };
}
