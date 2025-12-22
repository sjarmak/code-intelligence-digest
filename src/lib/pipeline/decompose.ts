/**
 * Newsletter decomposition
 * Extracts individual articles from email newsletters (TLDR, Pointer, Substack, etc.)
 * and creates separate RankedItem entries for each article
 */

import { RankedItem } from "../model";
import { logger } from "../logger";

const NEWSLETTER_SOURCES = ["TLDR", "Byte Byte Go", "Pointer", "Substack", "Elevate"];

/**
 * Check if item is from a known email newsletter source
 */
export function isNewsletterSource(sourceTitle: string): boolean {
  return NEWSLETTER_SOURCES.some(name => sourceTitle.includes(name));
}

/**
 * Extract article links and metadata from newsletter HTML
 * Handles multiple article formats:
 * - Link text followed by description (markdown-style)
 * - HTML links with surrounding text
 * - Numbered list items
 */
function extractArticlesFromHtml(html: string): Array<{
  title: string;
  url: string;
  snippet: string;
}> {
  const articles: Array<{ title: string; url: string; snippet: string }> = [];

  if (!html || html.length === 0) {
    return articles;
  }

  // Clean HTML entities
  const cleanHtml = html
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // Pattern 1: Markdown-style links [Title](URL)
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  const seen = new Set<string>();

  while ((match = markdownLinkRegex.exec(cleanHtml)) !== null) {
    const [, title, url] = match;

    if (title && url && !seen.has(url)) {
      // Skip certain URLs
      if (
        !url.includes("inoreader.com") &&
        !url.includes("google.com/reader") &&
        !url.startsWith("javascript:")
      ) {
        articles.push({
          title: title.trim(),
          url: url.trim(),
          snippet: title.trim(), // Will be enhanced below
        });
        seen.add(url);
      }
    }
  }

  // Pattern 2: HTML anchor tags <a href="...">Title</a>
  // Modified to handle nested tags like <strong>, <em>, etc.
  const htmlLinkRegex = /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  while ((match = htmlLinkRegex.exec(cleanHtml)) !== null) {
    const [, rawUrl, rawTitle] = match;
    // Strip HTML tags from title
    const title = rawTitle.replace(/<[^>]*>/g, "").trim();
    
    // Extract actual URL from tracking/redirect URLs
    // Handles: https://tracking.tldrnewsletter.com/CL0/https:%2F%2Factual-url
    let url = rawUrl;
    
    // For tracking URLs, extract the encoded destination
    if (rawUrl.includes("/CL0/")) {
      // Extract everything between /CL0/ and /1/ (version number)
      // The encoded URL contains %2F for slashes and %3A for colons
      const trackingMatch = rawUrl.match(/\/CL0\/(.+?)\/\d+\//);
      if (trackingMatch) {
        // Decode %2F to /, %3A to :, %3D to =, %3F to ?
        url = trackingMatch[1]
          .replace(/%2F/g, "/")
          .replace(/%3A/g, ":")
          .replace(/%3D/g, "=")
          .replace(/%3F/g, "?");
      }
    }

    if (title && url && !seen.has(url)) {
      // Skip certain URLs (but allow decoded URLs from tracking redirects)
      if (
        !url.includes("inoreader.com") &&
        !url.includes("google.com/reader") &&
        !url.includes("tracking.tldrnewsletter") &&
        !url.startsWith("javascript:")
      ) {
        articles.push({
          title: title.trim(),
          url: url.trim(),
          snippet: title.trim(),
        });
        seen.add(url);
      }
    }
  }

  // Pattern 3: Raw URLs on their own lines preceded by text (common in email newsletters)
  const urlOnlyRegex = /^(\d+\.\s+)?(.+?)(?:\s*[-–]|\s+)?(https?:\/\/[^\s<>"]+)/gm;
  while ((match = urlOnlyRegex.exec(cleanHtml)) !== null) {
    const [, , title, url] = match;

    if (title && url && !seen.has(url)) {
      // Skip certain URLs and very long titles (likely not real)
      if (
        !url.includes("inoreader.com") &&
        !url.includes("google.com/reader") &&
        !url.startsWith("javascript:") &&
        title.length < 200
      ) {
        articles.push({
          title: title.trim(),
          url: url.trim(),
          snippet: title.trim(),
        });
        seen.add(url);
      }
    }
  }

  return articles;
}

/**
 * Create a RankedItem for a single article extracted from a newsletter
 * Inherits metadata from the original newsletter item but with article-specific content
 */
function createArticleItem(
  baseItem: RankedItem,
  article: { title: string; url: string; snippet: string },
  articleIndex: number,
  totalArticles: number
): RankedItem {
  return {
    // Keep base item properties but with article-specific data
    id: `${baseItem.id}-article-${articleIndex}`,
    streamId: baseItem.streamId,
    sourceTitle: baseItem.sourceTitle, // Keep original source (TLDR, etc.)
    title: article.title,
    url: article.url,
    author: baseItem.author,
    publishedAt: baseItem.publishedAt,
    
    // Use snippet as summary for the article
    summary: article.snippet,
    contentSnippet: article.snippet.substring(0, 500),
    categories: baseItem.categories,
    category: baseItem.category,
    raw: baseItem.raw,
    fullText: baseItem.fullText,

    // Scoring: inherit from base but slightly adjust
    // Articles from newsletters get a small boost (they were already filtered by newsletter editor)
    bm25Score: baseItem.bm25Score * 0.95, // Slight penalty to avoid duplicate domination
    llmScore: {
      ...baseItem.llmScore,
    },
    recencyScore: baseItem.recencyScore,
    engagementScore: baseItem.engagementScore,
    
    // Reduce final score slightly since we're splitting one newsletter into multiple items
    // This prevents newsletter items from dominating the digest
    finalScore: baseItem.finalScore * 0.90,
    
    reasoning: `${baseItem.reasoning} [Decomposed from ${baseItem.sourceTitle} newsletter: article ${articleIndex}/${totalArticles}]`,
  };
}

/**
 * Decompose newsletter items into individual articles
 * Processes a single RankedItem and returns an array of items (one per article)
 * If item is not a newsletter or contains no extractable articles, returns [item]
 */
export function decomposeNewsletterItem(item: RankedItem): RankedItem[] {
  // Only decompose known newsletter sources
  if (!isNewsletterSource(item.sourceTitle)) {
    return [item];
  }

  // Extract HTML content
  const htmlContent = item.fullText || item.summary || item.contentSnippet || "";
  if (!htmlContent) {
    logger.warn(`Newsletter item "${item.title}" has no content to decompose`);
    return [item];
  }

  // Extract articles from HTML
  const articles = extractArticlesFromHtml(htmlContent);
  
  if (articles.length === 0) {
    logger.warn(`No articles extracted from newsletter: "${item.title}"`);
    return [item]; // Fallback: return original item
  }

  if (articles.length === 1) {
    // Only one article, update the item with the extracted article info
    logger.info(`Single article found in ${item.sourceTitle}: "${articles[0].title}"`);
    return [
      {
        ...item,
        title: articles[0].title,
        url: articles[0].url,
        summary: articles[0].snippet,
        contentSnippet: articles[0].snippet.substring(0, 500),
      },
    ];
  }

  // Multiple articles: create separate items for each
  logger.info(`Decomposing ${item.sourceTitle} into ${articles.length} articles`);
  
  return articles.map((article, idx) =>
    createArticleItem(item, article, idx + 1, articles.length)
  );
}

/**
 * Decompose all newsletter items in a batch
 * Returns flattened array with newsletter items replaced by their constituent articles
 */
export function decomposeNewsletterItems(items: RankedItem[]): RankedItem[] {
  const result: RankedItem[] = [];

  for (const item of items) {
    if (isNewsletterSource(item.sourceTitle)) {
      const decomposed = decomposeNewsletterItem(item);
      result.push(...decomposed);
    } else {
      result.push(item);
    }
  }

  logger.info(
    `Decomposed ${items.length} items into ${result.length} items ` +
    `(${result.length - items.length > 0 ? "+" : ""}${result.length - items.length} from newsletters)`
  );

  return result;
}
