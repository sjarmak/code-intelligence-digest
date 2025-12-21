/**
 * Stage A: Podcast digest extraction
 * Per-item extraction using gpt-5.2-chat-latest for structured podcast digests
 * Reuses extract.ts patterns with podcast-specific schema
 */

import OpenAI from "openai";
import { RankedItem } from "../model";
import { logger } from "../logger";

export interface PodcastItemDigest {
  id: string;
  title: string;
  source_name: string;
  url: string;
  published_at: string;
  one_sentence_gist: string; // 1-2 sentence summary
  key_facts: string[]; // 3-6 factual bullets
  what_changed: string; // What's new vs baseline
  who_affected: string[]; // Users, devs, companies
  uncertainty_or_conflicts: string[]; // Disagreements or unknowns
  one_line_takeaway: string; // Practical implication
  soundbite_lines: string[]; // 2-4 short lines that read aloud
  credibility_notes: string; // "high" (academic/official), "medium" (established), "low" (casual)
  relevance_to_focus?: number; // 0-10 match with user prompt
}

const CHUNK_SIZE = 2000; // Characters per chunk

/**
 * Split long text into overlapping chunks
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
 * Summarize a single chunk
 */
async function summarizeChunk(
  client: OpenAI,
  chunk: string,
  index: number,
  total: number
): Promise<string> {
  const response = await client.chat.completions.create({
    model: "gpt-5.2-chat-latest",
    max_completion_tokens: 250,
    messages: [
      {
        role: "user",
        content: `Summarize key facts from this text chunk (${index}/${total}) in 2-3 sentences. Focus on what's new, factual, and relevant:

${chunk}`,
      },
    ],
  });

  return response.choices[0].message.content || "";
}

/**
 * Extract podcast digest from a ranked item
 */
export async function extractPodcastItemDigest(
  item: RankedItem,
  userPrompt: string = ""
): Promise<PodcastItemDigest> {
  const client = new OpenAI();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    logger.warn("OPENAI_API_KEY not set, using fallback podcast digest");
    return generateFallbackPodcastDigest(item, userPrompt);
  }

  try {
    // Determine if text is long and needs chunking
    const fullText = item.fullText || item.summary || item.contentSnippet || "";
    const chunks = chunkText(fullText);

    let processedText = fullText;
    if (chunks.length > 1) {
      // Skip LLM chunking for extremely long articles (likely spam/HTML bloat)
      if (chunks.length > 200) {
        logger.info(`Skipping chunking for extremely long article: "${item.title}" (${chunks.length} chunks - likely spam)`);
        processedText = fullText.substring(0, 3000); // Use first 3000 chars only
      } else {
        logger.info(`Chunking long article for podcast: "${item.title}" (${chunks.length} chunks)`);

        // Summarize each chunk
        const chunkSummaries = await Promise.all(
          chunks.map((chunk, idx) => summarizeChunk(client, chunk, idx + 1, chunks.length))
        );

        // Merge summaries
        processedText = chunkSummaries.join("\n\n");
      }
    }

    // Extract podcast digest from processed text
    const response = await client.chat.completions.create({
      model: "gpt-5.2-chat-latest",
      max_completion_tokens: 1000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `Extract a podcast digest from this article/resource.

Title: "${item.title}"
Source: ${item.sourceTitle}
Published: ${item.publishedAt.toISOString()}
Category: ${item.category}
${userPrompt ? `User Focus: ${userPrompt}` : ""}

Content:
${processedText}

Return STRICT JSON (no markdown) with:
- one_sentence_gist: 1-2 sentence summary (max 100 chars)
- key_facts: [3-6 factual, specific bullets—no interpretation]
- what_changed: What's new vs baseline (1-2 sentences)
- who_affected: ["users", "developers", "companies", etc. as applicable]
- uncertainty_or_conflicts: [Any unclear points or disagreements between sources]
- one_line_takeaway: Practical implication or next step (max 80 chars)
- soundbite_lines: [2-4 short lines that read naturally aloud, max 60 chars each]
- credibility_notes: "high" (academic/official), "medium" (established), or "low" (casual); plus brief note
- relevance_to_focus: 0-10 match with user focus (${userPrompt || "general code topics"})

Rules:
- key_facts MUST be factual, not speculation. Separate claims with "According to [source]" if needed.
- If something is unclear, put it in uncertainty_or_conflicts, don't guess.
- soundbite_lines should be under 60 characters and natural to read on air.
- credibility_notes might be: "high: from official OpenAI docs" or "medium: established tech news site"

Return ONLY valid JSON.`,
        },
      ],
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No response from podcast digest extraction");
    }

    const extracted = JSON.parse(content);

    return {
      id: item.id,
      title: item.title,
      source_name: item.sourceTitle,
      url: item.url,
      published_at: item.publishedAt.toISOString(),
      one_sentence_gist: extracted.one_sentence_gist || "",
      key_facts: Array.isArray(extracted.key_facts) ? extracted.key_facts : [],
      what_changed: extracted.what_changed || "",
      who_affected: Array.isArray(extracted.who_affected) ? extracted.who_affected : [],
      uncertainty_or_conflicts: Array.isArray(extracted.uncertainty_or_conflicts) ? extracted.uncertainty_or_conflicts : [],
      one_line_takeaway: extracted.one_line_takeaway || "",
      soundbite_lines: Array.isArray(extracted.soundbite_lines) ? extracted.soundbite_lines : [],
      credibility_notes: extracted.credibility_notes || "medium",
      relevance_to_focus: Math.min(10, Math.max(0, extracted.relevance_to_focus || 5)),
    };
  } catch (error) {
   const errorMsg = error instanceof Error ? error.message : String(error);
   const errorStack = error instanceof Error ? error.stack : undefined;
   logger.warn(`Podcast digest extraction failed for "${item.title}"`, {
     error: errorMsg,
     stack: errorStack,
     itemId: item.id,
   });
   return generateFallbackPodcastDigest(item, userPrompt);
  }
}

/**
 * Extract digests from multiple items in parallel
 */
export async function extractPodcastBatchDigests(
  items: RankedItem[],
  userPrompt: string = ""
): Promise<PodcastItemDigest[]> {
  logger.info(`Extracting podcast digests for ${items.length} items`);

  const digests = await Promise.all(
    items.map((item) => extractPodcastItemDigest(item, userPrompt))
  );

  logger.info(`Extracted ${digests.length} podcast digests`);
  return digests;
}

/**
 * Fallback digest when extraction fails or API unavailable
 */
function generateFallbackPodcastDigest(item: RankedItem, userPrompt: string): PodcastItemDigest {
  const gist = item.summary || item.contentSnippet || "No summary available";

  return {
    id: item.id,
    title: item.title,
    source_name: item.sourceTitle,
    url: item.url,
    published_at: item.publishedAt.toISOString(),
    one_sentence_gist: gist.substring(0, 100),
    key_facts: [gist.substring(0, 150)],
    what_changed: `New content from ${item.sourceTitle}`,
    who_affected: ["developers", "engineers"],
    uncertainty_or_conflicts: [],
    one_line_takeaway: `Relevant to ${userPrompt || "code intelligence"}`,
    soundbite_lines: [item.title.substring(0, 60)],
    credibility_notes: `${item.sourceTitle} (medium credibility)`,
    relevance_to_focus: Math.round(item.finalScore * 10),
  };
}
