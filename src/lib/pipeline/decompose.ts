/**
 * Newsletter decomposition
 * Extracts individual articles from email newsletters (TLDR, Pointer, Substack, etc.)
 * and creates separate RankedItem entries for each article
 */

import { RankedItem } from "../model";
import { logger } from "../logger";

const NEWSLETTER_SOURCES = ["TLDR", "Byte Byte Go", "Pointer", "Substack", "Elevate", "Architecture Notes", "Leadership in Tech", "Programming Digest", "System Design"];

/**
 * URLs to exclude from newsletter decomposition
 * These are collection pages, meta links, and aggregators that don't contain single article content
 */
const BAD_URL_PATTERNS = [
  // Newsletter collection/digest pages (with or without trailing slash/params)
  /\/newsletters?(?:[/?#]|$)/i,
  /\/issues?(?:[/?#]|$)/i,
  /\/archive(?:[/?#]|$)/i,

  // Meta/admin pages (advertise, privacy, unsubscribe, media kit, etc.)
  /\/(advertise|sponsor|advertising|partnership|ad-?service|advert|commerci)(?:[/?#]|$)/i,
  /\/(privacy|terms|policies|legal|disclaimer)(?:[/?#]|$)/i,
  /\/(unsubscribe|preferences|settings|manage|opt-?out)(?:[/?#]|$)/i,
  /\/(media-kit|press|about|contact|info|help)(?:[/?#]|$)/i,
  /\/(feeds?|rss|subscribe|signup|join|register|login|sign-?in)(?:[/?#]|$)/i,

  // Social aggregators - Reddit subreddits, user pages, and discussions (not external articles shared on Reddit)
  /reddit\.com\/r\//i, // Any /r/subreddit/* (discussion threads, not external links)
  /reddit\.com\/u\//i, // User profiles

  // Digest collection domains - exclude any path containing "digest"
  // These are newsletter index pages, not individual articles
  /(csharpdigest|leadershipintech|reactdigest|programming[?_-]?digest|newsletter[?_-]?digest|tech[?_-]?digest)\.com/i,

  // Any domain with "digest" in it that doesn't have article-like path structure
  /\w+digest\.\w+\/(?![\w-]+\/\d+|[\w-]+$|p\/|post\/|article\/|story\/)/i,

  // Common ad/marketing domains and redirect URLs
  /linktrak\.io/i, // Analytics/tracking redirects
  /click\.linksynergy\.com/i, // Affiliate redirects
  /\.eventbrite\.com\/([\w-]+)?(?:[/?#]|$)/i, // Event pages without specific event ID
  /meetup\.com\/[^\/]+\/(?!events?\/|members?\/)/i, // Meetup group pages, not specific events
];

/**
 * Bad title patterns - articles with these titles should be excluded
 */
const BAD_TITLE_PATTERNS = [
  /^advertise$/i,
  /^sponsor$/i,
  /^advertisement$/i,
  /^promotional content$/i,
  /^(subscribe|join|sign up)$/i,
  // Subscription/promotional newsletter titles
  /subscribe to .* (newsletter|publication)/i,
  /^(the|subscribe|get) .* (in|for) \d{4}$/i, // e.g., "The Pragmatic Engineer in 2025"
  /.* (in|for) \d{4}$/i, // Titles ending with year (often subscription promotions)
];

/**
 * Validate that URL is absolute and valid
 */
function isValidAbsoluteUrl(url: string): boolean {
  if (!url || url.trim().length === 0) {
    return false;
  }

  // Must start with http:// or https://
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return false;
  }

  // Basic URL validation
  try {
    const parsed = new URL(url);
    return parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if URL should be excluded from decomposition
 */
function shouldExcludeUrl(url: string): boolean {
  // First check if it's a valid absolute URL
  if (!isValidAbsoluteUrl(url)) {
    return true;
  }

  // Check against bad URL patterns
  for (const pattern of BAD_URL_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }

  // Additional check: filter subscription/signup pages more aggressively
  // Check for subscription-related keywords in the URL path
  const urlLower = url.toLowerCase();
  const subscriptionKeywords = [
    '/subscribe',
    '/signup',
    '/sign-up',
    '/join',
    '/register',
    'subscribe?',
    'signup?',
    '?subscribe',
    '?signup',
    'utm_campaign=email-home', // Newsletter home pages
    'utm_campaign=email-subscribe', // Subscription pages
  ];

  if (subscriptionKeywords.some(keyword => urlLower.includes(keyword))) {
    return true;
  }

  // Filter Substack newsletter home pages (like newsletter.pragmaticengineer.com with no article path)
  // These are subscription/landing pages, not articles
  if (urlLower.includes('newsletter.') && urlLower.includes('.com')) {
    // Check if it's a newsletter domain without an article path (no /p/, /post/, etc.)
    const isNewsletterDomain = /newsletter\.\w+\.com/i.test(url);
    const hasArticlePath = /\/(p|post|article|story|archive)\//i.test(url);
    const isJustDomain = /newsletter\.\w+\.com\/?(\?|$)/i.test(url);

    if (isNewsletterDomain && !hasArticlePath && isJustDomain) {
      return true;
    }

    // Also filter newsletter domains with only query params (subscription pages)
    if (isNewsletterDomain && !hasArticlePath && urlLower.includes('?')) {
      return true;
    }

    // Filter subscription pages on newsletter domains
    if (isNewsletterDomain && (urlLower.includes('/subscribe') || urlLower.includes('subscribe?'))) {
      return true;
    }
  }

  // Filter Substack user profile pages (like substack.com/@username)
  if (/substack\.com\/@[\w-]+$/i.test(url) || /substack\.com\/@[\w-]+\/?$/i.test(url)) {
    return true;
  }

  // CRITICAL: Filter ALL Substack URLs that don't have /p/ (article post path)
  // Substack home pages, index pages, and profile pages redirect to main page
  // Only /p/article-slug URLs are actual article pages
  if (url.includes('.substack.com') || url.includes('substack.com/')) {
    // Allow only article post URLs with /p/ path
    if (!url.includes('/p/')) {
      return true; // Reject - this is a home page or index page
    }
    // Also reject if it's just the domain with /p/ but no actual slug
    if (/\.substack\.com\/p\/?(\?|$|#)/i.test(url)) {
      return true; // Reject - incomplete article URL
    }
  }

  return false;
}

/**
 * Check if title should be excluded (e.g., meta content, ads)
 */
function shouldExcludeTitle(title: string): boolean {
  if (!title) return false;
  for (const pattern of BAD_TITLE_PATTERNS) {
    if (pattern.test(title.trim())) {
      return true;
    }
  }
  return false;
}

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
 * - Title-then-URL patterns (newsletter articles without explicit links)
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
    const trimmedUrl = url?.trim() || "";

    if (title && trimmedUrl && isValidAbsoluteUrl(trimmedUrl) && !seen.has(trimmedUrl)) {
      const trimmedTitle = title.trim();
      // Skip certain URLs and titles
      if (
        !trimmedUrl.includes("inoreader.com") &&
        !trimmedUrl.includes("google.com/reader") &&
        !trimmedUrl.startsWith("javascript:") &&
        !shouldExcludeUrl(trimmedUrl) &&
        !shouldExcludeTitle(trimmedTitle)
      ) {
        articles.push({
          title: trimmedTitle,
          url: trimmedUrl,
          snippet: trimmedTitle, // Will be enhanced below
        });
        seen.add(trimmedUrl);
      }
    }
  }

  // Helper: Find URLs that appear within a reasonable distance of a title
  // This handles newsletter formats where title and URL are separate
  function findUrlNearby(startIndex: number, maxDistance: number = 500): string | null {
    const searchText = cleanHtml.substring(startIndex, startIndex + maxDistance);
    const urlMatch = searchText.match(/https?:\/\/[^\s<>"'\)]+/);
    return urlMatch ? urlMatch[0] : null;
  }

  // Pattern 2: HTML anchor tags <a href="...">Title</a>
  // Modified to handle nested tags like <strong>, <em>, etc.
  // First normalize newlines in href attributes to handle multiline attributes
  const normalizedHtml = cleanHtml.replace(/href=["']([^"'][\s\S]*?)["']/g, 'href="$1"').replace(/\n/g, '');
  const htmlLinkRegex = /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  while ((match = htmlLinkRegex.exec(normalizedHtml)) !== null) {
    const [, rawUrl, rawTitle] = match;
    // Strip HTML tags from title
    const title = rawTitle.replace(/<[^>]*>/g, "").trim();

    // Extract actual URL from tracking/redirect URLs
    // Handles: https://tracking.tldrnewsletter.com/CL0/https:%2F%2Factual-url
    let url = rawUrl;

    // For TLDR tracking URLs, extract the encoded destination
    if (rawUrl.includes("/CL0/")) {
      // Extract everything between /CL0/ and /1/ (version number)
      // The encoded URL contains %2F for slashes and %3A for colons
      const trackingMatch = rawUrl.match(/\/CL0\/(.+?)\/\d+\//);
      if (trackingMatch) {
        // Decode %2F to /, %3A to :, %3D to =, %3F to ?
        const decoded = trackingMatch[1]
          .replace(/%2F/g, "/")
          .replace(/%3A/g, ":")
          .replace(/%3D/g, "=")
          .replace(/%3F/g, "?");

        // Validate decoded URL is absolute and valid
        if (isValidAbsoluteUrl(decoded)) {
          url = decoded;
        } else {
          // If decoding failed, skip this URL
          continue;
        }
      } else {
        // Pattern didn't match, skip this URL
        continue;
      }
    }

    // For Substack redirect URLs (used by Elevate, Byte Byte Go, etc.)
    // Format: https://substack.com/redirect/2/eyJlIjoiaHR0cHM6Ly...
    // The base64 payload contains JSON with "e" field = destination URL
    if (rawUrl.includes("substack.com/redirect/2/")) {
      const base64Match = rawUrl.match(/substack\.com\/redirect\/2\/([A-Za-z0-9_-]+)/);
      if (base64Match) {
        try {
          // Decode base64 (handle URL-safe base64: replace - with + and _ with /)
          const base64 = base64Match[1].replace(/-/g, "+").replace(/_/g, "/");
          const decoded = Buffer.from(base64, "base64").toString("utf-8");
          const payload = JSON.parse(decoded);
          if (payload.e && typeof payload.e === "string" && isValidAbsoluteUrl(payload.e)) {
            const decodedUrl = payload.e;
            // Check if decoded URL is a subscription page and skip if so
            if (shouldExcludeUrl(decodedUrl)) {
              logger.debug(`Filtered out decoded Substack subscription URL: ${decodedUrl}`);
              continue;
            }
            url = decodedUrl;
          } else {
            // Invalid decoded URL, skip
            continue;
          }
        } catch {
          // Failed to decode, skip this URL
          continue;
        }
      } else {
        // Pattern didn't match, skip
        continue;
      }
    }

    // Check URL validity even if title is empty (for Substack post URLs)
    const normalizedUrl = url.replace(/&amp;/g, "&");

    // Check if it's a Substack URL
    const isSubstackDomain = normalizedUrl.includes(".substack.com/") ||
                             normalizedUrl.includes("substack.com/") ||
                             normalizedUrl.includes("substackcdn.com/");

    // Substack post URLs (like /p/article-slug) are VALID and should be kept
    // But NOT if they're action URLs (restack, app redirects, etc.)
    const isSubstackPost = isSubstackDomain &&
                           normalizedUrl.includes("/p/") &&
                           !normalizedUrl.includes("open.substack.com/") &&
                           !normalizedUrl.includes("action=restack") &&
                           !normalizedUrl.includes("action=share") &&
                           !normalizedUrl.includes("redirect=app-store");

    // CRITICAL: For Substack domains, ONLY accept URLs with /p/ (article posts)
    // Reject all other Substack URLs (home pages, index pages, profile pages)
    if (isSubstackDomain && !normalizedUrl.includes("/p/")) {
      logger.debug(`Filtered out Substack non-article URL (missing /p/): ${normalizedUrl}`);
      continue; // Skip this URL - it's not an article
    }

    // These are internal Substack pages that should be filtered
    const isSubstackInternal = isSubstackDomain && !isSubstackPost && (
      normalizedUrl.includes("/subscribe") ||
      normalizedUrl.includes("/app-link/") ||
      normalizedUrl.includes("submitLike=") ||
      normalizedUrl.includes("comments=true") ||
      normalizedUrl.includes("action=share") ||
      normalizedUrl.includes("action=restack") ||
      normalizedUrl.includes("/action/disable_email") ||
      normalizedUrl.includes("redirect=app-store") ||
      normalizedUrl.includes("open.substack.com/") ||
      normalizedUrl.includes("eotrx.substackcdn.com/") ||
      normalizedUrl.includes("substackcdn.com/open")
    );

    // Skip undecoded Substack redirect URLs (they should have been decoded above)
    const isUndecodedSubstackRedirect = url.includes("substack.com/redirect/");

    // For Substack posts without title, extract title from URL slug
    let effectiveTitle = title;
    if (isSubstackPost && (!title || title.length < 3)) {
      // Extract slug from URL like .../p/the-sequence-radar-775-last-week
      const slugMatch = normalizedUrl.match(/\/p\/([^?#]+)/);
      if (slugMatch) {
        // Convert slug to title: the-sequence-radar-775 -> The Sequence Radar 775
        effectiveTitle = slugMatch[1]
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }

    // Validate URL before adding to articles
    if (effectiveTitle && url && isValidAbsoluteUrl(url) && !seen.has(url)) {
      const trimmedTitle = effectiveTitle.trim();
      const trimmedUrl = url.trim();

      if (
        !trimmedUrl.includes("inoreader.com") &&
        !trimmedUrl.includes("google.com/reader") &&
        !trimmedUrl.startsWith("javascript:") &&
        !isSubstackInternal &&
        !isUndecodedSubstackRedirect &&
        !shouldExcludeUrl(trimmedUrl) &&
        !shouldExcludeTitle(trimmedTitle)
      ) {
        articles.push({
          title: trimmedTitle,
          url: trimmedUrl,
          snippet: trimmedTitle,
        });
        seen.add(trimmedUrl);
      }
    }
  }

  // Pattern 3: Raw URLs on their own lines preceded by text (common in email newsletters)
  const urlOnlyRegex = /^(\d+\.\s+)?(.+?)(?:\s*[-–]|\s+)?(https?:\/\/[^\s<>"]+)/gm;
  while ((match = urlOnlyRegex.exec(cleanHtml)) !== null) {
    const [, , title, url] = match;

    if (title && url && !seen.has(url)) {
      // Skip Substack redirect/internal URLs (already handled above)
      const normalizedUrl = url.replace(/&amp;/g, "&");
      const isSubstackDomain = normalizedUrl.includes("substack.com/") ||
                                normalizedUrl.includes("substackcdn.com/");

      // CRITICAL: For Substack domains, ONLY accept URLs with /p/ (article posts)
      // Reject all other Substack URLs (home pages, index pages, profile pages)
      if (isSubstackDomain && !normalizedUrl.includes("/p/")) {
        logger.debug(`Pattern 3: Filtered out Substack non-article URL (missing /p/): ${normalizedUrl}`);
        continue; // Skip this URL - it's not an article
      }

      const isSubstackPost = isSubstackDomain &&
                              normalizedUrl.includes("/p/") &&
                              !normalizedUrl.includes("open.substack.com/") &&
                              !normalizedUrl.includes("action=restack") &&
                              !normalizedUrl.includes("action=share") &&
                              !normalizedUrl.includes("redirect=app-store");
      const isSubstackInternal = isSubstackDomain && !isSubstackPost && (
        normalizedUrl.includes("/redirect/") ||
        normalizedUrl.includes("/app-link/") ||
        normalizedUrl.includes("/subscribe") ||
        normalizedUrl.includes("substackcdn.com/open") ||
        normalizedUrl.includes("open.substack.com/")
      );

      const trimmedTitle = title.trim();
      const trimmedUrl = url.trim();

      // Skip certain URLs and very long titles (likely not real)
      if (
        isValidAbsoluteUrl(trimmedUrl) &&
        !trimmedUrl.includes("inoreader.com") &&
        !trimmedUrl.includes("google.com/reader") &&
        !trimmedUrl.includes("tracking.tldrnewsletter") &&
        !trimmedUrl.startsWith("javascript:") &&
        !isSubstackInternal &&
        trimmedTitle.length < 200 &&
        !shouldExcludeUrl(trimmedUrl) &&
        !shouldExcludeTitle(trimmedTitle) &&
        !seen.has(trimmedUrl)
      ) {
        articles.push({
          title: trimmedTitle,
          url: trimmedUrl,
          snippet: trimmedTitle,
        });
        seen.add(trimmedUrl);
      }
    }
  }

  // Pattern 4: Newsletter headers with titles like "Title — Source" followed by description
  // and then a URL somewhere nearby in the content
  // Example: "My LLM coding workflow going into 2026 — Elevate\nDescription text\nhttps://example.com"
  const headerPattern = /^([^\n—\-]{10,150})\s+(?:—|-)\s+([A-Za-z\s]+?)(?:\n|$)/gm;
  while ((match = headerPattern.exec(cleanHtml)) !== null) {
    const [fullMatch, titleText] = match;
    if (!titleText || titleText.length < 5) continue;

    const title = titleText.trim();

    // Skip if we've already found this title with a URL
    if (seen.has(title)) continue;

    // Look for a URL near this header (within next 500 chars)
    const matchIndex = match.index! + fullMatch.length;
    const nearbyUrl = findUrlNearby(matchIndex, 500);

    const normalizedUrl = nearbyUrl ? nearbyUrl.replace(/&amp;/g, "&").trim() : null;

    if (normalizedUrl && isValidAbsoluteUrl(normalizedUrl) && !seen.has(normalizedUrl)) {
      // CRITICAL: For Substack domains, ONLY accept URLs with /p/ (article posts)
      // Reject all other Substack URLs (home pages, index pages, profile pages)
      if ((normalizedUrl.includes('.substack.com') || normalizedUrl.includes('substack.com/')) && !normalizedUrl.includes('/p/')) {
        logger.debug(`Pattern 4: Filtered out Substack non-article URL (missing /p/): ${normalizedUrl}`);
        continue; // Skip this URL - it's not an article
      }

      // Validate the URL
      if (
        !normalizedUrl.includes("inoreader.com") &&
        !normalizedUrl.includes("google.com/reader") &&
        !normalizedUrl.startsWith("javascript:") &&
        !normalizedUrl.includes("tracking.tldrnewsletter") &&
        !shouldExcludeUrl(normalizedUrl)
      ) {
        articles.push({
          title: title.trim(),
          url: normalizedUrl,
          snippet: title.trim(),
        });
        seen.add(normalizedUrl);
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
  // Validate article URL - must be absolute and valid
  let finalUrl = article.url?.trim() || "";

  // Validate URL is absolute (http/https) and valid
  if (!isValidAbsoluteUrl(finalUrl) || finalUrl.includes("inoreader.com")) {
    // Try to find any URL in the base item's full text that might be the article
    const htmlContent = baseItem.fullText || baseItem.summary || "";
    const urlMatch = htmlContent.match(/https?:\/\/[^\s<>"'\)]+/);
    if (urlMatch) {
      const candidateUrl = urlMatch[0];
      if (
        isValidAbsoluteUrl(candidateUrl) &&
        !candidateUrl.includes("inoreader.com") &&
        !candidateUrl.includes("tracking.tldrnewsletter") &&
        !shouldExcludeUrl(candidateUrl)
      ) {
        finalUrl = candidateUrl;
        logger.info(`Extracted fallback URL for article "${article.title}": ${finalUrl}`);
      }
    }
  }

  // If still no valid URL, use the base item's URL as last resort (but log warning)
  if (!isValidAbsoluteUrl(finalUrl)) {
    logger.warn(`No valid URL found for article "${article.title}", using base item URL: ${baseItem.url}`);
    finalUrl = baseItem.url || "";
  }

  return {
    // Keep base item properties but with article-specific data
    id: `${baseItem.id}-article-${articleIndex}`,
    streamId: baseItem.streamId,
    sourceTitle: baseItem.sourceTitle, // Keep original source (TLDR, etc.)
    title: article.title,
    url: finalUrl,
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
    logger.warn(`No articles extracted from newsletter: "${item.title}" (${htmlContent.length} chars of content)`);

    // Check if the original item itself should be excluded (subscription page, etc.)
    if (shouldExcludeUrl(item.url) || shouldExcludeTitle(item.title)) {
      logger.info(`Excluding newsletter item as subscription/promotional content: "${item.title}"`);
      return []; // Return empty array to exclude this item
    }

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
  logger.info(`[DECOMPOSE_DEBUG] Article URLs extracted: ${articles.slice(0, 3).map(a => a.url).join(" | ")}`);

  const decomposed = articles.map((article, idx) =>
    createArticleItem(item, article, idx + 1, articles.length)
  );

  logger.info(`[DECOMPOSE_DEBUG] Decomposed item URLs: ${decomposed.slice(0, 3).map(d => d.url).join(" | ")}`);

  return decomposed;
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
