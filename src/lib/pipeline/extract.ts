/**
 * Item extraction and digest generation (Pass 1)
 * Converts raw items with full text into structured digests
 * Uses gpt-5.2-chat-latest with strict JSON schema
 */

import OpenAI from "openai";
import { RankedItem } from "../model";
import { logger } from "../logger";

export interface ItemDigest {
  id: string;
  title: string;
  url: string;
  sourceTitle: string;
  topicTags: string[];
  gist: string; // 1-2 sentence summary
  keyBullets: string[]; // 3-5 key points
  namedEntities: string[]; // Important names/orgs/projects
  whyItMatters: string; // Relevance to coding/agents/IR
  sourceCredibility: "high" | "medium" | "low";
  userRelevanceScore: number; // 0-10 based on user prompt match
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
    max_completion_tokens: 300,
    messages: [
      {
        role: "user",
        content: `Summarize the key points from this text chunk (${index}/${total}). Be concise:

${chunk}`,
      },
    ],
  });

  return response.choices[0].message.content || "";
}

/**
 * Extract digest from item with full text
 * Handles chunking for long articles automatically
 */
export async function extractItemDigest(
  item: RankedItem,
  userPrompt: string = ""
): Promise<ItemDigest> {
  const client = new OpenAI();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    logger.warn("OPENAI_API_KEY not set, using fallback digest");
    return generateFallbackDigest(item, userPrompt);
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
        logger.info(`Chunking long article: "${item.title}" (${chunks.length} chunks)`);

        // Summarize each chunk
        const chunkSummaries = await Promise.all(
          chunks.map((chunk, idx) => summarizeChunk(client, chunk, idx + 1, chunks.length))
        );

        // Merge summaries
        processedText = chunkSummaries.join("\n\n");
      }
    }

    // Extract digest from processed text
    const response = await client.chat.completions.create({
      model: "gpt-5.2-chat-latest",
      max_completion_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `Extract structured digest from this article/resource.

Title: "${item.title}"
Source: ${item.sourceTitle}
Categories: ${item.category}
User Focus: ${userPrompt || "General code intelligence"}

Content:
${processedText}

Return JSON with:
- topicTags: [list of 3-5 relevant tags like "code-search", "agents", "benchmarks"]
- gist: 1-2 sentence summary (max 100 chars)
- keyBullets: [3-5 key points, each max 100 chars]
- namedEntities: [important names/projects/orgs mentioned]
- whyItMatters: 1-2 sentence explanation of relevance (max 150 chars)
- sourceCredibility: "high" (academic/official), "medium" (established), "low" (casual)
- userRelevanceScore: 0-10 based on match with user focus (${userPrompt || "general code topics"})

Return ONLY valid JSON, no markdown.`,
        },
      ],
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No response from extraction model");
    }

    const extracted = JSON.parse(content);

    return {
      id: item.id,
      title: item.title,
      url: item.url,
      sourceTitle: item.sourceTitle,
      topicTags: Array.isArray(extracted.topicTags) ? extracted.topicTags : [],
      gist: extracted.gist || "",
      keyBullets: Array.isArray(extracted.keyBullets) ? extracted.keyBullets : [],
      namedEntities: Array.isArray(extracted.namedEntities) ? extracted.namedEntities : [],
      whyItMatters: extracted.whyItMatters || "",
      sourceCredibility: extracted.sourceCredibility || "medium",
      userRelevanceScore: Math.min(10, Math.max(0, extracted.userRelevanceScore || 5)),
    };
  } catch (error) {
   const errorMsg = error instanceof Error ? error.message : String(error);
   const errorStack = error instanceof Error ? error.stack : undefined;
   logger.warn(`Extraction failed for "${item.title}"`, {
     error: errorMsg,
     stack: errorStack,
     itemId: item.id,
   });
   return generateFallbackDigest(item, userPrompt);
  }
}

/**
 * Extract digests from multiple items in parallel
 */
export async function extractBatchDigests(
  items: RankedItem[],
  userPrompt: string = ""
): Promise<ItemDigest[]> {
  logger.info(`Extracting digests for ${items.length} items`);

  const digests = await Promise.all(
    items.map((item) => extractItemDigest(item, userPrompt))
  );

  logger.info(`Extracted ${digests.length} digests`);
  return digests;
}

/**
 * Fallback digest when extraction fails or API unavailable
 */
function generateFallbackDigest(item: RankedItem, userPrompt: string): ItemDigest {
  const tags = item.llmScore.tags.slice(0, 5);
  const bullet = item.summary || item.contentSnippet || "No summary available";

  return {
    id: item.id,
    title: item.title,
    url: item.url,
    sourceTitle: item.sourceTitle,
    topicTags: tags,
    gist: bullet.substring(0, 100),
    keyBullets: [bullet.substring(0, 150)],
    namedEntities: [],
    whyItMatters: `Relevant to ${userPrompt || "code intelligence"}.`,
    sourceCredibility: "medium",
    userRelevanceScore: Math.round(item.finalScore * 10),
  };
}
