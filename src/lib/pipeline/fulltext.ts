/**
 * Full text fetching and caching
 * Retrieves complete article text from sources for better content generation
 * Supports: web scraping, arXiv, and other sources
 */

import { FeedItem } from "../model";
import { logger } from "../logger";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { extractBibcodeFromUrl } from "../ads/client";

/**
 * Detect if text looks like HTML (tags present) so we can strip before display/ranking
 */
export function looksLikeHtml(text: string): boolean {
  if (!text || text.length < 10) return false;
  return /<[a-zA-Z][^>]*>|<\s*\/\s*[a-zA-Z]+>/.test(text);
}

/**
 * Strip HTML tags and decode entities. Safe to call on any string.
 * Use after extraction or when loading stored full_text that may contain HTML.
 */
export function stripHtmlFromText(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface FullTextResult {
  text: string;
  source: "web_scrape" | "arxiv" | "ads_api" | "web_archive" | "error";
  length: number;
  fetchedAt: Date;
  /** When the original URL redirected to a paywall, this holds the Wayback Machine URL */
  archivedUrl?: string;
}

/**
 * Fetch full text from a URL with retries and timeout
 * Supports HTML pages and PDFs
 */
async function fetchWebPage(url: string): Promise<string> {
  const maxRetries = 3;
  const timeout = 10000; // 10 seconds

  // Check if this is a known problematic URL that won't have extractable content
  const isGoogleNews = isGoogleNewsRedirect(url);
  const isKnownProblematic = isGoogleNews ||
    /podcasters\.spotify\.com/i.test(url) ||
    /cursor-changelog\.com\/versions/i.test(url);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Code Intelligence Digest)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Detect paywall/membership redirects: the server returned 200 but
      // the final URL (after following 3xx redirects) is a sign-up gate.
      const finalUrl = response.url;
      if (finalUrl !== url && isPaywallUrl(finalUrl)) {
        logger.info(
          `Paywall redirect detected: ${url.substring(0, 80)} -> ${finalUrl}`
        );
        throw new Error(`Redirected to paywall page: ${finalUrl}`);
      }

      const html = await response.text();

      // Extract text from HTML (enhanced with Readability, fallback to basic)
      const text = await extractTextFromHTML(html, url);

      if (text.length < 100) {
        // For known problematic URLs, this is expected - don't retry
        if (isKnownProblematic) {
          logger.debug(`URL has no extractable content (expected): ${url.substring(0, 80)}...`);
          throw new Error("No extractable content (expected for this URL type)");
        }
        throw new Error("Extracted text too short");
      }

      logger.info(`Fetched full text from ${url} (${text.length} chars)`);
      return text;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // For known problematic URLs, use debug level instead of warn
      if (isKnownProblematic && errorMsg.includes("expected")) {
        // Don't log warnings for expected failures - they're not real errors
        if (attempt === 1) {
          logger.debug(`Skipping full text extraction for ${url.substring(0, 60)}... (no extractable content)`);
        }
      } else {
        logger.warn(
          `Attempt ${attempt}/${maxRetries} failed for ${url.substring(0, 80)}...: ${errorMsg}`
        );
      }

      // Don't retry known problematic URLs or paywall redirects
      if (isKnownProblematic || errorMsg.includes("Redirected to paywall")) {
        break;
      }

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
      }
    }
  }

  throw new Error(`Failed to fetch ${url} after ${maxRetries} attempts`);
}

/**
 * Extract text from HTML
 * Uses Readability for better extraction, falls back to basic cleaning if Readability fails
 */
async function extractTextFromHTML(html: string, url?: string): Promise<string> {
  // Try Readability first for better extraction (removes nav, ads, sidebars)
  if (url) {
    try {
      // Create a virtual console that suppresses CSS parsing errors
      // We only need text content, not CSS rendering
      const virtualConsole = new VirtualConsole();

      // Suppress CSS parsing errors - they're not critical for text extraction
      virtualConsole.on('error', (error: Error) => {
        const message = error.message || String(error);
        // Filter out CSS parsing errors silently
        if (message.includes('Could not parse CSS stylesheet') ||
            message.includes('css style sheet') ||
            message.includes('CSSStyleSheet')) {
          return; // Suppress CSS parsing errors
        }
        // Log other errors for debugging
        logger.debug('JSDOM error (non-critical):', { error: message });
      });

      const dom = new JSDOM(html, {
        url,
        virtualConsole,
        // Skip resource loading (stylesheets, images, etc.) - faster and avoids CSS errors
        resources: 'usable',
      });

      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (article && article.textContent && article.textContent.length > 200) {
        logger.debug(`Using Readability extraction (${article.textContent.length} chars)`);
        return stripHtmlFromText(article.textContent.trim());
      }
    } catch (error) {
      // Suppress CSS parsing errors - they're not critical for text extraction
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('CSS') || errorMsg.includes('stylesheet')) {
        logger.debug("CSS parsing error (non-critical), using fallback");
      } else {
        logger.debug("Readability extraction failed, using fallback", {
          error: errorMsg
        });
      }
    }
  }

  // Fallback to basic extraction
  const text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    // Remove HTML tags
    .replace(/<[^>]+>/g, " ")
    // Decode HTML entities
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "")
    // Clean up whitespace
    .replace(/\s+/g, " ")
    .trim();

  return stripHtmlFromText(text);
}

/**
 * Fetch README from GitHub repository
 * Converts GitHub repo URLs to raw README.md content
 */
async function fetchFromGitHub(url: string): Promise<string | null> {
  try {
    // Match GitHub repo URLs: https://github.com/owner/repo or https://github.com/owner/repo/tree/branch
    const githubMatch = url.match(/github\.com\/([^\/]+)\/([^\/\?#]+)(?:\/(?:tree|blob)\/([^\/\?#]+))?/);
    if (!githubMatch) {
      return null; // Not a GitHub repo URL
    }

    const [, owner, repo, branchOrPath] = githubMatch;

    // Default branch is usually 'main' or 'master', try both
    const branches = branchOrPath ? [branchOrPath] : ['main', 'master'];

    for (const branch of branches) {
      // Try README.md first (most common)
      const readmeUrls = [
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`,
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/readme.md`,
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/Readme.md`,
      ];

      for (const readmeUrl of readmeUrls) {
        try {
          const response = await fetch(readmeUrl, {
            signal: AbortSignal.timeout(5000),
            headers: {
              "User-Agent": "Mozilla/5.0 (Code Intelligence Digest)",
              "Accept": "text/plain,text/markdown,*/*",
            },
          });

          if (response.ok) {
            const text = await response.text();
            if (text && text.length > 100) {
              logger.info(`Fetched GitHub README from ${readmeUrl} (${text.length} chars)`);
              return text;
            }
          }
        } catch (err) {
          // Try next URL
          continue;
        }
      }
    }

    return null; // No README found
  } catch (error) {
    logger.debug("GitHub README fetch failed", { error });
    return null;
  }
}

/**
 * Fetch article content from the Wayback Machine (Internet Archive)
 * Used as a fallback when the original URL redirects to a paywall/membership page.
 * Returns { text, archiveUrl } or null if no snapshot exists.
 */
async function fetchFromWebArchive(
  url: string
): Promise<{ text: string; archiveUrl: string } | null> {
  try {
    // 1. Check availability via the Wayback API
    const availabilityUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const availResp = await fetch(availabilityUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (Code Intelligence Digest)" },
    });

    if (!availResp.ok) {
      logger.debug(`Wayback availability check failed: HTTP ${availResp.status}`);
      return null;
    }

    const availData = (await availResp.json()) as {
      archived_snapshots?: {
        closest?: { available?: boolean; url?: string; status?: string };
      };
    };

    const snapshot = availData.archived_snapshots?.closest;
    if (!snapshot?.available || !snapshot.url || snapshot.status !== "200") {
      logger.debug(`No Wayback snapshot for ${url.substring(0, 80)}`);
      return null;
    }

    const archiveUrl = snapshot.url;

    // 2. Fetch the archived page
    const pageResp = await fetch(archiveUrl, {
      signal: AbortSignal.timeout(12000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Code Intelligence Digest)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
    });

    if (!pageResp.ok) {
      logger.debug(`Wayback page fetch failed: HTTP ${pageResp.status}`);
      return null;
    }

    const html = await pageResp.text();
    const text = await extractTextFromHTML(html, archiveUrl);

    if (text.length < 200) {
      logger.debug(`Wayback content too short (${text.length} chars) for ${url.substring(0, 80)}`);
      return null;
    }

    logger.info(
      `Fetched article from Wayback Machine: ${url.substring(0, 80)} -> ${archiveUrl} (${text.length} chars)`
    );
    return { text, archiveUrl };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.debug(`Wayback Machine fetch failed for ${url.substring(0, 80)}: ${msg}`);
    return null;
  }
}

/**
 * Fetch from arXiv API (for research papers)
 * Only works if URL contains arxiv ID
 */
async function fetchFromArxiv(url: string): Promise<string> {
  // Try to extract arXiv ID from URL
  const arxivMatch = url.match(/(?:arxiv\.org|arxiv)(?:.*?)(\d{4}\.\d{4,5})/);
  if (!arxivMatch) {
    throw new Error("Not an arXiv URL");
  }

  const arxivId = arxivMatch[1];

  try {
    // Try fetching from arXiv API
    const apiUrl = `http://export.arxiv.org/api/query?id_list=${arxivId}&max_results=1`;
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
      throw new Error(`arXiv API returned ${response.status}`);
    }

    const xml = await response.text();

    // Extract summary from XML (basic parsing)
    const summaryMatch = xml.match(/<summary[^>]*>([^<]+)<\/summary>/);
    if (!summaryMatch) {
      throw new Error("No summary in arXiv response");
    }

    const summary = summaryMatch[1]
      .trim()
      .replace(/\s+/g, " ");

    logger.info(`Fetched arXiv summary for ${arxivId} (${summary.length} chars)`);
    return summary;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to fetch from arXiv: ${errorMsg}`);
    throw error;
  }
}

/**
 * Get full text from ADS papers database if available
 * Checks by bibcode (from ADS URL) or arXiv URL
 */
async function getFullTextFromADS(url: string): Promise<string | null> {
  try {
    const { detectDriver, getDbClient } = await import("../db/driver");

    // Extract bibcode from URL (works for ADS URLs)
    const bibcode = extractBibcodeFromUrl(url);

    if (bibcode) {
      // Try to get by bibcode
      

        const client = await getDbClient();
        const result = await client.query(
          'SELECT body FROM ads_papers WHERE bibcode = $1 AND body IS NOT NULL AND LENGTH(body) >= 100 LIMIT 1',
          [bibcode]
        );
        if (result.rows.length > 0) {
          const body = (result.rows[0] as { body: string }).body;
          if (body && body.length >= 100) {
            logger.debug(`Found ADS body for bibcode ${bibcode} (${body.length} chars)`);
            return body;
          }
        }
      

    }

    // If URL is arXiv, try to find by arxiv_url
    if (url.includes("arxiv.org")) {
      const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/);
      if (arxivMatch) {
        const arxivId = arxivMatch[1];
        const arxivUrl = `https://arxiv.org/abs/${arxivId}`;

        

          const client = await getDbClient();
          const result = await client.query(
            'SELECT body FROM ads_papers WHERE arxiv_url = $1 AND body IS NOT NULL AND LENGTH(body) >= 100 LIMIT 1',
            [arxivUrl]
          );
          if (result.rows.length > 0) {
            const body = (result.rows[0] as { body: string }).body;
            if (body && body.length >= 100) {
              logger.debug(`Found ADS body for arXiv ${arxivId} (${body.length} chars)`);
              return body;
            }
          }
        

      }
    }

    return null;
  } catch (error) {
    logger.debug('Failed to get full text from ADS', { error });
    return null;
  }
}

/**
 * Check if URL is a Google News RSS redirect (not a real article URL)
 * These redirect pages don't contain extractable content
 */
function isGoogleNewsRedirect(url: string): boolean {
  return /news\.google\.com\/rss\/articles\//i.test(url);
}

/**
 * Paywall / gate path segments that indicate a URL is a sign-up wall, not an article.
 * Shared across static pre-checks and post-redirect detection.
 */
const PAYWALL_PATH_PATTERNS = [
  '/subscribe',
  '/signup',
  '/sign-up',
  '/membership',
  '/join',
  '/pricing',
  '/login',
  '/sign-in',
  '/register',
  '/paywall',
  '/premium',
];

/**
 * Check if a URL points to a paywall / membership gate
 */
function isPaywallUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return PAYWALL_PATH_PATTERNS.some(path => lower.includes(path));
}

/**
 * Check if URL is likely to have extractable content
 */
function isLikelyExtractable(url: string): boolean {
  // Skip known redirect/aggregator URLs that don't have extractable content
  const skipPatterns = [
    /news\.google\.com\/rss\/articles\//i, // Google News RSS redirects
    /podcasters\.spotify\.com/i, // Spotify podcast pages (no transcript)
    /cursor-changelog\.com\/versions\//i, // Changelog index pages
  ];

  return !skipPatterns.some(pattern => pattern.test(url));
}

/**
 * Decode tracking URLs to get the actual destination
 * Handles Substack redirects, ConvertKit, Beehiiv, etc.
 */
function decodeTrackingUrl(url: string): string {
  // Substack redirect: https://substack.com/redirect/2/BASE64_JSON
  if (url.includes('substack.com/redirect/')) {
    const base64Match = url.match(/substack\.com\/redirect\/\d+\/([A-Za-z0-9_-]+)/);
    if (base64Match) {
      try {
        const base64 = base64Match[1].replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(base64, 'base64').toString('utf-8');
        const payload = JSON.parse(decoded);
        if (payload.e && typeof payload.e === 'string') {
          logger.debug(`Decoded Substack redirect URL: ${payload.e}`);
          return payload.e;
        }
      } catch { /* ignore decode errors */ }
    }
  }

  // ConvertKit: https://xxx.click.convertkit-mail2.com/.../BASE64_ENCODED_URL
  if (url.includes('convertkit-mail') || url.includes('convertkit.com')) {
    const parts = url.split('/');
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.length > 20) {
      try {
        const decoded = Buffer.from(lastPart, 'base64').toString('utf-8');
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          logger.debug(`Decoded ConvertKit URL: ${decoded}`);
          return decoded;
        }
      } catch { /* ignore decode errors */ }
    }
  }

  return url;
}

/**
 * Extract actual article URL from subscribe/redirect pages
 * If URL points to a subscribe page with a next/redirect param, extract the article URL
 */
function extractArticleUrl(url: string): string {
  // First decode any tracking wrapper
  const decodedUrl = decodeTrackingUrl(url);

  // Check if it's a subscribe page with a next/redirect param
  try {
    const urlObj = new URL(decodedUrl);
    const urlLower = decodedUrl.toLowerCase();

    // Check for subscription paths
    const isSubscribePage = isPaywallUrl(decodedUrl);

    if (isSubscribePage) {
      // Try to extract article URL from redirect params
      const redirectParams = ['next', 'redirect', 'url', 'return', 'return_to', 'redirect_uri', 'continue'];
      for (const param of redirectParams) {
        const redirectUrl = urlObj.searchParams.get(param);
        if (redirectUrl) {
          try {
            const redirectDecoded = decodeURIComponent(redirectUrl);
            // Check if it looks like a valid article URL
            if (redirectDecoded.startsWith('http') &&
                (redirectDecoded.includes('/p/') || redirectDecoded.includes('/post/') ||
                 redirectDecoded.includes('/article/') || redirectDecoded.includes('/blog/'))) {
              logger.debug(`Extracted article URL from subscribe page: ${redirectDecoded}`);
              return redirectDecoded;
            }
          } catch { /* ignore decode errors */ }
        }
      }
    }
  } catch { /* ignore URL parse errors */ }

  return decodedUrl;
}

/**
 * Fetch full text from a URL
 * Returns the full text of an article
 * Priority: 1. ADS database, 2. arXiv API, 3. Web scraping
 */
export async function fetchFullText(item: FeedItem): Promise<FullTextResult> {
  // Decode tracking URLs and extract actual article URL
  const originalUrl = item.url;
  const url = extractArticleUrl(originalUrl);

  if (url !== originalUrl) {
    logger.info(`Decoded URL for fulltext: ${originalUrl.substring(0, 60)}... -> ${url}`);
  }

  // CRITICAL: Skip Inoreader URLs - they don't contain extractable article content
  if (url.includes("inoreader.com")) {
    logger.warn(`Skipping full text extraction for Inoreader URL: ${url} (item: ${item.title})`);
    return {
      text: "",
      source: "error",
      length: 0,
      fetchedAt: new Date(),
    };
  }

  // Skip URLs that are known to not have extractable content
  if (!isLikelyExtractable(url)) {
    logger.debug(`Skipping full text extraction for redirect/aggregator URL: ${url}`);
    return {
      text: "",
      source: "error",
      length: 0,
      fetchedAt: new Date(),
    };
  }

  // Skip subscription/membership pages that we couldn't extract an article URL from
  if (isPaywallUrl(url)) {
    logger.debug(`Skipping full text extraction for subscription page: ${url}`);
    return {
      text: "",
      source: "error",
      length: 0,
      fetchedAt: new Date(),
    };
  }

  logger.info(`Fetching full text for: ${item.title} (${url})`);

  // Try ADS database first (if available, it's already fetched and stored)
  const adsBody = await getFullTextFromADS(url);
  if (adsBody) {
    const text = looksLikeHtml(adsBody) ? stripHtmlFromText(adsBody) : adsBody;
    return {
      text,
      source: "ads_api", // Full text from ADS API body field
      length: text.length,
      fetchedAt: new Date(),
    };
  }

  // Try GitHub README if URL is a GitHub repository
  if (url.includes("github.com")) {
    try {
      const text = await fetchFromGitHub(url);
      if (text) {
        return {
          text,
          source: "web_scrape", // GitHub README is still web content
          length: text.length,
          fetchedAt: new Date(),
        };
      }
    } catch (error) {
      logger.debug("GitHub README fetch failed, falling back to web scrape");
    }
  }

  // Try arXiv API if URL looks like arXiv
  if (url.includes("arxiv")) {
    try {
      const text = await fetchFromArxiv(url);
      return {
        text,
        source: "arxiv",
        length: text.length,
        fetchedAt: new Date(),
      };
    } catch (error) {
      logger.debug("arXiv fetch failed, falling back to web scrape");
    }
  }

  // Fall back to web scraping
  try {
    let text = await fetchWebPage(url);
    if (looksLikeHtml(text)) {
      text = stripHtmlFromText(text);
    }
    return {
      text,
      source: "web_scrape",
      length: text.length,
      fetchedAt: new Date(),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // If the page redirected to a paywall, try the Wayback Machine
    if (errorMsg.includes("Redirected to paywall")) {
      logger.info(`Trying Wayback Machine for paywalled article: ${url.substring(0, 80)}`);
      const archived = await fetchFromWebArchive(url);
      if (archived) {
        let text = archived.text;
        if (looksLikeHtml(text)) {
          text = stripHtmlFromText(text);
        }
        return {
          text,
          source: "web_archive",
          length: text.length,
          fetchedAt: new Date(),
          archivedUrl: archived.archiveUrl,
        };
      }
      logger.warn(`No Wayback snapshot available for paywalled article: ${url.substring(0, 80)}`);
    }

    logger.error(`Failed to fetch full text for ${url}`, { error: errorMsg });

    return {
      text: "",
      source: "error",
      length: 0,
      fetchedAt: new Date(),
    };
  }
}

/**
 * Fetch full text for multiple items in parallel with rate limiting
 * Respects domain rate limits (max 2 requests per second per domain)
 */
export async function fetchFullTextBatch(
  items: FeedItem[],
  maxConcurrent: number = 3
): Promise<Map<string, FullTextResult>> {
  const results = new Map<string, FullTextResult>();
  const domainQueue = new Map<string, number>(); // Track last fetch time per domain

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const fetchWithRateLimit = async (item: FeedItem) => {
    try {
      // Extract domain from URL
      const domain = new URL(item.url).hostname || "unknown";

      // Rate limit: max 1 request per 500ms per domain
      const lastFetch = domainQueue.get(domain) || 0;
      const timeSinceLastFetch = Date.now() - lastFetch;
      if (timeSinceLastFetch < 500) {
        await delay(500 - timeSinceLastFetch);
      }

      domainQueue.set(domain, Date.now());

      const result = await fetchFullText(item);
      results.set(item.id, result);

      if (result.source !== "error") {
        logger.info(`Fetched full text for ${item.id} (${result.length} chars, ${result.source})`);
      }
    } catch (error) {
      logger.error(`Failed to fetch full text for item ${item.id}`, { error });
      results.set(item.id, {
        text: "",
        source: "error",
        length: 0,
        fetchedAt: new Date(),
      });
    }
  };

  // Process in batches to avoid overwhelming
  for (let i = 0; i < items.length; i += maxConcurrent) {
    const batch = items.slice(i, i + maxConcurrent);
    await Promise.all(batch.map(fetchWithRateLimit));
  }

  return results;
}

/**
 * Check if we have cached full text for an item
 * Returns true if full_text is not null and was fetched successfully
 */
export function hasCachedFullText(item: FeedItem & { fullText?: string }): boolean {
  return !!(item.fullText && item.fullText.length > 100);
}

/**
 * Merge full text into items if available
 * Useful for pipeline stages to check if full text is available
 */
export function enrichItemsWithFullText(
  items: FeedItem[],
  fullTextMap: Map<string, FullTextResult>
): (FeedItem & { fullText?: string })[] {
  return items.map(item => {
    const fullTextResult = fullTextMap.get(item.id);
    return {
      ...item,
      fullText: fullTextResult?.source !== "error" ? fullTextResult?.text : undefined,
    };
  });
}
