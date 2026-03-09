/**
 * Audio Digest Pipeline
 * Extracts highlights from articles and research papers for audio digest generation
 * Reuses chunking infrastructure from extract.ts
 */

import { RankedItem } from "../model";
import { logger } from "../logger";
import { getPaper } from "../db/ads-papers";
import { extractBibcodeFromUrl } from "../ads/client";
import { createChatCompletion } from "../llm/completion";
import { hasLLMConfigured } from "../llm/config";
import type { LLMClientOptions } from "../llm/client";

// Reuse chunking functions from extract.ts
const CHUNK_SIZE = 2000; // Characters per chunk

/**
 * Split long text into overlapping chunks (reused from extract.ts)
 */
function chunkText(text: string, chunkSize: number = CHUNK_SIZE): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.substring(start, end);

    // Try to break on sentence boundary
    const lastPeriod = chunk.lastIndexOf(".");
    if (lastPeriod > chunkSize * 0.7 && lastPeriod < chunk.length - 1) {
      chunks.push(chunk.substring(0, lastPeriod + 1));
      start += lastPeriod + 1;
    } else {
      chunks.push(chunk);
      start = end;
    }
  }

  return chunks;
}

/**
 * Summarize a single chunk (reused from extract.ts)
 */
async function summarizeChunk(
  chunk: string,
  index: number,
  total: number,
  llmOptions?: LLMClientOptions
): Promise<string> {
  const result = await createChatCompletion({
    messages: [
      {
        role: "user",
        content: `Summarize the key points from this text chunk (${index}/${total}). Be concise:

${chunk}`,
      },
    ],
    max_tokens: 300,
    openaiOptions: llmOptions,
  });
  return result.content || "";
}

/**
 * Check if source is an email newsletter (content is embedded, not linked)
 */
function isEmailNewsletterSource(sourceTitle: string): boolean {
  return ["TLDR", "Byte Byte Go", "Pointer", "Substack", "Elevate", "Architecture Notes", "Leadership in Tech", "Programming Digest", "System Design"].some(
    name => sourceTitle.includes(name)
  );
}

/**
 * Strip HTML tags from text
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Highlight extracted from article or paper
 */
export interface AudioDigestHighlight {
  text: string; // 1-3 sentences with specific excerpt
  excerpt?: string; // Specific quoted excerpt from the content
  sourceName: string; // Resource name (title or source)
}

/**
 * Extract highlights from article full text
 * Reuses chunking infrastructure from extract.ts
 */
export async function extractArticleHighlights(
  item: RankedItem,
  userPrompt: string = "",
  llmOptions?: LLMClientOptions
): Promise<AudioDigestHighlight[]> {
  if (!hasLLMConfigured()) {
    logger.warn(`No LLM configured for item "${item.title}", using fallback highlights`);
    return [{
      text: item.summary || item.contentSnippet || "No summary available",
      sourceName: item.title,
    }];
  }

  try {
    // For email newsletters/Inoreader URLs, use summary directly (it's the actual content)
    let fullText = item.fullText || item.summary || item.contentSnippet || "";

    if (isEmailNewsletterSource(item.sourceTitle) && item.summary) {
      logger.info(`Using embedded content for email newsletter: "${item.title}"`);
      fullText = stripHtml(item.summary);
    }

    if (!fullText || fullText.length < 100) {
      logger.warn(`Insufficient full text for item "${item.title}", using summary`);
      return [{
        text: item.summary || item.contentSnippet || "No content available",
        sourceName: item.title,
      }];
    }

    const chunks = chunkText(fullText);

    let processedText = fullText;
    if (chunks.length > 1) {
      // Skip LLM chunking for extremely long articles (likely spam/HTML bloat)
      if (chunks.length > 200) {
        logger.info(`Skipping chunking for extremely long article: "${item.title}" (${chunks.length} chunks - likely spam)`);
        processedText = fullText.substring(0, 3000); // Use first 3000 chars only
      } else {
        logger.info(`Chunking long article: "${item.title}" (${chunks.length} chunks)`);

        // Summarize chunks in batches to control memory usage
        const chunkSummaries: string[] = [];
        const CHUNK_BATCH_SIZE = 5; // Process 5 chunks at a time

        for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
          const chunkBatch = chunks.slice(i, i + CHUNK_BATCH_SIZE);
          const summaries = await Promise.all(
            chunkBatch.map((chunk, idx) =>
              summarizeChunk(chunk, i + idx + 1, chunks.length, llmOptions)
            )
          );
          chunkSummaries.push(...summaries);

          // Brief pause for GC on large articles
          if (i + CHUNK_BATCH_SIZE < chunks.length) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        // Merge summaries
        processedText = chunkSummaries.join("\n\n");
      }
    }

    // Extract highlights with specific excerpts
    const result = await createChatCompletion({
      messages: [
        {
          role: "user",
          content: `Extract 3-5 salient highlights from this article for an audio digest. Each highlight should:
1. Be 1-3 sentences
2. Include a specific excerpt (quoted text) from the actual content
3. Be readable when spoken aloud

Title: "${item.title}"
Source: ${item.sourceTitle}
User Focus: ${userPrompt || "Building benchmarks to evaluate the value of augmenting coding agents with code search and codebase understanding tools in enterprise codebases"}

Content:
${processedText}

Return JSON with:
- highlights: Array of objects, each with:
  - text: 1-3 sentences that synthesize the key point (readable when spoken)
  - excerpt: A specific quoted sentence or phrase from the actual content that supports this point

Example:
{
  "highlights": [
    {
      "text": "The paper introduces a new approach to code search that improves accuracy by 40%. The method uses semantic embeddings combined with traditional keyword matching.",
      "excerpt": "Our approach achieves a 40% improvement in code search accuracy compared to baseline methods."
    }
  ]
}

Return ONLY valid JSON, no markdown.`,
        },
      ],
      max_tokens: 1000,
      response_format: { type: "json_object" },
      openaiOptions: llmOptions,
    });

    const content = result.content;
    if (!content) {
      throw new Error("No response from highlight extraction");
    }

    const extracted = JSON.parse(content);
    const highlights = Array.isArray(extracted.highlights) ? extracted.highlights : [];

    return highlights.map((h: { text: string; excerpt?: string }) => ({
      text: h.text || "",
      excerpt: h.excerpt,
      sourceName: item.title,
    })).filter((h: AudioDigestHighlight) => h.text.length > 0);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(`Highlight extraction failed for "${item.title}"`, {
      error: errorMsg,
      itemId: item.id,
    });
    // Fallback to summary
    return [{
      text: item.summary || item.contentSnippet || "No content available",
      sourceName: item.title,
    }];
  }
}

/**
 * Extract conclusions section from paper full text
 */
export async function extractConclusionsFromPaper(
  fullText: string
): Promise<string | null> {
  if (!fullText || fullText.length < 100) {
    return null;
  }

  // Look for "Conclusion" or "Conclusions" section
  // Common patterns:
  // - "## Conclusion"
  // - "# Conclusion"
  // - "Conclusion\n"
  // - "Conclusions\n"
  const conclusionPatterns = [
    /(?:^|\n)#{1,3}\s*(?:Conclusion|Conclusions)\s*\n/i,
    /(?:^|\n)(?:Conclusion|Conclusions)\s*\n/i,
  ];

  for (const pattern of conclusionPatterns) {
    const match = fullText.match(pattern);
    if (match && match.index !== undefined) {
      const startIndex = match.index + match[0].length;
      // Extract text until next major section (## or #) or end of text
      const remainingText = fullText.substring(startIndex);
      const nextSectionMatch = remainingText.match(/\n#{1,3}\s+/);
      const endIndex = nextSectionMatch ? nextSectionMatch.index : remainingText.length;

      const conclusionText = remainingText.substring(0, endIndex).trim();
      if (conclusionText.length >= 100) {
        logger.info(`Extracted conclusions section (${conclusionText.length} chars)`);
        return conclusionText;
      }
    }
  }

  // If no explicit conclusion section, try to find last few paragraphs
  const paragraphs = fullText.split(/\n\n+/);
  if (paragraphs.length >= 3) {
    // Take last 2-3 paragraphs as potential conclusion
    const lastParagraphs = paragraphs.slice(-3).join("\n\n");
    if (lastParagraphs.length >= 100) {
      logger.info(`Using last paragraphs as conclusion (${lastParagraphs.length} chars)`);
      return lastParagraphs;
    }
  }

  return null;
}

/**
 * Extract highlights from research paper
 * Combines: chunked summaries + abstract + conclusions
 */
export async function extractPaperHighlights(
  item: RankedItem,
  userPrompt: string = "",
  llmOptions?: LLMClientOptions
): Promise<AudioDigestHighlight[]> {
  if (!hasLLMConfigured()) {
    logger.warn(`No LLM configured for paper "${item.title}", using fallback highlights`);
    return [{
      text: item.summary || item.contentSnippet || "No summary available",
      sourceName: item.title,
    }];
  }

  try {
    // Get bibcode from item.raw (for ADS-synced research items) or extract from URL
    let bibcode: string | null = null;

    // First, try to get bibcode from raw data (ADS-synced items have it here)
    if (item.raw && typeof item.raw === 'object' && 'bibcode' in item.raw) {
      bibcode = (item.raw as { bibcode?: string }).bibcode || null;
    }

    // Fallback to extracting from URL if not in raw
    if (!bibcode) {
      bibcode = extractBibcodeFromUrl(item.url);
    }

    if (!bibcode) {
      logger.warn(`Could not find bibcode for research item: ${item.title} (URL: ${item.url})`);
      // Fallback to regular article extraction
      return extractArticleHighlights(item, userPrompt, llmOptions);
    }

    // Get paper from database
    const paper = await getPaper(bibcode);
    if (!paper) {
      logger.warn(`Paper not found in database: ${bibcode}`);
      // Fallback to regular article extraction
      return extractArticleHighlights(item, userPrompt, llmOptions);
    }

    // Get abstract
    const abstract = paper.abstract || "";

    // Get full text (body)
    const fullText = paper.body || item.fullText || "";

    // Extract conclusions section
    const conclusions = fullText ? await extractConclusionsFromPaper(fullText) : null;

    // Process full text with chunking if available
    let chunkedSummaries = "";
    if (fullText && fullText.length > 500) {
      const chunks = chunkText(fullText);
      if (chunks.length > 1 && chunks.length <= 200) {
        logger.info(`Chunking paper full text: "${item.title}" (${chunks.length} chunks)`);

        const chunkSummaries: string[] = [];
        const CHUNK_BATCH_SIZE = 5;

        for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
          const chunkBatch = chunks.slice(i, i + CHUNK_BATCH_SIZE);
          const summaries = await Promise.all(
            chunkBatch.map((chunk, idx) =>
              summarizeChunk(chunk, i + idx + 1, chunks.length, llmOptions)
            )
          );
          chunkSummaries.push(...summaries);

          if (i + CHUNK_BATCH_SIZE < chunks.length) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        chunkedSummaries = chunkSummaries.join("\n\n");
      } else if (chunks.length > 200) {
        // Too many chunks, use first part
        chunkedSummaries = fullText.substring(0, 3000);
      } else {
        chunkedSummaries = fullText;
      }
    }

    // Combine all sources
    const combinedText = [
      abstract ? `Abstract: ${abstract}` : "",
      chunkedSummaries ? `Key points from full text: ${chunkedSummaries}` : "",
      conclusions ? `Conclusions: ${conclusions}` : "",
    ].filter(Boolean).join("\n\n");

    if (!combinedText || combinedText.length < 100) {
      logger.warn(`Insufficient content for paper "${item.title}"`);
      return [{
        text: abstract || item.summary || "No content available",
        sourceName: item.title,
      }];
    }

    // Extract highlights combining all sources
    const paperResult = await createChatCompletion({
      messages: [
        {
          role: "user",
          content: `Extract 3-5 salient highlights and takeaways from this research paper for an audio digest.
Combine insights from the abstract, key points from the full text, and conclusions.

Title: "${item.title}"
Authors: ${paper.authors ? JSON.parse(paper.authors).join(", ") : "Unknown"}
User Focus: ${userPrompt || "Building benchmarks to evaluate the value of augmenting coding agents with code search and codebase understanding tools in enterprise codebases"}

Content:
${combinedText}

Return JSON with:
- highlights: Array of objects, each with:
  - text: 1-3 sentences that synthesize the key point or takeaway (readable when spoken)
  - excerpt: A specific quoted sentence or phrase from the abstract, conclusions, or full text that supports this point

Focus on:
- Key findings and results
- Novel approaches or techniques
- Practical implications
- Takeaways for developers working on code intelligence

Return ONLY valid JSON, no markdown.`,
        },
      ],
      max_tokens: 1200,
      response_format: { type: "json_object" },
      openaiOptions: llmOptions,
    });

    const content = paperResult.content;
    if (!content) {
      throw new Error("No response from paper highlight extraction");
    }

    const extracted = JSON.parse(content);
    const highlights = Array.isArray(extracted.highlights) ? extracted.highlights : [];

    // Get authors for source name
    const authors = paper.authors ? JSON.parse(paper.authors) : [];
    const sourceName = authors.length > 0
      ? `${item.title} (${authors.slice(0, 2).join(", ")}${authors.length > 2 ? " et al." : ""})`
      : item.title;

    return highlights.map((h: { text: string; excerpt?: string }) => ({
      text: h.text || "",
      excerpt: h.excerpt,
      sourceName,
    })).filter((h: AudioDigestHighlight) => h.text.length > 0);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(`Paper highlight extraction failed for "${item.title}"`, {
      error: errorMsg,
      itemId: item.id,
    });
    // Fallback to abstract or summary
    let bibcode: string | null = null;
    if (item.raw && typeof item.raw === 'object' && 'bibcode' in item.raw) {
      bibcode = (item.raw as { bibcode?: string }).bibcode || null;
    }
    if (!bibcode) {
      bibcode = extractBibcodeFromUrl(item.url);
    }
    if (bibcode) {
      const paper = await getPaper(bibcode);
      if (paper?.abstract) {
        return [{
          text: paper.abstract,
          sourceName: item.title,
        }];
      }
    }
    return [{
      text: item.summary || item.contentSnippet || "No content available",
      sourceName: item.title,
    }];
  }
}

/**
 * Item with highlights for transcript generation
 */
export interface ItemWithHighlights {
  item: RankedItem;
  highlights: AudioDigestHighlight[];
}

/**
 * Audio Digest Transcript Segment
 */
export interface AudioDigestSegment {
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

/**
 * Audio Digest Content
 */
export interface AudioDigestContent {
  transcript: string;
  segments: AudioDigestSegment[];
  showNotes: string;
  estimatedDuration: string; // "MM:SS" format
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
 * Generate synthesized transcript from highlights
 * Creates a cohesive narrative (not sequential item-by-item)
 */
export async function generateAudioDigestTranscript(
  itemsWithHighlights: ItemWithHighlights[],
  period: "week" | "month" | "all" | "custom",
  categories: string[],
  userPrompt: string = "",
  targetDurationMinutes?: number,
  llmOptions?: LLMClientOptions
): Promise<AudioDigestContent> {
  if (itemsWithHighlights.length === 0) {
    return {
      transcript: "[INTRO MUSIC]\n\nHOST: No items available for this period.\n\n[OUTRO MUSIC]",
      segments: [],
      showNotes: "# Show Notes\n\nNo items available.",
      estimatedDuration: "2:00",
    };
  }

  logger.info(
    `Generating audio digest transcript for ${itemsWithHighlights.length} items, period=${period}`
  );

  if (!hasLLMConfigured()) {
    logger.warn("No LLM configured, using fallback transcript");
    return generateFallbackTranscript(itemsWithHighlights, period);
  }

  // Build context from highlights
  const highlightsContext = itemsWithHighlights
    .map((itemWithHighlights, idx) => {
      const { item, highlights } = itemWithHighlights;
      const highlightsText = highlights
        .map((h, hIdx) => {
          let text = `${hIdx + 1}. ${h.text}`;
          if (h.excerpt) {
            text += ` (Excerpt: "${h.excerpt}")`;
          }
          return text;
        })
        .join("\n");

      return `(ref: item-${idx})
Title: "${item.title}"
Source: ${item.sourceTitle}${item.author ? ` by ${item.author}` : ""}
URL: ${item.url}
Category: ${item.category}
Highlights:
${highlightsText}
`;
    })
    .join("\n---\n");

  const periodLabel = period === "week" ? "weekly" : period === "month" ? "monthly" : period === "all" ? "all time" : "custom";
  const categoryLabels = categories.join(", ");

  // Calculate target word count if duration is specified
  const targetWordCount = targetDurationMinutes ? targetDurationMinutes * 150 : undefined;
  const targetWordCountText = targetWordCount
    ? `CRITICAL WORD COUNT REQUIREMENT: You MUST generate approximately ${targetWordCount} words (${targetDurationMinutes} minutes at 150 words/minute).

This is NOT a suggestion - it is a hard requirement. The transcript MUST be close to this length.

To achieve this:
- Read ALL highlights from ALL items provided
- Include full excerpts when available
- Add detailed transitions and context between items
- Expand on key points with additional explanation
- Do NOT summarize or condense - read the highlights in full
- Include attribution and source information for each highlight
- Add natural transitions that add length while maintaining flow

If you generate less than ${Math.round(targetWordCount * 0.8)} words, the transcript will be too short. Aim for ${targetWordCount} words minimum.`
    : "Target ~20-30 minutes of content (~3000-4500 words at 150 wpm).";

  // Adjust max tokens based on target duration
  // For longer transcripts, we need more tokens (roughly 1 token per word)
  // Increase buffer to 50% to ensure we can generate enough
  const maxTokens = targetWordCount
    ? Math.min(Math.ceil(targetWordCount * 1.5), 20000) // Allow 50% buffer, cap at 20000 for longer transcripts
    : 4000;

  try {
    const transcriptResult = await createChatCompletion({
      messages: [
        {
          role: "user",
          content: `Generate a ${periodLabel} audio digest transcript that reads out highlights from ${itemsWithHighlights.length} items across ${categoryLabels}. This should read like a comprehensive report or documentary, not a conversational podcast.

User Focus: ${userPrompt || "Building benchmarks to evaluate the value of augmenting coding agents with code search and codebase understanding tools in enterprise codebases"}

Items with highlights (use references like (ref: item-0)):
${highlightsContext}

STYLE REQUIREMENTS:
- This is a REPORT READING, not a conversation. Use a single narrator voice throughout.
- Read like a news report, documentary, or audiobook - informative and direct
- NO conversational elements like "Host:" or "Guest:" - just direct narration
- NO banter, questions, or dialogue - just present the information clearly
- Use transitions like "Moving on to..." or "In related news..." to connect topics
- Present information authoritatively and clearly

CONTENT REQUIREMENTS:
- Start with [INTRO MUSIC]
- Begin with a brief introduction: "This is the Code Intelligence Audio Digest for [period]. Today we'll cover [N] items across [categories]."
- Group related items/themes together into logical segments
- For each item, read ALL highlights directly with clear attribution
- Use format: "From [Resource Name]: [read highlight text in full]. [Quote excerpt if available in full]."
- Include ALL highlights from ALL items - this is a comprehensive reading, not a summary
- Expand on each highlight with context and explanation to reach target length
- Add detailed transitions between items that provide context
- Divide into logical segments with "## SEGMENT: [Theme/Topic]" markers
- Include [PAUSE] where natural breaks occur (between segments, after major points)
- End with [OUTRO MUSIC]
- ${targetWordCountText}

REMEMBER: Read highlights in FULL, include all excerpts, add context and transitions. Do NOT condense or summarize. The goal is a comprehensive reading that reaches the target word count.

IMPORTANT: Read out the highlights directly. This is not a synthesis - it's a reading of the most important information from each source. Include all provided highlights to reach the target word count.

Generate only the transcript, no JSON.`,
        },
      ],
      max_tokens: maxTokens,
      openaiOptions: llmOptions,
    });

    let transcript = transcriptResult.content || generateFallbackTranscript(itemsWithHighlights, period).transcript;

    // If we have a target duration, clamp overly long transcripts to stay near target length
    if (targetWordCount) {
      const words = transcript.split(/\s+/);
      const hardMaxWords = Math.floor(targetWordCount * 1.5); // absolute ceiling (150% of target)
      const softMaxWords = Math.floor(targetWordCount * 1.2); // preferred max (~120% of target)

      if (words.length > hardMaxWords) {
        const trimmed = words.slice(0, softMaxWords > 0 ? softMaxWords : hardMaxWords);
        transcript = trimmed.join(" ");
      }
    }

    // Parse segments based on (possibly trimmed) transcript
    const segments = parseTranscriptSegments(transcript, itemsWithHighlights);
    const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
    const estimatedDuration = formatTime(totalDuration);

    // Build show notes
    const showNotes = generateShowNotes(itemsWithHighlights, segments);

    return {
      transcript,
      segments,
      showNotes,
      estimatedDuration,
    };
  } catch (error) {
    logger.warn("LLM transcript generation failed, using fallback", { error });
    return generateFallbackTranscript(itemsWithHighlights, period);
  }
}

/**
 * Parse transcript into segments
 */
function parseTranscriptSegments(
  transcript: string,
  itemsWithHighlights: ItemWithHighlights[]
): AudioDigestSegment[] {
  const segments: AudioDigestSegment[] = [];
  const segmentPattern = /##\s*SEGMENT:\s*(.+?)(?=##\s*SEGMENT:|\[OUTRO|$)/gs;
  let match;
  let cumulativeSeconds = 0;

  while ((match = segmentPattern.exec(transcript)) !== null) {
    const title = match[1].trim();
    const content = match[0].replace(/##\s*SEGMENT:.*?\n/, "").trim();

    // Extract item references
    const itemRefs = extractItemReferences(content);
    const itemsReferenced = itemRefs
      .map((idx) => {
        if (idx >= 0 && idx < itemsWithHighlights.length) {
          const item = itemsWithHighlights[idx].item;
          return {
            id: item.id,
            title: item.title,
            url: item.url,
            sourceTitle: item.sourceTitle,
          };
        }
        return null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    // Extract highlights (simple extraction from content)
    const highlights = extractHighlights(content);

    // Estimate duration
    const wordCount = content.split(/\s+/).length;
    const duration = estimateDuration(wordCount);
    const startTime = formatTime(cumulativeSeconds);
    cumulativeSeconds += duration;
    const endTime = formatTime(cumulativeSeconds);

    segments.push({
      title,
      startTime,
      endTime,
      duration,
      itemsReferenced,
      highlights,
    });
  }

  return segments;
}

/**
 * Extract item references from transcript
 */
function extractItemReferences(text: string): number[] {
  const matches = text.match(/\(ref:\s*item-(\d+)\)/g) || [];
  return [...new Set(matches.map((m) => {
    const match = m.match(/item-(\d+)/);
    return match ? parseInt(match[1], 10) : -1;
  }))].filter(i => i >= 0);
}

/**
 * Extract highlights (paraphrased insights) from segment text
 */
function extractHighlights(text: string): string[] {
  const lines = text.split("\n");
  const highlights: string[] = [];

  for (const line of lines) {
    if (line.includes("—") || line.trim().startsWith("-") || line.includes('"')) {
      const cleaned = line.replace(/^[-\s]+/, "").replace(/\(ref:.*?\)/g, "").trim();
      if (cleaned && cleaned.length > 10) {
        highlights.push(cleaned);
      }
    }
  }

  return highlights.slice(0, 5); // Limit to 5 per segment
}

/**
 * Generate show notes with excerpts and resource names
 */
export function generateShowNotes(
  itemsWithHighlights: ItemWithHighlights[],
  segments: AudioDigestSegment[]
): string {
  let notes = "# Show Notes\n\n";

  // Group items by category
  const byCategory = new Map<string, ItemWithHighlights[]>();
  for (const itemWithHighlights of itemsWithHighlights) {
    const category = itemWithHighlights.item.category;
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }
    byCategory.get(category)!.push(itemWithHighlights);
  }

  // Add segments overview
  if (segments.length > 0) {
    notes += "## Segments\n\n";
    for (const segment of segments) {
      notes += `- **${segment.title}** (${segment.startTime} - ${segment.endTime})\n`;
    }
    notes += "\n";
  }

  // Add items with excerpts organized by category
  for (const [category, items] of byCategory.entries()) {
    notes += `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;

    for (const { item, highlights } of items) {
      notes += `### ${item.title}\n\n`;
      notes += `**Source:** ${item.sourceTitle}${item.author ? ` by ${item.author}` : ""}\n\n`;
      notes += `**Link:** ${item.url}\n\n`;

      if (highlights.length > 0) {
        notes += "**Key Highlights:**\n\n";
        for (const highlight of highlights) {
          notes += `- ${highlight.text}\n`;
          if (highlight.excerpt) {
            notes += `  > "${highlight.excerpt}"\n`;
          }
        }
        notes += "\n";
      }
    }
  }

  return notes;
}

/**
 * Fallback transcript template
 */
function generateFallbackTranscript(
  itemsWithHighlights: ItemWithHighlights[],
  period: string
): AudioDigestContent {
  let transcript = "[INTRO MUSIC]\n\n";
  transcript += `HOST: Welcome to the Audio Digest for ${period}. Today we'll cover ${itemsWithHighlights.length} items.\n\n`;

  for (const { item, highlights } of itemsWithHighlights) {
    transcript += `## SEGMENT: ${item.category}\n\n`;
    transcript += `HOST: ${item.title} from ${item.sourceTitle}.\n\n`;

    for (const highlight of highlights.slice(0, 3)) {
      transcript += `${highlight.text}\n\n`;
      if (highlight.excerpt) {
        transcript += `As ${item.title} explains: "${highlight.excerpt}"\n\n`;
      }
    }

    transcript += "[PAUSE]\n\n";
  }

  transcript += "[OUTRO MUSIC]";

  const segments = parseTranscriptSegments(transcript, itemsWithHighlights);
  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  const showNotes = generateShowNotes(itemsWithHighlights, segments);

  return {
    transcript,
    segments,
    showNotes,
    estimatedDuration: formatTime(totalDuration),
  };
}
