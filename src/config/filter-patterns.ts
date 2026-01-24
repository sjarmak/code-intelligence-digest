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
