/**
 * Stage A: Podcast digest extraction
 * Per-item extraction using gpt-4o-mini for structured podcast digests
 * Reuses extract.ts patterns with podcast-specific schema
 */

import OpenAI from "openai";
import { RankedItem } from "../model";
import { logger } from "../logger";

/**
 * Check if URL is from Reddit (discussion threads, not primary sources)
 */
function isRedditUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /reddit\.com\/(r|u|user)\//i.test(url);
}

/**
 * Check if URL is a Google News redirect (not a real article URL)
 */
function isGoogleNewsRedirect(url: string | undefined): boolean {
  if (!url) return false;
  return /news\.google\.com\/rss\/articles\//i.test(url);
}

/**
 * Check if item URL should be excluded from podcast extraction
 */
function shouldExcludeItem(item: RankedItem): boolean {
  return isRedditUrl(item.url) || isGoogleNewsRedirect(item.url);
}

/**
 * Check if URL is valid (not Inoreader, not empty, http/https)
 */
function isValidUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  if (url.includes("inoreader.com") || url.includes("google.com/reader")) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

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
    model: "gpt-4o-mini",
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
      model: "gpt-4o-mini",
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
 * Minimum relevance score for podcast items (0-10)
 */
const MIN_RELEVANCE_SCORE = 3;

/**
 * Extract digests from multiple items in parallel
 * Filters out Reddit, Google News redirects, and low-relevance items
 */
export async function extractPodcastBatchDigests(
  items: RankedItem[],
  userPrompt: string = ""
): Promise<PodcastItemDigest[]> {
  logger.info(`Extracting podcast digests for ${items.length} items`);

  // Filter out non-article URLs before processing (Reddit, Google News redirects)
  const validItems = items.filter(item => !shouldExcludeItem(item));
  if (validItems.length < items.length) {
    logger.info(`Filtered out ${items.length - validItems.length} non-article items before podcast extraction (Reddit, Google News redirects)`);
  }

  // Filter items with invalid URLs
  const itemsWithValidUrls = validItems.filter(item => isValidUrl(item.url));
  if (itemsWithValidUrls.length < validItems.length) {
    logger.info(`Filtered out ${validItems.length - itemsWithValidUrls.length} items with invalid URLs`);
  }

  const digests = await Promise.all(
    itemsWithValidUrls.map((item) => extractPodcastItemDigest(item, userPrompt))
  );

  // Filter by relevance score after extraction
  const relevantDigests = digests.filter(d => (d.relevance_to_focus ?? 5) >= MIN_RELEVANCE_SCORE);
  if (relevantDigests.length < digests.length) {
    logger.info(`Filtered out ${digests.length - relevantDigests.length} low-relevance podcast digests (score < ${MIN_RELEVANCE_SCORE})`);
  }

  logger.info(`Extracted ${relevantDigests.length} podcast digests (from ${items.length} original items)`);
  return relevantDigests;
}

/**
 * Bad URL patterns for podcast digests
 */
const BAD_PODCAST_URL_PATTERNS = [
  /reddit\.com\/r\//i,
  /reddit\.com\/u\//i,
  /news\.google\.com\/rss\//i,
  /inoreader\.com/i,
  /\/advertis(e|ing)/i,
  /\/sponsor/i,
  /\/unsubscribe/i,
  /\/subscribe(?![a-z])/i,
];

/**
 * AI-style words to flag in podcast content
 */
const AI_LANGUAGE_WORDS = [
  "highlights",
  "underscores",
  "shapes",
  "fosters",
  "emerging",
  "landscape",
  "leveraging",
  "harnessing",
  "delve",
  "showcase",
];

/**
 * Check if URL is bad for podcasts
 */
function isBadPodcastUrl(url: string): boolean {
  if (!url) return true;
  for (const pattern of BAD_PODCAST_URL_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if text contains AI-like language patterns
 */
function hasAILanguage(text: string): boolean {
  const lowerText = text.toLowerCase();
  return AI_LANGUAGE_WORDS.some(word => lowerText.includes(word));
}

/**
 * Review podcast digest for quality issues
 */
export interface PodcastDigestReviewResult {
  passed: boolean;
  issues: string[];
  digestsWithIssues: Set<string>;
}

/**
 * Review podcast digests for quality issues
 * Filters out bad URLs, AI language, and low-quality content
 */
export function reviewPodcastDigests(digests: PodcastItemDigest[]): PodcastDigestReviewResult {
  const issues: string[] = [];
  const digestsWithIssues = new Set<string>();

  for (const digest of digests) {
    const digestIssues: string[] = [];

    // 1. Check URL
    if (isBadPodcastUrl(digest.url)) {
      digestIssues.push(`Bad URL: ${digest.url}`);
    }

    // 2. Check gist for AI language
    if (hasAILanguage(digest.one_sentence_gist)) {
      digestIssues.push("Gist contains AI-style language");
    }

    // 3. Check takeaway for AI language
    if (hasAILanguage(digest.one_line_takeaway)) {
      digestIssues.push("Takeaway contains AI-style language");
    }

    // 4. Check soundbite lines for AI language
    if (digest.soundbite_lines.some(line => hasAILanguage(line))) {
      digestIssues.push("Soundbite contains AI-style language");
    }

    // 5. Check for low relevance
    if ((digest.relevance_to_focus ?? 5) < 3) {
      digestIssues.push(`Low relevance score: ${digest.relevance_to_focus}`);
    }

    if (digestIssues.length > 0) {
      digestsWithIssues.add(digest.id);
      issues.push(`${digest.title}: ${digestIssues.join(" | ")}`);
    }
  }

  return {
    passed: digestsWithIssues.size === 0,
    issues,
    digestsWithIssues,
  };
}

/**
 * Filter podcast digests by quality review
 */
export function filterPodcastDigestsByQuality(digests: PodcastItemDigest[]): PodcastItemDigest[] {
  const review = reviewPodcastDigests(digests);

  if (review.issues.length > 0) {
    logger.warn("Filtering out low-quality podcast digests", {
      totalDigests: digests.length,
      filtered: review.digestsWithIssues.size,
      issues: review.issues.slice(0, 3),
    });
  }

  return digests.filter(d => !review.digestsWithIssues.has(d.id));
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
