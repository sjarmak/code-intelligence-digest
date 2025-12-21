/**
 * Podcast generation
 * Synthesizes ranked items into a transcript with segmentation and show notes
 */

import OpenAI from "openai";
import { RankedItem, Category } from "../model";
import { PromptProfile } from "./promptProfile";
import { logger } from "../logger";

export interface PodcastSegment {
  title: string;
  startTime: string;
  endTime: string;
  duration: number; // seconds
  itemsReferenced: Array<{
    id: string;
    title: string;
    url: string;
    sourceTitle: string;
  }>;
  highlights: string[];
}

export interface PodcastContent {
  transcript: string;
  segments: PodcastSegment[];
  showNotes: string;
  estimatedDuration: string; // "MM:SS" format
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
 * Format seconds to MM:SS
 */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Estimate duration in seconds from word count (150 wpm)
 */
function estimateDuration(wordCount: number): number {
  return Math.ceil(wordCount / 150 * 60);
}

/**
 * Truncate text for LLM input
 */
function truncateForLLM(text: string | undefined, maxChars: number): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;

  const truncated = text.substring(0, maxChars);
  const lastSpaceIdx = truncated.lastIndexOf(" ");
  return lastSpaceIdx > 0 ? truncated.substring(0, lastSpaceIdx) : truncated;
}

/**
 * Build synthesis context from selected items
 */
function buildSynthesisContext(items: RankedItem[]): string {
  return items
    .map((item, idx) => {
      const text = truncateForLLM(item.fullText || item.summary || item.contentSnippet, 1500);
      return `(ref: item-${idx})
Title: "${item.title}"
Source: ${item.sourceTitle} by ${item.author || "Unknown"}
URL: ${item.url}
Content: ${text || "No content available"}
Tags: ${item.llmScore.tags.join(", ")}
`;
    })
    .join("\n---\n");
}

/**
 * Extract item references from transcript
 * Looks for patterns like (ref: item-0), (ref: item-1), etc.
 */
function extractItemReferences(text: string): number[] {
  const matches = text.match(/\(ref:\s*item-(\d+)\)/g) || [];
  return [...new Set(matches.map((m) => {
    const match = m.match(/item-(\d+)/);
    return match ? parseInt(match[1], 10) : -1;
  }))].filter(i => i >= 0);
}

/**
 * Parse transcript into segments
 * Looks for segment markers like "## SEGMENT: Topic Name" or "[SEGMENT]"
 */
function parseTranscriptSegments(transcript: string, items: RankedItem[]): PodcastSegment[] {
  // Simple parsing: split by "## SEGMENT:" markers
  const parts = transcript.split(/##\s*SEGMENT:\s*/);
  if (parts.length <= 1) {
    // No segments found, create one default segment
    const itemRefs = extractItemReferences(transcript);
    return [
      {
        title: "Full Episode",
        startTime: "0:00",
        endTime: formatTime(estimateDuration(transcript.split(/\s+/).length)),
        duration: estimateDuration(transcript.split(/\s+/).length),
        itemsReferenced: itemRefs.map((idx) =>
          idx < items.length
            ? {
                id: items[idx].id,
                title: items[idx].title,
                url: items[idx].url,
                sourceTitle: items[idx].sourceTitle,
              }
            : { id: `item-${idx}`, title: "Unknown", url: "#", sourceTitle: "Unknown" }
        ),
        highlights: [],
      },
    ];
  }

  const segments: PodcastSegment[] = [];
  let cumulativeSeconds = 0;

  for (let i = 1; i < parts.length; i++) {
    const section = parts[i];
    const lines = section.split("\n");
    const titleLine = lines[0] || `Segment ${i}`;
    const contentLines = lines.slice(1).join("\n");

    const itemRefs = extractItemReferences(contentLines);
    const words = contentLines.split(/\s+/).length;
    const duration = estimateDuration(words);
    const startTime = formatTime(cumulativeSeconds);
    const endTime = formatTime(cumulativeSeconds + duration);

    segments.push({
      title: titleLine.trim(),
      startTime,
      endTime,
      duration,
      itemsReferenced: itemRefs.map((idx) =>
        idx < items.length
          ? {
              id: items[idx].id,
              title: items[idx].title,
              url: items[idx].url,
              sourceTitle: items[idx].sourceTitle,
            }
          : { id: `item-${idx}`, title: "Unknown", url: "#", sourceTitle: "Unknown" }
      ),
      highlights: extractHighlights(contentLines),
    });

    cumulativeSeconds += duration;
  }

  return segments;
}

/**
 * Extract highlights (paraphrased insights) from segment text
 */
function extractHighlights(text: string): string[] {
  // Simple extraction: sentences with em-dash or that start with "-"
  const lines = text.split("\n");
  const highlights: string[] = [];

  for (const line of lines) {
    if (line.includes("—") || line.trim().startsWith("-")) {
      const cleaned = line.replace(/^[-\s]+/, "").replace(/\(ref:.*?\)/g, "").trim();
      if (cleaned && cleaned.length > 10) {
        highlights.push(cleaned);
      }
    }
  }

  return highlights.slice(0, 3); // Limit to 3 per segment
}

/**
 * Generate podcast content using LLM
 */
export async function generatePodcastContent(
  items: RankedItem[],
  period: "week" | "month",
  categories: Category[],
  profile: PromptProfile | null,
  voiceStyle: string = "conversational"
): Promise<PodcastContent> {
  if (items.length === 0) {
    return {
      transcript: "[INTRO MUSIC]\n\nHost: No items available this week.\n\n[OUTRO MUSIC]",
      segments: [],
      showNotes: "# Show Notes\n\nNo items available.",
      estimatedDuration: "2:00",
    };
  }

  logger.info(
    `Generating podcast for ${items.length} items, period=${period}, voice=${voiceStyle}`
  );

  const synthesisContext = buildSynthesisContext(items);
  const periodLabel = period === "week" ? "weekly" : "monthly";
  const categoryLabels = categories.join(", ");

  let transcript: string;

  const client = getClient();
  if (client) {
    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_completion_tokens: 3500,
        messages: [
          {
            role: "user",
            content: `Generate a ${periodLabel} podcast episode transcript about code intelligence for tech leads and senior engineers.

Voice style: ${voiceStyle}
Duration target: ~20 minutes
Categories: ${categoryLabels}
${profile ? `Focus topics: ${profile.focusTopics.join(", ")}` : ""}

Items (with references to use inline like (ref: item-0)):
${synthesisContext}

Requirements:
- Start with [INTRO MUSIC]
- Include at least 2 speakers: Host: and Guest: or Host: and Co-host:
- Use natural transitions between topics
- Divide into logical segments with "## SEGMENT: [Topic]" markers
- Reference items inline using (ref: item-0), (ref: item-1), etc.
- Include [PAUSE] where natural breaks occur
- End with [OUTRO MUSIC]
- No fabricated quotes—paraphrase insights from provided content
- Make it engaging and conversational but professional
- ~20 minutes (~3000 words at 150 wpm)

Generate only the transcript, no JSON.`,
          },
        ],
      });

      transcript = response.choices[0].message.content || generatePodcastFallback(items);
    } catch (error) {
      logger.warn("LLM podcast generation failed, using fallback template", { error });
      transcript = generatePodcastFallback(items);
    }
  } else {
    logger.info("OPENAI_API_KEY not set, using fallback podcast");
    transcript = generatePodcastFallback(items);
  }

  // Parse segments
  const segments = parseTranscriptSegments(transcript, items);
  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  const estimatedDuration = formatTime(totalDuration);

  // Build show notes
  const showNotes = buildShowNotes(items, segments);

  return {
    transcript,
    segments,
    showNotes,
    estimatedDuration,
  };
}

/**
 * Fallback podcast template
 */
function generatePodcastFallback(items: RankedItem[]): string {
  let podcast = "[INTRO MUSIC]\n\n";
  podcast += `Host: Welcome to Code Intelligence Weekly, a ${items.length}-item digest focused on code search, agents, and developer productivity.\n\n`;

  // Group by category
  const byCategory = new Map<Category, RankedItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) {
      byCategory.set(item.category, []);
    }
    byCategory.get(item.category)!.push(item);
  }

  let idx = 0;
  for (const [category, categoryItems] of byCategory) {
    podcast += `## SEGMENT: ${category.replace(/_/g, " ")}\n\n`;
    podcast += `Host: Let's dive into ${category.replace(/_/g, " ")}.\n\n`;

    for (const item of categoryItems.slice(0, 3)) {
      const refIdx = idx;
      podcast += `Host: First up (ref: item-${refIdx}): "${item.title}" from ${item.sourceTitle}. ${item.summary || item.contentSnippet || "A key article in this space."} `;
      podcast += `This covers topics like ${item.llmScore.tags.slice(0, 2).join(" and ")}.\n\n`;
      idx++;
    }

    podcast += "[PAUSE]\n\n";
  }

  podcast += "Host: That's all for this week's digest. Check the show notes for all references.\n\n";
  podcast += "[OUTRO MUSIC]\n";

  return podcast;
}

/**
 * Build show notes from items and segments
 */
function buildShowNotes(items: RankedItem[], segments: PodcastSegment[]): string {
  let notes = "# Show Notes\n\n";

  for (const segment of segments) {
    if (segment.itemsReferenced.length > 0) {
      notes += `## ${segment.title}\n\n`;
      for (const ref of segment.itemsReferenced) {
        notes += `- [${ref.title}](${ref.url}) — ${ref.sourceTitle}\n`;
      }
      notes += "\n";
    }
  }

  // Add all items as a reference list
  notes += "## All Items\n\n";
  for (const item of items) {
    notes += `- [${item.title}](${item.url}) — ${item.sourceTitle} (${item.author || "Unknown"})\n`;
  }

  return notes;
}
