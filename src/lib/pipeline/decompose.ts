/**
 * Newsletter decomposition
 * Extracts individual articles from email newsletters (TLDR, Pointer, Substack, etc.)
 * and creates separate RankedItem entries for each article
 */

import { RankedItem, FeedItem, Category } from "../model";
import { logger } from "../logger";
import { decodeHtmlEntities } from "../utils/html-entities";

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
  // Substack promotional titles
  /your favorite substacker/i,
  /favorite substacker/i,
  /become a (paid|premium) subscriber/i,
  /upgrade to (paid|premium)/i,
  // Test/debug content
  /^test the code$/i,
  /^test$/i,
  /^debug$/i,
  /^test article$/i,
  /^test post$/i,
  /^test entry$/i,
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
    // Reject subscription/payment pages even if they have /p/
    if (urlLower.includes('/subscribe') || urlLower.includes('/payment') || urlLower.includes('/checkout') || urlLower.includes('/upgrade')) {
      return true; // Reject - subscription/payment page
    }
  }

  // Filter out localhost URLs (invalid/placeholder URLs)
  if (urlLower.includes('localhost') || urlLower.includes('127.0.0.1')) {
    return true; // Reject - localhost URLs are invalid
  }

  // Filter URLs that are just domain roots or homepages (these redirect to main page)
  // Pattern: https://domain.com/ or https://domain.com?params (no path or just query params)
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const hasOnlyRootPath = pathname === '/' || pathname === '';

    // If URL is just the domain root (with or without query params), it's likely a homepage
    if (hasOnlyRootPath) {
      // Allow if it has a hash fragment (might be an anchor link)
      if (!parsed.hash || parsed.hash === '#') {
        return true; // Reject - this is a homepage URL
      }
    }
  } catch {
    // If URL parsing fails, let other checks handle it
  }

  // Filter known newsletter domain homepages that don't have article paths
  // These domains often redirect to subscription pages when accessed without article paths
  const newsletterDomains = [
    'tldr.tech',
    'tldrnewsletter.com',
    'pointer.io',
    'bytebytego.com',
  ];

  // urlLower already declared above, reuse it
  for (const domain of newsletterDomains) {
    if (urlLower.includes(domain)) {
      // Check if URL is just the domain or has minimal path
      const domainPattern = new RegExp(`https?://(www\\.)?${domain.replace(/\./g, '\\.')}/?([?#]|$)`, 'i');
      if (domainPattern.test(url)) {
        return true; // Reject - homepage URL
      }

      // Also reject if path is just common homepage paths
      const homepagePaths = ['/', '/home', '/index', '/welcome', '/start'];
      const pathMatch = url.match(new RegExp(`https?://[^/]+/([^?#]+)`, 'i'));
      if (pathMatch && homepagePaths.includes('/' + pathMatch[1].toLowerCase())) {
        return true; // Reject - homepage path
      }
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
 * Re-categorize a decomposed article based on URL patterns and content
 * Only re-categorizes if the original category is "newsletters" (generic newsletter folder)
 * Otherwise preserves the feed's category from Inoreader folder (ai_news, product_news, etc.)
 */
function recategorizeDecomposedArticle(item: FeedItem): Category {
  // CRITICAL: ALWAYS keep items from newsletter sources in "newsletters" category
  // This check must come FIRST, before any other category logic
  // This ensures they show up in the newsletters view even if they're also relevant to other categories
  // The user expects to see Elevate, Byte Byte Go, TLDR, etc. items in newsletters
  if (isNewsletterSource(item.sourceTitle)) {
    logger.debug(`Keeping "newsletters" category for article "${item.title}" from newsletter source "${item.sourceTitle}"`);
    return "newsletters";
  }

  // If the item is already in a specific category (not "newsletters"), keep it
  // This preserves the category from the Inoreader folder (ai_news, product_news, etc.)
  // BUT only if it's NOT from a newsletter source (checked above)
  if (item.category !== "newsletters") {
    logger.debug(`Keeping original category "${item.category}" for article "${item.title}" (from Inoreader folder)`);
    return item.category;
  }

  // Only re-categorize if it's from a generic "newsletters" folder (not a known newsletter source)
  // Use content-based patterns to determine the correct category
  const url = item.url.toLowerCase();
  const title = (item.title || "").toLowerCase();
  const summary = (item.summary || item.contentSnippet || "").toLowerCase();
  const combinedText = `${title} ${summary}`;

  // REMOVED: TLDR recategorization logic
  // TLDR items should stay in newsletters category, not be moved to ai_news or product_news
  // AI News should only come from the AI Articles feed, not from TLDR newsletters
  // This prevents TLDR articles from appearing in ai_news category

  // AI News patterns
  const aiNewsPatterns = [
    /(openai|anthropic|claude|gpt-4|gpt-3|llama|mistral|gemini|deepmind)/i,
    /(large language model|llm|transformer model|foundation model)/i,
    /(ai model release|model announcement|ai infrastructure)/i,
    /(prompt engineering|fine-tuning|rag|retrieval augmented)/i,
    /(ai coding|ai agent|autonomous agent|agentic)/i,
    /(multimodal ai|vision model|text-to-image)/i,
    /anthropic\.com|openai\.com|deepmind\.com|huggingface\.co/i,
  ];

  // Product News patterns
  const productNewsPatterns = [
    /(release notes|changelog|what's new|version \d+\.\d+)/i,
    /(feature announcement|new feature|product update)/i,
    /(tool release|launch|beta|general availability|ga)/i,
    /(ide|editor|debugger|code review tool|dev tool) (release|update|announcement)/i,
    /(github|gitlab|bitbucket|jira|linear|notion) (release|update|feature)/i,
    /(vscode|vim|emacs|jetbrains|intellij) (release|update)/i,
    /(cursor|copilot|tabnine|codeium) (release|update|feature)/i,
  ];

  // Check for AI News
  for (const pattern of aiNewsPatterns) {
    if (pattern.test(url) || pattern.test(combinedText)) {
      logger.debug(`Re-categorizing article "${item.title}" from newsletters to ai_news based on content`);
      return "ai_news";
    }
  }

  // Check for Product News
  for (const pattern of productNewsPatterns) {
    if (pattern.test(url) || pattern.test(combinedText)) {
      logger.debug(`Re-categorizing article "${item.title}" from newsletters to product_news based on content`);
      return "product_news";
    }
  }

  // Keep original category (newsletters) if no patterns match
  return item.category;
}

/**
 * Extract article links and metadata from newsletter HTML
 * Handles multiple article formats:
 * - Link text followed by description (markdown-style)
 * - HTML links with surrounding text
 * - Numbered list items
 * - Title-then-URL patterns (newsletter articles without explicit links)
 * - Section-aware extraction for TLDR (tracks which section articles belong to)
 */
function extractArticlesFromHtml(html: string): Array<{
  title: string;
  url: string;
  snippet: string;
  section?: string; // Track which section this article came from (for TLDR)
}> {
  const articles: Array<{ title: string; url: string; snippet: string; section?: string }> = [];

  if (!html || html.length === 0) {
    return articles;
  }

  // Clean HTML entities
  const cleanHtml = html
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // Detect TLDR sections and map them to categories
  // Sections appear as headers in the HTML
  const sectionHeaders: Array<{ name: string; index: number; category?: Category }> = [];
  const sectionPatterns = [
    { pattern: /(?:big tech[^<]*&amp;?[^<]*startups?|big tech[^<]*startups?)/i, name: "Big Tech & Startups", category: "ai_news" as Category },
    { pattern: /programming[^<]*(?:&amp;|and)[^<]*(?:design|data science)/i, name: "Programming, Design & Data Science", category: "newsletters" as Category },
    { pattern: /programming[^<]*design/i, name: "Programming & Design", category: "newsletters" as Category },
    { pattern: /science[^<]*(?:&amp;|and)[^<]*futuristic[^<]*technology/i, name: "Science & Futuristic Technology", category: "newsletters" as Category },
    { pattern: /miscellaneous/i, name: "Miscellaneous", category: "newsletters" as Category },
  ];

  // Also look for articles near known terms (Delve, Vibium, Package Manager, Groq, Nvidia)
  // These might not have explicit section headers but are in specific sections
  const knownArticlePatterns = [
    { pattern: /delve[^<]*shipmas/i, name: "Delve", section: "Miscellaneous" },
    { pattern: /vibium[^<]*github/i, name: "Vibium", section: "Programming, Design & Data Science" },
    { pattern: /package manager[^<]*git[^<]*database/i, name: "Package Manager", section: "Programming, Design & Data Science" },
    { pattern: /groq[^<]*ai[^<]*technology/i, name: "Groq", section: "Big Tech & Startups" },
    { pattern: /nvidia[^<]*groq/i, name: "Nvidia/Groq", section: "Big Tech & Startups" },
  ];

  // Find all section headers in the HTML
  for (const { pattern, name, category } of sectionPatterns) {
    const matches = [...cleanHtml.matchAll(new RegExp(pattern.source, 'gi'))];
    for (const match of matches) {
      sectionHeaders.push({
        name,
        index: match.index!,
        category,
      });
    }
  }

  // Sort by position in document
  sectionHeaders.sort((a, b) => a.index - b.index);

  // Helper to find which section an article belongs to based on its position
  function findSectionForIndex(index: number): string | undefined {
    // Find the last section header before this index
    for (let i = sectionHeaders.length - 1; i >= 0; i--) {
      if (sectionHeaders[i].index < index) {
        return sectionHeaders[i].name;
      }
    }
    return undefined;
  }

  // Pattern 1: Markdown-style links [Title](URL)
  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  const seen = new Set<string>();

  while ((match = markdownLinkRegex.exec(cleanHtml)) !== null) {
    const [, title, url] = match;
    const trimmedUrl = url?.trim() || "";

      if (title && trimmedUrl && isValidAbsoluteUrl(trimmedUrl) && !seen.has(trimmedUrl)) {
        const trimmedTitle = decodeHtmlEntities(title.trim()); // Decode HTML entities from extracted title
        // Skip certain URLs and titles
        if (
          !trimmedUrl.includes("inoreader.com") &&
          !trimmedUrl.includes("google.com/reader") &&
          !trimmedUrl.startsWith("javascript:") &&
          !shouldExcludeUrl(trimmedUrl) &&
          !shouldExcludeTitle(trimmedTitle)
        ) {
          const section = findSectionForIndex(match.index!);
          articles.push({
            title: trimmedTitle,
            url: trimmedUrl,
            snippet: trimmedTitle, // Will be enhanced below
            section,
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
  // Modified to handle nested tags like <strong>, <em>, <span>, etc.
  // Use a more robust approach that handles deeply nested tags
  const htmlLinkPattern = /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = htmlLinkPattern.exec(cleanHtml)) !== null) {
    const [, rawUrl, rawTitleHtml] = match;

    // Extract title - prefer text in <strong> tags, then <b>, then any text
    let title = '';

    // First try to find <strong> tag (most common in TLDR)
    const strongMatch = rawTitleHtml.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
    if (strongMatch) {
      title = decodeHtmlEntities(strongMatch[1].replace(/<[^>]*>/g, "").trim());
    } else {
      // Try <b> tag
      const bMatch = rawTitleHtml.match(/<b[^>]*>([\s\S]*?)<\/b>/i);
      if (bMatch) {
        title = decodeHtmlEntities(bMatch[1].replace(/<[^>]*>/g, "").trim());
      } else {
        // Strip all HTML tags and get text
        title = decodeHtmlEntities(rawTitleHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
      }
    }

    // If title is still empty or too short, try to extract from surrounding context
    if (!title || title.length < 5) {
      // Look for text before the link tag
      const beforeLink = cleanHtml.substring(Math.max(0, match.index! - 200), match.index!);
      const textBefore = beforeLink.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const lastSentence = textBefore.split(/[.!?]/).pop()?.trim();
      if (lastSentence && lastSentence.length > 10 && lastSentence.length < 150) {
        title = lastSentence;
      }
    }

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
          // Filter out localhost URLs (these are invalid/placeholder URLs)
          if (decoded.includes('localhost') || decoded.includes('127.0.0.1')) {
            logger.debug(`Filtered out decoded TLDR URL with localhost: ${decoded}`);
            continue;
          }
          // Check if decoded URL is a homepage or should be excluded
          if (shouldExcludeUrl(decoded)) {
            logger.debug(`Filtered out decoded TLDR homepage/subscription URL: ${decoded}`);
            continue;
          }
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
      const trimmedTitle = decodeHtmlEntities(effectiveTitle.trim());
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
        const section = findSectionForIndex(match.index!);
        articles.push({
          title: trimmedTitle,
          url: trimmedUrl,
          snippet: trimmedTitle,
          section,
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

      const trimmedTitle = decodeHtmlEntities(title.trim());
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
        const section = findSectionForIndex(match.index!);
        articles.push({
          title: trimmedTitle,
          url: trimmedUrl,
          snippet: trimmedTitle,
          section,
        });
        seen.add(trimmedUrl);
      }
    }
  }

  // Pattern 4: "Read Online" links (common in Elevate newsletters)
  // Looks for "Read Online" or "read online" text followed by a link, often to turingpost.com
  const readOnlinePattern = /(?:read\s+online|read\s+article)[^<]*<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
  while ((match = readOnlinePattern.exec(cleanHtml)) !== null) {
    const [, url] = match;
    const normalizedUrl = url.replace(/&amp;/g, "&").trim();

    if (normalizedUrl && isValidAbsoluteUrl(normalizedUrl) && !seen.has(normalizedUrl)) {
      // Extract title from nearby text (look for title before "Read Online")
      const beforeMatch = cleanHtml.substring(Math.max(0, match.index! - 200), match.index!);
      const titleMatch = beforeMatch.match(/(?:<h[1-3][^>]*>|<strong[^>]*>|<b[^>]*>|^|\n)([^<\n]{10,150})(?:<\/h[1-3]>|<\/strong>|<\/b>|$|\n)/i);
      const title = titleMatch ? titleMatch[1].trim() : "Article";

      if (!shouldExcludeUrl(normalizedUrl) && !shouldExcludeTitle(title)) {
        const section = findSectionForIndex(match.index!);
        articles.push({
          title: title,
          url: normalizedUrl,
          snippet: title,
          section,
        });
        seen.add(normalizedUrl);
        logger.debug(`Extracted "Read Online" link: ${title} -> ${normalizedUrl}`);
      }
    }
  }

  // Pattern 5: Extract articles by finding known terms and their surrounding context
  // This helps find articles that might not have explicit links but are mentioned in the text
  const knownTerms = [
    { term: 'Delve', patterns: [/delve[^<]*shipmas[^<]*day[^<]*\d+/i, /delve[^<]*sponsor/i] },
    { term: 'Vibium', patterns: [/vibium[^<]*github/i, /vibium[^<]*repo/i] },
    { term: 'Package Manager', patterns: [/package manager[^<]*git[^<]*database/i, /git as a database/i] },
    { term: 'Groq', patterns: [/groq[^<]*ai[^<]*technology/i, /nvidia[^<]*groq/i, /groq[^<]*chip/i] },
    { term: 'NotebookLM', patterns: [/transform sources.*structured.*data tables.*notebooklm/i, /notebooklm.*data tables/i] },
    { term: 'Codex vs Claude', patterns: [/codex.*vs.*claude code/i, /codex vs claude.*today/i] },
    { term: 'Memory: How Agents Learn', patterns: [/memory.*how agents learn/i] },
    { term: 'Stirrup', patterns: [/stirrup[^<]*github/i, /stirrup[^<]*repo/i] },
  ];

  for (const { term, patterns } of knownTerms) {
    for (const pattern of patterns) {
      // matchAll requires global flag
      const globalPattern = new RegExp(pattern.source, pattern.flags + 'g');
      const matches = [...cleanHtml.matchAll(globalPattern)];
      for (const match of matches) {
        const matchIndex = match.index!;
        // Look for URL within 300 chars before or after the match
        const contextStart = Math.max(0, matchIndex - 300);
        const contextEnd = Math.min(cleanHtml.length, matchIndex + match[0].length + 300);
        const context = cleanHtml.substring(contextStart, contextEnd);

        // Look for links in this context
        const linkMatches = context.match(/<a[^>]*href=["']([^"']+)["'][^>]*>/gi);
        if (linkMatches) {
          for (const linkMatch of linkMatches) {
            const urlMatch = linkMatch.match(/href=["']([^"']+)["']/);
            if (urlMatch) {
              let url = urlMatch[1].replace(/&amp;/g, "&").trim();

              // Decode TLDR tracking URLs
              if (url.includes("/CL0/")) {
                const trackingMatch = url.match(/\/CL0\/(.+?)\/\d+\//);
                if (trackingMatch) {
                  const decoded = trackingMatch[1]
                    .replace(/%2F/g, "/")
                    .replace(/%3A/g, ":")
                    .replace(/%3D/g, "=")
                    .replace(/%3F/g, "?");
                  if (isValidAbsoluteUrl(decoded) && !decoded.includes('localhost') && !shouldExcludeUrl(decoded)) {
                    url = decoded;
                  } else {
                    continue;
                  }
                } else {
                  continue;
                }
              }

              if (isValidAbsoluteUrl(url) && !seen.has(url) && !shouldExcludeUrl(url)) {
                // Extract title from context - look for <strong> tags first, then other patterns
                let title = term; // Default to term name
                const strongMatch = context.match(/<strong[^>]*>([^<]{10,200})<\/strong>/i);
                if (strongMatch) {
                  title = decodeHtmlEntities(strongMatch[1].trim());
                } else {
                  // Look for title patterns near the link
                  const titlePatterns = [
                    /([A-Z][^<]{10,150}(?:\([^)]+\))?)\s*(?:\([^)]+\))?\s*<a[^>]*href/i, // Title before link
                    /<a[^>]*href[^>]*>([^<]{10,150})<\/a>/i, // Title in link
                  ];
                  for (const pattern of titlePatterns) {
                    const match = context.match(pattern);
                    if (match && match[1]) {
                      title = decodeHtmlEntities(match[1].trim());
                      break;
                    }
                  }
                }

                const section = findSectionForIndex(matchIndex);

                if (!shouldExcludeTitle(title)) {
                  articles.push({
                    title: title,
                    url: url,
                    snippet: title,
                    section,
                  });
                  seen.add(url);
                  logger.debug(`Extracted article by known term "${term}": ${title} -> ${url}`);
                }
              }
            }
          }
        }
      }
    }
  }

  // Pattern 6: Newsletter headers with titles like "Title — Source" followed by description
  // and then a URL somewhere nearby in the content
  // Example: "My LLM coding workflow going into 2026 — Elevate\nDescription text\nhttps://example.com"
  const headerPattern = /^([^\n—\-]{10,150})\s+(?:—|-)\s+([A-Za-z\s]+?)(?:\n|$)/gm;
  while ((match = headerPattern.exec(cleanHtml)) !== null) {
    const [fullMatch, titleText] = match;
    if (!titleText || titleText.length < 5) continue;

    const title = decodeHtmlEntities(titleText.trim());

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
        logger.debug(`Pattern 6: Filtered out Substack non-article URL (missing /p/): ${normalizedUrl}`);
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
        const section = findSectionForIndex(match.index!);
        articles.push({
          title: title.trim(),
          url: normalizedUrl,
          snippet: title.trim(),
          section,
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
  article: { title: string; url: string; snippet: string; section?: string },
  articleIndex: number,
  totalArticles: number
): RankedItem {
  // Validate article URL - must be absolute and valid
  let finalUrl = article.url?.trim() || "";

  // Reject if URL is empty or invalid from the start
  if (!finalUrl || !isValidAbsoluteUrl(finalUrl)) {
    logger.debug(`Article "${article.title}" has empty or invalid URL: "${finalUrl}"`);
    finalUrl = ""; // Clear it so we try to find a better URL
  }

  // Filter out localhost URLs immediately
  if (finalUrl && (finalUrl.includes("localhost") || finalUrl.includes("127.0.0.1"))) {
    logger.debug(`Filtered out localhost URL for article "${article.title}": ${finalUrl}`);
    finalUrl = ""; // Clear it so we try to find a better URL
  }

  // Validate URL is absolute (http/https) and valid
  if (!finalUrl || !isValidAbsoluteUrl(finalUrl) || finalUrl.includes("inoreader.com")) {
    // Try to find any URL in the base item's full text that might be the article
    const htmlContent = baseItem.fullText || baseItem.summary || "";
    const urlMatch = htmlContent.match(/https?:\/\/[^\s<>"'\)]+/);
    if (urlMatch) {
      const candidateUrl = urlMatch[0];
      if (
        isValidAbsoluteUrl(candidateUrl) &&
        !candidateUrl.includes("inoreader.com") &&
        !candidateUrl.includes("tracking.tldrnewsletter") &&
        !candidateUrl.includes("localhost") &&
        !candidateUrl.includes("127.0.0.1") &&
        !shouldExcludeUrl(candidateUrl)
      ) {
        finalUrl = candidateUrl;
        logger.info(`Extracted fallback URL for article "${article.title}": ${finalUrl}`);
      }
    }
  }

  // If still no valid URL, use the base item's URL as last resort (but log warning)
  // But only if it's not a localhost URL and not a subscription page
  if (!finalUrl || !isValidAbsoluteUrl(finalUrl) || finalUrl.includes("localhost") || finalUrl.includes("127.0.0.1")) {
    if (baseItem.url &&
        !baseItem.url.includes("localhost") &&
        !baseItem.url.includes("127.0.0.1") &&
        !baseItem.url.includes("inoreader.com") &&
        isValidAbsoluteUrl(baseItem.url) &&
        !shouldExcludeUrl(baseItem.url)) {
      logger.warn(`No valid URL found for article "${article.title}", using base item URL: ${baseItem.url}`);
      finalUrl = baseItem.url;
    } else {
      logger.warn(`No valid URL found for article "${article.title}", skipping (base URL is invalid or excluded: ${baseItem.url})`);
      finalUrl = ""; // Empty URL - item will be filtered out
    }
  }

  // Final validation: if URL is still empty or invalid, return null (caller should skip)
  if (!finalUrl || !isValidAbsoluteUrl(finalUrl)) {
    logger.warn(`Article "${article.title}" has no valid URL after all attempts, will be skipped`);
    // Return a placeholder item that will be filtered out by rank.ts
    return {
      ...baseItem,
      id: `${baseItem.id}-article-${articleIndex}-invalid`,
      title: article.title,
      url: "", // Empty URL will be filtered
    };
  }

  return {
    // Keep base item properties but with article-specific data
    id: `${baseItem.id}-article-${articleIndex}`,
    streamId: baseItem.streamId,
    sourceTitle: baseItem.sourceTitle, // Keep original source (TLDR, etc.)
    title: article.title,
    url: finalUrl,
    author: baseItem.author,
    publishedAt: baseItem.publishedAt, // Inherit newsletter's Inoreader received date, not article's original publication date
    createdAt: baseItem.createdAt, // Inherit newsletter's createdAt (when Inoreader received it)

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
    const article = articles[0];

    // Validate the article URL before returning
    if (!article.url || !isValidAbsoluteUrl(article.url) || shouldExcludeUrl(article.url)) {
      logger.debug(`Filtering out single article with invalid/excluded URL: "${article.title}" (URL: "${article.url}")`);
      // Check if the original item itself should be excluded
      if (shouldExcludeUrl(item.url) || shouldExcludeTitle(item.title)) {
        logger.info(`Excluding newsletter item as subscription/promotional content: "${item.title}"`);
        return []; // Return empty array to exclude this item
      }
      return [item]; // Fallback: return original item
    }

    logger.info(`Single article found in ${item.sourceTitle}: "${article.title}"`);
    return [
      {
        ...item,
        title: article.title,
        url: article.url,
        summary: article.snippet,
        contentSnippet: article.snippet.substring(0, 500),
      },
    ];
  }

  // Multiple articles: create separate items for each
  logger.info(`Decomposing ${item.sourceTitle} into ${articles.length} articles`);
  logger.info(`[DECOMPOSE_DEBUG] Article URLs extracted: ${articles.slice(0, 3).map(a => a.url).join(" | ")}`);

  const decomposed = articles
    .map((article, idx) =>
      createArticleItem(item, article, idx + 1, articles.length)
    )
    .filter(decomposedItem => {
      // Filter out items with empty or invalid URLs
      if (!decomposedItem.url || !isValidAbsoluteUrl(decomposedItem.url)) {
        logger.debug(`Filtering out decomposed item with invalid URL: "${decomposedItem.title}" (URL: "${decomposedItem.url}")`);
        return false;
      }
      // Also check if URL should be excluded (subscription pages, etc.)
      if (shouldExcludeUrl(decomposedItem.url)) {
        logger.debug(`Filtering out decomposed item with excluded URL: "${decomposedItem.title}" (URL: "${decomposedItem.url}")`);
        return false;
      }
      return true;
    });

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

/**
 * Decompose a FeedItem (used during sync, before ranking)
 * Returns array of FeedItems - one per extracted article, or original item if not decomposable
 */
export function decomposeFeedItem(item: FeedItem): FeedItem[] {
  // Only decompose known newsletter sources
  if (!isNewsletterSource(item.sourceTitle)) {
    return [item];
  }

  // Skip items that are already decomposed (have -article- in ID) or are clearly not newsletters
  if (item.id.includes('-article-')) {
    return [item];
  }

  // Filter out items with very short content (likely already decomposed or promotional)
  const htmlContent = item.fullText || item.summary || item.contentSnippet || "";
  if (!htmlContent || htmlContent.length < 100) {
    // Check if it's a promotional/unsubscribe item that should be excluded
    if (shouldExcludeTitle(item.title) || shouldExcludeUrl(item.url)) {
      logger.debug(`Excluding short newsletter item: "${item.title}"`);
      return [];
    }
    logger.warn(`Newsletter item "${item.title}" has no content to decompose (${htmlContent.length} chars)`);
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
    const article = articles[0];

    // Validate the article URL before returning
    if (!article.url || !isValidAbsoluteUrl(article.url) || shouldExcludeUrl(article.url)) {
      logger.debug(`Filtering out single article with invalid/excluded URL: "${article.title}" (URL: "${article.url}")`);
      // Check if the original item itself should be excluded
      if (shouldExcludeUrl(item.url) || shouldExcludeTitle(item.title)) {
        logger.info(`Excluding newsletter item as subscription/promotional content: "${item.title}"`);
        return []; // Return empty array to exclude this item
      }
      return [item]; // Fallback: return original item
    }

    logger.info(`Single article found in ${item.sourceTitle}: "${article.title}"`);
    // Store section information in summary for later categorization
    const sectionInfo = article.section ? ` [SECTION:${article.section}]` : "";
    const summaryWithSection = article.snippet + sectionInfo;

    const decomposedItem: FeedItem = {
      ...item,
      title: article.title,
      url: article.url,
      summary: summaryWithSection,
      contentSnippet: summaryWithSection.substring(0, 500),
      category: item.category, // Will be re-categorized below
      // publishedAt is inherited from item (newsletter's Inoreader received date)
      // This ensures articles use the newsletter date, not the original article publication date
    };

    // Re-categorize based on content/URL patterns and section information
    decomposedItem.category = recategorizeDecomposedArticle(decomposedItem);

    return [decomposedItem];
  }

  // Multiple articles: create separate FeedItems for each
  logger.info(`Decomposing ${item.sourceTitle} into ${articles.length} articles`);
  logger.info(`[DECOMPOSE_DEBUG] Article URLs extracted: ${articles.slice(0, 3).map(a => a.url).join(" | ")}`);

  const decomposed: FeedItem[] = [];

  for (const [idx, article] of articles.entries()) {
    // Validate article URL
    let finalUrl = article.url?.trim() || "";

    if (!finalUrl || !isValidAbsoluteUrl(finalUrl)) {
      logger.debug(`Article "${article.title}" has empty or invalid URL: "${finalUrl}"`);
      // Try to find URL in the item's content
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

    // Final validation
    if (!finalUrl || !isValidAbsoluteUrl(finalUrl) || shouldExcludeUrl(finalUrl)) {
      logger.debug(`Skipping article "${article.title}" - no valid URL`);
      continue;
    }

    // Store section information in summary for later categorization
    const sectionInfo = article.section ? ` [SECTION:${article.section}]` : "";
    const summaryWithSection = (article.snippet || item.summary || "") + sectionInfo;

    const decomposedItem: FeedItem = {
      ...item,
      id: `${item.id}-article-${idx + 1}`,
      title: article.title,
      url: finalUrl,
      summary: summaryWithSection,
      contentSnippet: summaryWithSection.substring(0, 500),
      category: item.category, // Will be re-categorized below
      // publishedAt is inherited from item (newsletter's Inoreader received date)
      // This ensures articles use the newsletter date, not the original article publication date
    };

    // Re-categorize based on content/URL patterns and section information
    decomposedItem.category = recategorizeDecomposedArticle(decomposedItem);

    decomposed.push(decomposedItem);
  }

  logger.info(`[DECOMPOSE_DEBUG] Decomposed ${decomposed.length} valid articles from ${articles.length} extracted`);

  return decomposed;
}

/**
 * Decompose all newsletter FeedItems in a batch (used during sync)
 * Returns flattened array with newsletter items replaced by their constituent articles
 */
export function decomposeFeedItems(items: FeedItem[]): FeedItem[] {
  const result: FeedItem[] = [];

  for (const item of items) {
    if (isNewsletterSource(item.sourceTitle)) {
      const decomposed = decomposeFeedItem(item);
      result.push(...decomposed);
    } else {
      result.push(item);
    }
  }

  logger.info(
    `Decomposed ${items.length} FeedItems into ${result.length} FeedItems ` +
    `(${result.length - items.length > 0 ? "+" : ""}${result.length - items.length} from newsletters)`
  );

  return result;
}
