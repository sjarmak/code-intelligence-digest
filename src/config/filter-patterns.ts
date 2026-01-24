/**
 * Content filter patterns
 *
 * Consolidated patterns for filtering low-quality content items.
 * These patterns are used to exclude:
 * - Meta/admin pages (advertise, privacy, unsubscribe, etc.)
 * - Newsletter collection/digest aggregator pages
 * - Social media discussion threads (not primary sources)
 * - Tracking/redirect URLs
 * - Generic promotional content
 */

import type { FeedItem } from "@/src/lib/model";

/** Minimum title length required for content to pass filtering */
const MIN_TITLE_LENGTH = 10;

/**
 * Bad URL patterns - URLs matching these should be excluded
 *
 * Categories:
 * 1. Newsletter collection/digest pages
 * 2. Meta/admin pages (advertise, privacy, terms, etc.)
 * 3. Account management pages (unsubscribe, settings, etc.)
 * 4. Social aggregators (Reddit discussions, not external links)
 * 5. Tracking/redirect URLs
 * 6. Known digest collection domains
 */
export const BAD_URL_PATTERNS: readonly RegExp[] = [
  // =====================================
  // Newsletter collection/digest pages
  // =====================================
  /** Newsletter index pages with or without trailing slash/params */
  /\/newsletters?(?:[/?#]|$)/i,
  /** Issue archive/collection pages */
  /\/issues?(?:[/?#]|$)/i,
  /** Archive/historical content pages */
  /\/archive(?:[/?#]|$)/i,

  // =====================================
  // Meta/admin pages
  // =====================================
  /** Advertising and sponsorship pages */
  /\/(advertise|sponsor|advertising|partnership|ad-?service|advert|commerci)(?:[/?#]|$)/i,
  /** Legal and policy pages */
  /\/(privacy|terms|policies|legal|disclaimer)(?:[/?#]|$)/i,
  /** About and contact pages */
  /\/(media-kit|press|about|contact|info|help)(?:[/?#]|$)/i,
  /** Feed and subscription pages */
  /\/(feeds?|rss|subscribe|signup|join|register|login|sign-?in)(?:[/?#]|$)/i,

  // =====================================
  // Account management pages
  // =====================================
  /** Unsubscribe and preference management */
  /\/(unsubscribe|preferences|settings|manage|opt-?out)(?:[/?#]|$)/i,

  // =====================================
  // Social aggregators
  // =====================================
  /** Reddit subreddit pages (discussion threads, not external articles) */
  /reddit\.com\/r\//i,
  /** Reddit user profile pages */
  /reddit\.com\/u(ser)?\//i,

  // =====================================
  // Tracking/redirect URLs
  // =====================================
  /** Analytics/tracking redirect services */
  /linktrak\.io/i,
  /** Affiliate redirect URLs */
  /click\.linksynergy\.com/i,
  /** Google News redirect URLs (not actual articles) */
  /news\.google\.com\/rss\/articles\//i,

  // =====================================
  // Event/meetup pages (without specific event IDs)
  // =====================================
  /** Eventbrite pages without specific event ID */
  /\.eventbrite\.com\/([\w-]+)?(?:[/?#]|$)/i,
  /** Meetup group pages (not specific events) */
  /meetup\.com\/[^\/]+\/(?!events?\/|members?\/)/i,

  // =====================================
  // Known digest collection domains
  // =====================================
  /** Digest aggregator domains - these are newsletter index pages */
  /(csharpdigest|leadershipintech|reactdigest|programming[?_-]?digest|newsletter[?_-]?digest|tech[?_-]?digest)\.com/i,
  /** Domains with "digest" that lack article-like paths */
  /\w+digest\.\w+\/(?![\w-]+\/\d+|[\w-]+$|p\/|post\/|article\/|story\/)/i,
] as const;

/**
 * Bad title patterns - items with these titles should be excluded
 *
 * Categories:
 * 1. Promotional/advertising titles
 * 2. Subscription/call-to-action titles
 * 3. Generic placeholder titles
 */
export const BAD_TITLE_PATTERNS: readonly RegExp[] = [
  // =====================================
  // Promotional/advertising titles
  // =====================================
  /** Single-word advertising titles */
  /^advertise$/i,
  /^sponsor$/i,
  /^advertisement$/i,
  /** Multi-word promotional titles */
  /^promotional content$/i,
  /^sponsored content$/i,
  /^sponsored$/i,

  // =====================================
  // Subscription/call-to-action titles
  // =====================================
  /** Subscribe prompts */
  /^(subscribe|join|sign up)$/i,
  /** Newsletter signup variants */
  /^(subscribe to|join our|sign up for)/i,

  // =====================================
  // Generic placeholder/empty titles
  // =====================================
  /** Untitled or empty content */
  /^(untitled|no title|n\/a|null)$/i,
  /** Link-only titles */
  /^(click here|read more|learn more|view|link)$/i,
] as const;

/**
 * Bad URL domains - specific domains to always exclude
 *
 * These are known digest collection/aggregator domains that
 * should be filtered regardless of URL path.
 */
export const BAD_URL_DOMAINS: readonly string[] = [
  "csharpdigest.com",
  "leadershipintech.com",
  "reactdigest.com",
  "programmingdigest.net",
  "newsletter-digest",
  "bonobopress.com",
] as const;

/**
 * Filter result returned by filterLowQualityItem
 */
export interface FilterResult {
  /** Whether the item was filtered (true = should be excluded) */
  filtered: boolean;
  /** Reason for filtering, if filtered is true */
  reason?: string;
}

/**
 * Check if a feed item should be filtered due to low quality indicators.
 *
 * Checks:
 * 1. Title length (must be at least MIN_TITLE_LENGTH characters)
 * 2. Title against BAD_TITLE_PATTERNS
 * 3. URL against BAD_URL_PATTERNS
 * 4. URL against BAD_URL_DOMAINS
 *
 * @param item - The feed item to check
 * @returns FilterResult with filtered=true and reason if item should be excluded
 *
 * @example
 * const result = filterLowQualityItem(item);
 * if (result.filtered) {
 *   console.log(`Filtered: ${result.reason}`);
 * }
 */
export function filterLowQualityItem(item: FeedItem): FilterResult {
  // Check minimum title length
  if (!item.title || item.title.trim().length < MIN_TITLE_LENGTH) {
    return {
      filtered: true,
      reason: `Title too short (${item.title?.trim().length ?? 0} < ${MIN_TITLE_LENGTH} chars)`,
    };
  }

  // Check title against bad patterns
  for (const pattern of BAD_TITLE_PATTERNS) {
    if (pattern.test(item.title)) {
      return {
        filtered: true,
        reason: `Title matches bad pattern: ${pattern.source}`,
      };
    }
  }

  // Check URL against bad patterns
  if (item.url) {
    for (const pattern of BAD_URL_PATTERNS) {
      if (pattern.test(item.url)) {
        return {
          filtered: true,
          reason: `URL matches bad pattern: ${pattern.source}`,
        };
      }
    }

    // Check URL against bad domains
    for (const domain of BAD_URL_DOMAINS) {
      if (item.url.toLowerCase().includes(domain.toLowerCase())) {
        return {
          filtered: true,
          reason: `URL contains bad domain: ${domain}`,
        };
      }
    }
  }

  return { filtered: false };
}
