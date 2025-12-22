/**
 * Item extraction and digest generation (Pass 1)
 * Converts raw items with full text into structured digests
 * Uses gpt-5.2-chat-latest with strict JSON schema
 */

import OpenAI from "openai";
import { RankedItem } from "../model";
import { logger } from "../logger";
import { decomposeNewsletterItems } from "./decompose";
import { findArticleUrl, extractUrlFromContent } from "../search/url-finder";

export interface ItemDigest {
  id: string;
  title: string;
  url: string;
  sourceTitle: string;
  category: string; // Resource category: research, community, newsletters, etc.
  topicTags: string[];
  gist: string; // 1-2 sentence summary
  keyBullets: string[]; // 3-5 key points
  namedEntities: string[]; // Important names/orgs/projects
  whyItMatters: string; // Relevance to coding/agents/IR
  sourceCredibility: "high" | "medium" | "low";
  userRelevanceScore: number; // 0-10 based on user prompt match
  
  // Enriched metadata (extracted from actual article page)
  author?: string; // Article author (Substack, Medium, dev.to, etc.)
  publishDate?: string; // Article publication date (ISO 8601)
  originalSource?: string; // Original source domain (e.g., "substack.com", "medium.com")
}

const CHUNK_SIZE = 2000; // Characters per chunk

/**
 * Metadata extracted from article page
 */
interface PageMetadata {
  author?: string;
  publishDate?: string;
  originalSource?: string; // Domain of the article (not the newsletter)
}

/**
 * Synchronously extract metadata from article URL (no I/O)
 * Looks for: author from URL patterns, and original source domain
 */
function extractMetadataSync(url: string): PageMetadata {
  if (!url || !url.startsWith("http")) {
    return {};
  }

  try {
    // Extract domain for originalSource
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace("www.", "");
    
    // For Substack, extract author from URL pattern (e.g., "alice.substack.com")
    if (domain.includes("substack.com")) {
      const match = url.match(/https:\/\/([^.]+)\.substack\.com/);
      if (match) {
        return {
          author: match[1],
          originalSource: "substack.com",
        };
      }
    }
    
    // For Medium, try to extract author from URL pattern (e.g., "@authorname")
    if (domain.includes("medium.com")) {
      const match = url.match(/medium\.com\/@([^/]+)/);
      if (match) {
        return {
          author: match[1],
          originalSource: "medium.com",
        };
      }
      return {
        originalSource: "medium.com",
      };
    }
    
    // For dev.to
    if (domain.includes("dev.to")) {
      return {
        originalSource: "dev.to",
      };
    }

    // Generic: just return the domain
    return {
      originalSource: domain,
    };
  } catch (error) {
    logger.warn(`Failed to extract metadata from URL: ${url}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * Asynchronously fetch and extract metadata from article URL
 * (Currently just calls sync version, but prepared for future API calls)
 */
async function fetchArticleMetadata(url: string): Promise<PageMetadata> {
  return extractMetadataSync(url);
}

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
 * Check if source is an email newsletter (content is embedded, not linked)
 */
function isEmailNewsletterSource(sourceTitle: string): boolean {
  // Only known email newsletters should have no link
  // Don't include ALL Inoreader URLs - only the actual newsletters
  return ["TLDR", "Byte Byte Go", "Pointer", "Substack", "Elevate", "Architecture Notes", "Leadership in Tech", "Programming Digest", "System Design"].some(
    name => sourceTitle.includes(name)
  );
}

/**
 * Check if source is a newsletter with original content (not just link aggregation)
 */
function isNewsletterOnlyContent(sourceTitle: string): boolean {
  const newsletterOnlyContent = [
    "Elevate",
    "System Design",
    "Architecture Notes",
    "Leadership in Tech",
    "Programming Digest",
  ];
  return newsletterOnlyContent.some(n => sourceTitle.includes(n));
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
 * Extract digest from item with full text
 * Handles chunking for long articles automatically
 */
export async function extractItemDigest(
  item: RankedItem,
  userPrompt: string = ""
): Promise<ItemDigest> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    logger.warn(`OPENAI_API_KEY not set for item "${item.title}", using fallback digest (URL: ${item.url})`);
    return generateFallbackDigest(item, userPrompt);
  }

  const client = new OpenAI({ apiKey });

  try {
    // For email newsletters/Inoreader URLs, use summary directly (it's the actual content)
    let fullText = item.fullText || item.summary || item.contentSnippet || "";
    
    if (isEmailNewsletterSource(item.sourceTitle) && item.summary) {
      logger.info(`Using embedded content for email newsletter: "${item.title}"`);
      fullText = stripHtml(item.summary);
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

${processedText.length < 300 ? "Note: Content is sparse. Infer insights from the title and available text." : ""}

Return JSON with:
- topicTags: [list of 3-5 relevant tags like "code-search", "agents", "benchmarks"]
- gist: 1-2 sentence summary capturing the essence (max 120 chars). If content is sparse, use title context.
- keyBullets: [2-5 key points inferred from title/content, each max 100 chars. If sparse, focus on what the title suggests.]
- namedEntities: [important names/projects/orgs mentioned, inferred if needed]
- whyItMatters: 1-2 sentence explanation of relevance to coding/agents/IR (max 150 chars)
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

    // Keep the URL from item (may have been extracted from HTML content)
    // Email newsletters like TLDR contain links to actual articles - we should preserve those
    let digestUrl = item.url;
    
    // If URL is missing or invalid, try to find it via web search
    // But keep Inoreader URLs for newsletter-only content (Elevate, System Design, etc.)
    if (!digestUrl || (digestUrl.includes("inoreader.com") && !isNewsletterOnlyContent(item.sourceTitle))) {
      logger.debug(`Attempting to find URL for article: "${item.title}"`);
      const foundUrl = await findArticleUrl(item.title, item.sourceTitle, item.summary || item.fullText);
      if (foundUrl) {
        digestUrl = foundUrl;
        logger.info(`Found article URL via search: "${item.title}" -> ${foundUrl}`);
      }
    }
    
    // Debug: log URLs for newsletter items
    if (["TLDR", "Byte Byte Go", "Pointer", "Substack", "Elevate", "Architecture Notes", "Leadership in Tech", "Programming Digest", "System Design"].some(n => item.sourceTitle.includes(n))) {
      logger.info(`[EXTRACT_DIGEST] Item ${item.id} URL: ${digestUrl}`);
    }

    // Fetch enriched metadata from the article URL (author, original source, etc.)
    const metadata = await fetchArticleMetadata(digestUrl);

    return {
      id: item.id,
      title: item.title,
      url: digestUrl,
      sourceTitle: item.sourceTitle,
      category: item.category,
      topicTags: Array.isArray(extracted.topicTags) ? extracted.topicTags : [],
      gist: extracted.gist || "",
      keyBullets: Array.isArray(extracted.keyBullets) ? extracted.keyBullets : [],
      namedEntities: Array.isArray(extracted.namedEntities) ? extracted.namedEntities : [],
      whyItMatters: extracted.whyItMatters || "",
      sourceCredibility: extracted.sourceCredibility || "medium",
      userRelevanceScore: Math.min(10, Math.max(0, extracted.userRelevanceScore || 5)),
      
      // Enriched metadata from article page
      author: metadata.author,
      publishDate: metadata.publishDate,
      originalSource: metadata.originalSource,
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
 * Automatically decomposes email newsletter items into constituent articles
 */
export async function extractBatchDigests(
  items: RankedItem[],
  userPrompt: string = ""
): Promise<ItemDigest[]> {
  logger.info(`[EXTRACT_START] Extracting digests for ${items.length} items, userPrompt="${userPrompt}"`);

  // First pass: decompose newsletters into constituent articles
  logger.info(`[BEFORE_DECOMPOSE] About to decompose ${items.length} items`);
  const decomposedItems = decomposeNewsletterItems(items);
  logger.info(`[AFTER_DECOMPOSE] Got ${decomposedItems.length} items after decomposition`);
  logger.info(
    `After decomposition: ${decomposedItems.length} items ` +
    `(${decomposedItems.length - items.length > 0 ? "+" : ""}${decomposedItems.length - items.length} from newsletters)`
  );
  
  // Log decomposition results in detail
  if (decomposedItems.length > items.length) {
    logger.info(`Decomposition produced extra items. Sample URLs: ${decomposedItems.slice(0, 3).map(i => i.url).join(", ")}`);
  }

  // Debug: Log ALL newsletter item URLs before and after decomposition
  const newsletterItems = items.filter(i => ["TLDR", "Byte Byte Go", "Pointer", "Substack", "Elevate", "Architecture Notes", "Leadership in Tech", "Programming Digest", "System Design"].some(n => i.sourceTitle.includes(n)));
  const decomposedNewsletters = decomposedItems.filter(i => ["TLDR", "Byte Byte Go", "Pointer", "Substack", "Elevate", "Architecture Notes", "Leadership in Tech", "Programming Digest", "System Design"].some(n => i.sourceTitle.includes(n)));
  if (newsletterItems.length > 0) {
    logger.info(`[URL_DEBUG] Original newsletter items (${newsletterItems.length}): ${newsletterItems.map(i => `${i.title.substring(0, 30)}... -> ${i.url}`).join(" | ")}`);
    logger.info(`[URL_DEBUG] Decomposed newsletter items (${decomposedNewsletters.length}): ${decomposedNewsletters.slice(0, 5).map(i => `${i.title.substring(0, 30)}... -> ${i.url}`).join(" | ")}`);
    // Detailed debug for first decomposed item
    if (decomposedNewsletters.length > 0) {
      const first = decomposedNewsletters[0];
      logger.info(`[EXTRACT_DEBUG] First decomposed item: id=${first.id}, url=${first.url}, has fullText=${!!(first.fullText)}, fullText length=${first.fullText?.length || 0}`);
    }
  }

  // Log decomposed item URLs BEFORE extraction
  const decomposedItemUrls = decomposedItems.slice(0, 5).map(i => ({ id: i.id.substring(0, 40), title: i.title.substring(0, 40), url: i.url }));
  logger.info(`[BEFORE_EXTRACT] Decomposed item URLs: ${JSON.stringify(decomposedItemUrls)}`);

  const digests = await Promise.all(
    decomposedItems.map((item) => extractItemDigest(item, userPrompt))
  );

  logger.info(`Extracted ${digests.length} digests`);
  
  // Log sample digest URLs AFTER extraction
  const digestUrls = digests.slice(0, 5).map(d => ({ id: d.id.substring(0, 40), title: d.title.substring(0, 40), url: d.url }));
  logger.info(`[AFTER_EXTRACT] Sample digest URLs: ${JSON.stringify(digestUrls)}`);
  
  return digests;
}

/**
 * Fallback digest when extraction fails or API unavailable
 */
function generateFallbackDigest(item: RankedItem, _userPrompt: string): ItemDigest {
  const tags = item.llmScore.tags.slice(0, 5);
  const rawContent = item.summary || item.contentSnippet || "No summary available";
  
  // Strip HTML if needed
  const cleanContent = rawContent.includes("<") ? stripHtml(rawContent) : rawContent;
  
  // Generate more informative whyItMatters from actual content
  let whyItMatters = cleanContent.substring(0, 150).trim();
  if (whyItMatters.length < 50) {
    whyItMatters = `From ${item.sourceTitle}. Topics: ${tags.join(", ")}`;
  } else if (!whyItMatters.endsWith(".")) {
    whyItMatters += "...";
  }

  // Keep the URL from item (may have been extracted from HTML content)
  // Email newsletters like TLDR contain links to actual articles - we should preserve those
  let digestUrl = item.url;

  // If URL is missing or looks like Inoreader wrapper, try to extract from content
  if (!digestUrl || digestUrl.includes("inoreader.com")) {
    const contentUrl = extractUrlFromContent(item.summary || item.fullText);
    if (contentUrl) {
      digestUrl = contentUrl;
      logger.debug(`Extracted URL from content: "${item.title}" -> ${digestUrl}`);
    }
  }

  // Try to extract metadata for fallback case too
  const metadataSync = extractMetadataSync(digestUrl);

  return {
    id: item.id,
    title: item.title,
    url: digestUrl,
    sourceTitle: item.sourceTitle,
    category: item.category,
    topicTags: tags,
    gist: cleanContent.substring(0, 100).trim(),
    keyBullets: cleanContent.length > 150 
      ? [cleanContent.substring(0, 150).trim() + "..."] 
      : [cleanContent.trim()],
    namedEntities: [],
    whyItMatters,
    sourceCredibility: "medium",
    userRelevanceScore: Math.round(item.finalScore * 10),
    
    // Enriched metadata (sync version for fallback)
    author: metadataSync.author,
    publishDate: metadataSync.publishDate,
    originalSource: metadataSync.originalSource,
  };
}
