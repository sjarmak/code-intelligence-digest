/**
 * GET /api/items?category=tech_articles&period=week
 * Returns ranked items for a specific category and time period
 */

import { NextRequest, NextResponse } from "next/server";
import { loadItemsByCategoryWithDateRange } from "@/src/lib/db/items";
import { initializeDatabase } from "@/src/lib/db/index";
import { getDbClient } from "@/src/lib/db/driver";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { selectWithDiversity } from "@/src/lib/pipeline/select";
import { Category, FeedItem } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";
import { getCategoryConfig } from "@/src/config/categories";
import { PERIOD_CONFIG } from "@/src/config/periods";
import { decodeHtmlEntities } from "@/src/lib/utils/html-entities";
import { filterLowQualityItem } from "@/src/config/filter-patterns";
import {
  getProductById,
  getCompetitorProducts,
  getOwnProducts,
  getAllProductIds,
} from "@/src/config/products";
import { looksLikeHtml, stripHtmlFromText } from "@/src/lib/pipeline/fulltext";
import { itemsListSelectColumns } from "./select-columns";

/**
 * Decode tracking URLs to get the real destination URL
 * Handles: ConvertKit, Beehiiv, Substack redirect URLs
 */
function decodeTrackingUrl(url: string): string {
  // ConvertKit: https://xxx.click.convertkit-mail2.com/.../BASE64_ENCODED_URL
  if (url.includes("convertkit-mail") || url.includes("convertkit.com")) {
    // The base64 encoded URL is usually the last path segment
    const parts = url.split("/");
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.length > 20) {
      try {
        const decoded = Buffer.from(lastPart, "base64").toString("utf-8");
        if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
          logger.info(`[API] Decoded ConvertKit URL: ${decoded}`);
          return decoded;
        }
      } catch {
        // Not valid base64, continue with original URL
      }
    }
  }

  // Beehiiv: https://link.mail.beehiiv.com/ss/c/... - these redirect, harder to decode
  // For now, we'll let them through and filter based on the final URL patterns

  // Substack redirect: https://substack.com/redirect/2/BASE64_JSON
  if (url.includes("substack.com/redirect/")) {
    const base64Match = url.match(
      /substack\.com\/redirect\/\d+\/([A-Za-z0-9_-]+)/,
    );
    if (base64Match) {
      try {
        const base64 = base64Match[1].replace(/-/g, "+").replace(/_/g, "/");
        const decoded = Buffer.from(base64, "base64").toString("utf-8");
        const payload = JSON.parse(decoded);
        if (payload.e && typeof payload.e === "string") {
          logger.info(`[API] Decoded Substack redirect URL: ${payload.e}`);
          return payload.e;
        }
      } catch {
        // Failed to decode
      }
    }
  }

  return url;
}

/**
 * Extract real article URL from subscribe/redirect URLs, or return null if should be excluded
 * Returns: the cleaned URL (original or extracted), or null if item should be filtered out
 */
function extractOrFilterUrl(url: string): string | null {
  if (!url) return null;

  // First, decode any tracking URLs to get the real destination
  const decodedUrl = decodeTrackingUrl(url);
  const urlLower = decodedUrl.toLowerCase();

  // Try to extract article URL from subscribe/membership/paywall redirects first
  // Example: https://www.interconnects.ai/subscribe?...&next=https%3A%2F%2Fwww.interconnects.ai%2Fp%2Fget-good-at-agents
  const subscriptionPaths = [
    "/subscribe",
    "/signup",
    "/sign-up",
    "/join",
    "/register",
    "/membership",
    "/pricing",
    "/premium",
    "/upgrade",
    "/plans",
  ];
  if (subscriptionPaths.some((path) => urlLower.includes(path))) {
    try {
      const parsed = new URL(decodedUrl);
      // Check for 'next' or 'redirect' or 'url' or 'return' params that might contain the real article
      const redirectParams = [
        "next",
        "redirect",
        "url",
        "return",
        "return_to",
        "redirect_uri",
        "continue",
      ];
      for (const param of redirectParams) {
        const redirectUrl = parsed.searchParams.get(param);
        if (redirectUrl) {
          // Decode and validate the redirect URL
          const paramDecodedUrl = decodeURIComponent(redirectUrl);
          if (
            paramDecodedUrl.startsWith("http://") ||
            paramDecodedUrl.startsWith("https://")
          ) {
            // Check if the extracted URL is an actual article (has /p/ or other article path)
            if (
              paramDecodedUrl.includes("/p/") ||
              paramDecodedUrl.includes("/post/") ||
              paramDecodedUrl.includes("/article/") ||
              paramDecodedUrl.includes("/blog/")
            ) {
              logger.info(
                `[API] Extracted article URL from subscribe redirect: ${paramDecodedUrl}`,
              );
              return paramDecodedUrl;
            }
          }
        }
      }
      // No valid article URL found in params, filter out this subscribe page
      logger.info(
        `[API] Filtering subscription URL (no article param): ${decodedUrl}`,
      );
      return null;
    } catch {
      return null;
    }
  }

  // Filter Substack URLs that don't have /p/ (article path)
  if (
    urlLower.includes(".substack.com") ||
    urlLower.includes("substack.com/")
  ) {
    if (!decodedUrl.includes("/p/")) {
      return null; // Reject - this is a home page or subscription page
    }
    if (
      urlLower.includes("/subscribe") ||
      urlLower.includes("/payment") ||
      urlLower.includes("/checkout") ||
      urlLower.includes("/upgrade")
    ) {
      return null;
    }
  }

  // Filter newsletter home pages that redirect to subscription
  if (urlLower.includes("newsletter.") && urlLower.includes(".com")) {
    const hasArticlePath = /\/(p|post|article|story|archive)\//i.test(
      decodedUrl,
    );
    const isJustDomain = /newsletter\.\w+\.com\/?(\?|$)/i.test(decodedUrl);
    if (!hasArticlePath && isJustDomain) {
      return null;
    }
  }

  // Filter homepage URLs (domain root with no article path)
  try {
    const parsed = new URL(decodedUrl);
    const pathname = parsed.pathname;
    const hasOnlyRootPath = pathname === "/" || pathname === "";

    if (hasOnlyRootPath) {
      if (!parsed.hash || parsed.hash === "#" || parsed.hash.length < 3) {
        return null; // Reject - this is a homepage URL
      }
    }
  } catch {
    // If URL parsing fails, let other checks handle it
  }

  // Return the decoded URL (which may be different from original if it was a tracking URL)
  return decodedUrl;
}

// Local auto-catchup sync (dev-only)
// If the local DB is stale (no items within requested time window),
// kick off an async catch-up sync so the UI becomes "self-healing".
let autoCatchupInFlight = false;
let lastAutoCatchupAttemptAtMs = 0;
const AUTO_CATCHUP_COOLDOWN_MS = 10 * 60 * 1000;
const AUTO_CATCHUP_LOOKBACK_DAYS = 30;

async function maybeKickoffLocalCatchupSync(args: {
  category: Category;
  period: string;
  reason: "cutoff_fallback" | "no_items_in_window";
  maxTimestampISO: string | null;
}) {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  if (nodeEnv === "production") return;

  const localUrl = process.env.LOCAL_DATABASE_URL;
  if (!localUrl?.startsWith("postgres")) return;

  let host: string | null = null;
  let port: string | null = null;
  try {
    const u = new URL(localUrl);
    host = u.hostname;
    port = u.port || null;
  } catch {
    // ignore
  }

  const isLocalHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host?.endsWith(".local") === true;
  if (!isLocalHost) return;

  const nowMs = Date.now();
  const cooldownRemainingMs = Math.max(
    0,
    AUTO_CATCHUP_COOLDOWN_MS - (nowMs - lastAutoCatchupAttemptAtMs),
  );

  if (autoCatchupInFlight) return;
  if (cooldownRemainingMs > 0) return;

  autoCatchupInFlight = true;
  lastAutoCatchupAttemptAtMs = nowMs;

  logger.info("[AUTO-CATCHUP] starting prod->local sync", {
    category: args.category,
    period: args.period,
    reason: args.reason,
    maxTimestampISO: args.maxTimestampISO,
    host,
    port,
  });

  // Fire-and-forget; never block /api/items on sync
  void (async () => {
    try {
      const { syncProdToLocalPostgres } =
        await import("@/src/lib/db/sync-prod-to-local");
      const result = await syncProdToLocalPostgres(AUTO_CATCHUP_LOOKBACK_DAYS);
      logger.info("[AUTO-CATCHUP] prod->local sync finished", result);
    } catch (e) {
      logger.warn("[AUTO-CATCHUP] prod->local sync failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      autoCatchupInFlight = false;
    }
  })();
}

const VALID_CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "ai_dev",
  "product_news",
  "community",
  "research",
  "marketing",
];

const PERIOD_DAYS: Record<string, number> = {
  day: PERIOD_CONFIG.day.days!,
  week: PERIOD_CONFIG.week.days!,
  month: PERIOD_CONFIG.month.days!,
  all: PERIOD_CONFIG.all.days!,
};

export async function GET(request: NextRequest) {
  // Rate limit before any ranking work; fail open if the check itself errors
  // (e.g., DB hiccup) so the main read path stays available.
  try {
    const { enforceRateLimit, recordUsage } = await import("@/src/lib/rate-limit");
    const rateLimitResponse = await enforceRateLimit(request, "/api/items");
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
    // Count the request now rather than on success so expensive failing
    // requests still consume quota.
    await recordUsage(request, "/api/items");
  } catch (rateLimitError) {
    logger.warn("[API] Rate limit check failed, continuing without rate limit", {
      error: rateLimitError,
    });
  }

  // Extract parameters early so they're available in error handler
  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get("category") as Category | null;
  const period = searchParams.get("period") || "week";
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset"); // Offset for pagination (skip N items)
  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");

  // Product filtering parameters
  const productsParam = searchParams.get("products"); // Comma-separated product IDs to filter TO
  const excludeProductsParam = searchParams.get("excludeProducts"); // Comma-separated product IDs to filter OUT
  const competitorsOnlyParam = searchParams.get("competitorsOnly"); // Only show items mentioning competitors
  const excludeOwnParam = searchParams.get("excludeOwn"); // Exclude Sourcegraph/Cody mentions

  // Research only: "indexed" (created_at) = when we synced from ADS; "published" = paper publication date
  const researchDateFilter = searchParams.get("researchDateFilter") || "indexed";

  try {
    // Parse limit, clamp to [1, 50]
    let customLimit: number | undefined;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed)) {
        customLimit = Math.min(Math.max(parsed, 1), 50);
      }
    }

    // Parse offset for pagination
    let offset = 0;
    if (offsetParam) {
      const parsed = parseInt(offsetParam, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        offset = parsed;
      }
    }

    // Validate category
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        {
          error: "Invalid or missing category",
          validCategories: VALID_CATEGORIES,
        },
        { status: 400 },
      );
    }

    // Validate period
    if (period === "custom") {
      if (!startDateParam || !endDateParam) {
        return NextResponse.json(
          {
            error: "Custom period requires startDate and endDate parameters",
          },
          { status: 400 },
        );
      }
      const startDate = new Date(startDateParam);
      const endDate = new Date(endDateParam);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return NextResponse.json(
          {
            error: "Invalid date format. Use YYYY-MM-DD",
          },
          { status: 400 },
        );
      }
      if (startDate > endDate) {
        return NextResponse.json(
          {
            error: "Start date must be before end date",
          },
          { status: 400 },
        );
      }
    } else if (!PERIOD_DAYS[period]) {
      return NextResponse.json(
        {
          error: "Invalid period",
          validPeriods: [...Object.keys(PERIOD_DAYS), "custom"],
        },
        { status: 400 },
      );
    }

    // Calculate periodDays for custom or use predefined
    let periodDays: number;
    let loadOptions: { startDate?: Date; endDate?: Date } | undefined;

    if (period === "custom") {
      const startDate = new Date(startDateParam!);
      const endDate = new Date(endDateParam!);
      // Set to start of day for start, end of day for end
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      loadOptions = { startDate, endDate };
      // Calculate approximate days for logging/config
      periodDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
      );
    } else {
      periodDays = PERIOD_DAYS[period];

      // For research, product_news, and newsletters: use created_at for day period to show recently synced items
      // This ensures items show up based on when they were added to the database, not when they were published
      // "Daily" means "what's new today" = items synced in the last 24 hours
      if (
        (category === "research" ||
          category === "product_news" ||
          category === "newsletters") &&
        period === "day"
      ) {
        // Use 1 day for day period (today only)
        periodDays = 1;
        logger.info(
          `[API] Using 1 day window with created_at for ${category} day period to show recently synced items`,
        );
      }
    }

    logger.info(
      `API request: category=${category}, period=${period}${period === "custom" ? ` (${startDateParam} to ${endDateParam})` : ` (${periodDays}d)`}`,
    );

    // Initialize database (creates tables if needed)
    await initializeDatabase();

    // Force reset Postgres pool to avoid stale singleton client in long-lived Next.js workers
    const { resetDbClient } = await import("@/src/lib/db/index");
    await resetDbClient();

    // Load items from database
    // Use direct database query to avoid Next.js module caching issues
    let items: FeedItem[];
    let usedCutoffFallback = false;
    if (loadOptions?.startDate && loadOptions?.endDate) {
      items = await loadItemsByCategoryWithDateRange(
        category,
        loadOptions.startDate,
        loadOptions.endDate,
      );
    } else {
      // Direct database query to ensure fresh data (using driver abstraction)
      const client = await getDbClient();
      type ItemRow = {
        id: string;
        stream_id: string;
        source_title: string;
        title: string;
        url: string;
        author: string | null;
        published_at: number;
        created_at: number;
        summary: string | null;
        content_snippet: string | null;
        categories: string;
        category: string;
        extracted_url?: string | null;
        full_text?: string | null;
      } & Record<string, unknown>;

      // Calculate cutoff time and date column based on category and period
      let cutoffTime: number;
      let useCreatedAt: boolean;
      let dateColumn: string;

      // Standard logic for all categories/periods
      const nowMs = Date.now();
      cutoffTime = Math.floor(
        (nowMs - periodDays * 24 * 60 * 60 * 1000) / 1000,
      );

      // For research and ai_dev:
      // - Daily/Weekly/Monthly: Show top-ranked results (no date filtering)
      //   ai_dev is populated by migration from newsletters; items may be older
      // - All-time: Filter by published_at (research: last 3 years; ai_dev: standard period)
      if (category === "research") {
        cutoffTime = Math.floor(
          (nowMs - periodDays * 24 * 60 * 60 * 1000) / 1000,
        );
        useCreatedAt = false;
        // Default: created_at = when we indexed from ADS. Optional: published_at = paper publication date
        const usePublicationDate =
          researchDateFilter === "published" || period === "all";
        dateColumn = usePublicationDate ? "published_at" : "created_at";
        if (period === "all") {
          cutoffTime = Math.floor(
            (Date.now() - 3 * 365 * 24 * 60 * 60 * 1000) / 1000,
          );
          logger.info(
            `[API] Research all-time: last 3 years using published_at`,
          );
        } else {
          logger.info(
            `[API] Research ${period}: filtering by ${dateColumn} >= ${new Date(cutoffTime * 1000).toISOString()} (${periodDays}d, filter=${researchDateFilter})`,
          );
        }
      } else if (category === "ai_dev" && period !== "all") {
        // ai_dev: migration-populated from newsletters; items may be old - show top ranked without date filter
        useCreatedAt = false;
        dateColumn = "created_at";
        logger.info(
          `[API] AI Dev ${period} period: no date filtering, showing top ranked results`,
        );
      } else {
        // For most categories: use published_at for date filtering
        // This ensures items show up based on when they were published, not when they were synced
        useCreatedAt = false;
        dateColumn = "published_at";

        // Exception: For newsletters with day period, use created_at to show recently synced items
        // "Daily" means items synced in the last 24 hours, regardless of when they were published
        // This ensures users see fresh content even if newsletter published_at is delayed
        if (category === "newsletters" && period === "day") {
          useCreatedAt = true;
          dateColumn = "created_at";
          logger.info(
            `[API] Newsletters day period: using created_at with ${periodDays} day window (${new Date(cutoffTime * 1000).toISOString()})`,
          );
        }
      }

      // For newsletters, get both decomposed articles (have -article- in ID) and single-article newsletters (no -article-)
      // Single-article newsletters don't get the -article- suffix during decomposition
      // For research day/week/month: no date filtering, just get top items by relevance (via ranking)
      let whereClause: string;
      let queryParams: unknown[];

      if (category === "newsletters") {
        // Include both decomposed articles (with -article- in ID) and single-article newsletters (without -article-)
        // Single-article newsletters don't get the -article- suffix, so we need to include items that either
        // have -article- in ID OR are from newsletter sources without -article- in ID
        whereClause = `category = ? AND ${dateColumn} >= ?`;
        queryParams = [category, cutoffTime];
      } else if (category === "ai_dev" && period !== "all") {
        // ai_dev: migration-populated from newsletters; items may be old - show top ranked without date filter
        whereClause = `category = ?`;
        queryParams = [category];
      } else {
        whereClause = `category = ? AND ${dateColumn} >= ?`;
        queryParams = [category, cutoffTime];
      }

      // Add LIMIT to prevent loading too many items and causing timeouts
      // For "all" period, limit to 1000 items (enough for 100 pages of 10)
      // For research, use smaller limit due to large full_text fields
      let limitClause = "";
      if (category === "research") {
        limitClause = " LIMIT 500";
      } else if (period === "all") {
        limitClause = " LIMIT 1000";
      }

      // Project columns explicitly. Non-research categories omit the heavy
      // `full_text` blob (never returned to the client) to cap the per-request
      // allocation spike that caused silent cgroup OOM-kills on the 512 MB
      // container — see ./select-columns.ts (bd code-intel-digest-n0m,
      // oom_investigation_2026_04 §5 #1). Research keeps full_text so it can
      // flag which papers have full text available.
      const selectColumns = itemsListSelectColumns(category);

      const sqlQuery = `SELECT ${selectColumns} FROM items WHERE ${whereClause} ORDER BY ${dateColumn} DESC${limitClause}`;
      logger.info(
        `[API] Executing query: ${sqlQuery} with params: [${queryParams.map((p) => (typeof p === "number" ? p : `'${p}'`)).join(", ")}]`,
      );
      const maxTimestampISO: string | null = null;

      const result = await client.query(sqlQuery, queryParams);
      let rawRows = result.rows as ItemRow[];

      // Fallback: if no items match the date cutoff, return the most recent items instead
      // This ensures the API returns data even when the database hasn't been synced recently
      if (rawRows.length === 0 && category !== "research" && period !== "all") {
        // Day should be strict: if nothing in last 24h, return 0 items (no fallback).
        // Weekly/monthly can still fall back to avoid "nothing ever loads" when local DB is stale.
        const skipFallback = period === "day";
        if (!skipFallback) {
          logger.info(
            `[API] No items found within cutoff window (${new Date(cutoffTime * 1000).toISOString()}), falling back to most recent items`,
          );
          const fallbackQuery = `SELECT ${selectColumns} FROM items WHERE category = ? ORDER BY ${dateColumn} DESC${limitClause}`;
          const fallbackResult = await client.query(fallbackQuery, [category]);
          rawRows = fallbackResult.rows as ItemRow[];
          usedCutoffFallback = true;

          await maybeKickoffLocalCatchupSync({
            category,
            period,
            reason: "cutoff_fallback",
            maxTimestampISO,
          });
        }
      }

      logger.info(
        `[API] Direct query returned ${rawRows.length} rows for category=${category}, periodDays=${periodDays}, dateColumn=${dateColumn}, cutoffTime=${cutoffTime} (${new Date(cutoffTime * 1000).toISOString()})`,
      );

      // Helper function to extract real URL from tracking links
      function extractUrlFromTracking(trackingUrl: string): string | null {
        // awstrack.me format: https://...awstrack.me/L0/https:%2F%2F...
        const awstrackMatch = trackingUrl.match(/\/L0\/(https?[^\/\s]+)/);
        if (awstrackMatch) {
          try {
            const encoded = awstrackMatch[1];
            const decoded = decodeURIComponent(encoded);
            if (
              decoded.startsWith("http://") ||
              decoded.startsWith("https://")
            ) {
              return decoded;
            }
          } catch {
            // URL decode failed
          }
        }
        return null;
      }

      // Map rows to FeedItem format, using extracted_url when URL is Inoreader/tracking
      const mappedItems = rawRows.map((row): FeedItem | null => {
        const cat = row.category as Category;
        // Use extracted_url if URL is Inoreader/tracking, otherwise use url
        let finalUrl = row.url;

        // Check if URL is a tracking/Inoreader link
        if (
          row.url &&
          (row.url.includes("inoreader.com") ||
            row.url.includes("google.com/reader") ||
            row.url.includes("awstrack.me") ||
            row.url.includes("tracking"))
        ) {
          // First try extracted_url from database
          if (
            row.extracted_url &&
            !row.extracted_url.includes("inoreader.com") &&
            !row.extracted_url.includes("google.com/reader")
          ) {
            finalUrl = row.extracted_url;
          } else {
            // Try to extract URL from tracking link
            const extracted = extractUrlFromTracking(row.url);
            if (extracted) {
              finalUrl = extracted;
            } else {
              // Skip items with tracking URLs and no way to extract real URL
              return null;
            }
          }
        }

        try {
          return {
            id: row.id,
            streamId: row.stream_id,
            sourceTitle: row.source_title,
            title: row.title,
            url: finalUrl,
            author: row.author || undefined,
            publishedAt: new Date(row.published_at * 1000),
            createdAt: new Date(row.created_at * 1000),
            summary: row.summary || undefined,
            contentSnippet: row.content_snippet || undefined,
            categories: JSON.parse(row.categories),
            category: cat,
            raw: {},
            fullText: (() => {
              const raw = row.full_text ?? undefined;
              if (!raw) return undefined;
              return looksLikeHtml(raw) ? stripHtmlFromText(raw) : raw;
            })(),
          };
        } catch (error) {
          logger.warn(`[API] Error mapping row ${row.id}: ${error}`);
          return null;
        }
      });

      items = mappedItems.filter((item): item is FeedItem => item !== null);
      logger.info(
        `[API] Mapped to ${items.length} items from ${rawRows.length} rows`,
      );
    }

    logger.info(
      `[API] Loaded ${items.length} items from database for category=${category}, periodDays=${periodDays}`,
    );

    // Filter out items with bad URLs (Substack sign-up pages, subscription pages, etc.)
    // Also extract real article URLs from subscribe redirects when possible
    // This runs for ALL code paths (custom date range and standard periods)
    const itemsBeforeUrlFilter = items.length;
    logger.info(`[API] Checking ${items.length} items for bad URLs...`);
    items = items
      .map((item) => {
        // Try to extract article URL or filter out bad URLs
        logger.info(`[API] Checking URL: ${item.url}`);
        const extractedUrl = extractOrFilterUrl(item.url);
        if (extractedUrl === null) {
          logger.info(
            `[API] Filtering out item with bad URL: "${item.title}" (${item.url})`,
          );
          return null;
        }
        // Update URL if we extracted a better one
        if (extractedUrl !== item.url) {
          logger.info(
            `[API] Updated item URL: "${item.title}" from ${item.url} to ${extractedUrl}`,
          );
          return { ...item, url: extractedUrl };
        }
        return item;
      })
      .filter((item): item is FeedItem => {
        if (item === null) return false;
        // Check title and URL patterns from filter-patterns config
        const filterResult = filterLowQualityItem(item);
        if (filterResult.filtered) {
          logger.info(
            `[API] Filtering out low-quality item: "${item.title}" - ${filterResult.reason}`,
          );
          return false;
        }
        return true;
      });
    const urlFilteredCount = itemsBeforeUrlFilter - items.length;
    if (urlFilteredCount > 0) {
      logger.info(`[API] Filtered out ${urlFilteredCount} items with bad URLs`);
    }

    // Dev-only safety: Twitter/X feed items shouldn't appear in Newsletters; they're Community.
    // We filter them out of the newsletters response and (in dev/local only) recategorize them in the DB
    // so they show up under the Community tab on subsequent loads.
    if (category === "newsletters") {
      // Detect Twitter feed items by:
      // 1. URL points to twitter.com or x.com
      // 2. Source title contains "twitter" OR has @handle pattern (like "/ @username" or "(@username)")
      const isTwitterFeedItem = (it: FeedItem) =>
        typeof it.sourceTitle === "string" &&
        typeof it.url === "string" &&
        (it.url.includes("twitter.com/") || it.url.includes("x.com/")) &&
        (it.sourceTitle.toLowerCase().includes("twitter") ||
          /(\(@|\/\s*@)\w+/.test(it.sourceTitle));

      const twitterFeedItems = items.filter(isTwitterFeedItem);
      if (twitterFeedItems.length > 0) {
        items = items.filter((it) => !isTwitterFeedItem(it));

        // Fire-and-forget local recategorization (dev + localhost only)
        void (async () => {
          try {
            const nodeEnv = process.env.NODE_ENV ?? "development";
            if (nodeEnv === "production") return;
            const localUrl = process.env.LOCAL_DATABASE_URL;
            if (!localUrl?.startsWith("postgres")) return;
            const u = new URL(localUrl);
            const isLocalHost =
              u.hostname === "localhost" ||
              u.hostname === "127.0.0.1" ||
              u.hostname.endsWith(".local");
            if (!isLocalHost) return;

            const { getDbClient } = await import("@/src/lib/db/driver");
            const db = await getDbClient();
            // Recategorize Twitter/X items that are miscategorized as newsletters
            // Matches items with @handle pattern in source title or "twitter" in source title
            await db.run(
              `
              UPDATE items
              SET category = 'community'
              WHERE category = 'newsletters'
                AND (url ILIKE '%twitter.com/%' OR url ILIKE '%x.com/%')
                AND (source_title ILIKE '%twitter%' OR source_title ~ '(\\(@|/\\s*@)\\w+')
            `,
            );
          } catch (e) {
            logger.warn("[API] Recategorize twitter feed items failed", {
              error: e instanceof Error ? e.message : String(e),
            });
          }
        })();
      }
    }

    // Rank items (no filtering - it's fine for ai_news to show items from newsletters if they're relevant)
    // If we had to fall back (no items in-window), skip the internal date filter in rankCategory
    // so that "week" doesn't become empty after we already chose to display stale data.
    let rankedItems = await rankCategory(items, category, periodDays, period, {
      skipDateFilter: usedCutoffFallback,
    });
    logger.info(
      `[API] Ranked to ${rankedItems.length} items (input was ${items.length} items)`,
    );

    // Debug: Check if scores are loading
    if (rankedItems.length > 0) {
      const firstItem = rankedItems[0];
      logger.info(
        `[API] First ranked item: title="${firstItem.title.substring(0, 50)}...", finalScore=${firstItem.finalScore.toFixed(3)}, llmRelevance=${firstItem.llmScore.relevance}, llmUsefulness=${firstItem.llmScore.usefulness}`,
      );
    }

    // Apply product filtering if any product filters are specified
    const beforeProductFilter = rankedItems.length;
    if (
      productsParam ||
      excludeProductsParam ||
      competitorsOnlyParam === "true" ||
      excludeOwnParam === "true"
    ) {
      // Parse product filter lists
      const includeProducts = productsParam
        ? new Set(productsParam.split(",").map((p) => p.trim().toLowerCase()))
        : null;
      const excludeProducts = excludeProductsParam
        ? new Set(
            excludeProductsParam.split(",").map((p) => p.trim().toLowerCase()),
          )
        : null;
      const competitorsOnly = competitorsOnlyParam === "true";
      const excludeOwn = excludeOwnParam === "true";

      // Get sets for quick lookup
      const competitorIds = new Set(getCompetitorProducts().map((p) => p.id));
      const ownProductIds = new Set(getOwnProducts().map((p) => p.id));

      rankedItems = rankedItems.filter((item) => {
        const mentions = item.productMentions || [];

        // Filter: only include items mentioning specific products
        if (includeProducts && includeProducts.size > 0) {
          if (!mentions.some((m) => includeProducts.has(m))) {
            return false;
          }
        }

        // Filter: exclude items mentioning specific products
        if (excludeProducts && excludeProducts.size > 0) {
          if (mentions.some((m) => excludeProducts.has(m))) {
            return false;
          }
        }

        // Filter: only show items mentioning competitor products
        // Also implicitly excludes own products when competitorsOnly is true
        if (competitorsOnly) {
          if (!mentions.some((m) => competitorIds.has(m))) {
            return false;
          }
          // Exclude items that also mention our own products
          if (mentions.some((m) => ownProductIds.has(m))) {
            return false;
          }
        }

        // Filter: exclude items mentioning own products (Sourcegraph/Cody)
        if (excludeOwn) {
          if (mentions.some((m) => ownProductIds.has(m))) {
            return false;
          }
        }

        return true;
      });

      logger.info(
        `[API] Product filter: ${beforeProductFilter} -> ${rankedItems.length} items (filters: products=${productsParam || "none"}, excludeProducts=${excludeProductsParam || "none"}, competitorsOnly=${competitorsOnly}, excludeOwn=${excludeOwn})`,
      );
    }

    // Apply diversity selection based on period
    // For pagination, we need higher per-source caps to allow more items
    // The caps here are per-source limits to ensure variety, but we increase them
    // significantly to allow proper pagination through all available content
    const isNewsletters = category === "newsletters";
    const perSourceCaps = isNewsletters
      ? { day: 3, week: 4, month: 8, all: 15 } // Higher caps for pagination
      : { day: 6, week: 8, month: 12, all: 20 };
    const maxPerSource = perSourceCaps[period as keyof typeof perSourceCaps] ?? 4;

    // Get all items that pass diversity selection (no excludeIds - we'll paginate after)
    // Use a high limit to get all valid items for pagination
    const maxItemsForSelection = 200; // Allow up to 200 items for pagination
    const selectionResult = selectWithDiversity(
      rankedItems,
      category,
      maxPerSource,
      maxItemsForSelection,
      undefined, // No excludeIds - we use offset-based pagination
    );
    logger.info(
      `Applied diversity selection: ${selectionResult.items.length} items selected from ${rankedItems.length}`,
    );

    // Apply pagination: slice items based on offset and limit
    const pageSize = customLimit || 10;
    const paginatedItems = selectionResult.items.slice(
      offset,
      offset + pageSize,
    );
    const totalCount = selectionResult.items.length;
    const hasMore = offset + pageSize < totalCount;
    const currentPage = Math.floor(offset / pageSize) + 1;
    const totalPages = Math.ceil(totalCount / pageSize);

    logger.info(
      `Pagination: page ${currentPage}/${totalPages}, showing items ${offset + 1}-${offset + paginatedItems.length} of ${totalCount}`,
    );

    // Collect all unique products mentioned in the results (for filter UI)
    const allMentionedProducts = new Set<string>();
    for (const item of selectionResult.items) {
      if (item.productMentions) {
        for (const productId of item.productMentions) {
          allMentionedProducts.add(productId);
        }
      }
    }

    // Return response with cache control headers to prevent Next.js caching
    const response = NextResponse.json({
      category,
      period,
      periodDays,
      // Pagination metadata
      pagination: {
        currentPage,
        totalPages,
        pageSize,
        totalCount,
        offset,
        hasMore,
      },
      totalItems: paginatedItems.length,
      itemsRanked: rankedItems.length,
      itemsFiltered: rankedItems.length - selectionResult.items.length,
      hasMore, // Keep for backwards compatibility
      // Products mentioned in results (for building filter UI)
      productsMentioned: Array.from(allMentionedProducts)
        .map((id) => {
          const product = getProductById(id);
          return product
            ? { id: product.id, name: product.name, category: product.category }
            : null;
        })
        .filter(Boolean),
      items: paginatedItems.map((item, index) => ({
        id: item.id,
        title: decodeHtmlEntities(item.title), // Decode HTML entities in title
        url: item.url,
        sourceTitle: item.sourceTitle,
        publishedAt: item.publishedAt.toISOString(),
        createdAt: item.createdAt?.toISOString() || null,
        summary: item.summary,
        author: item.author,
        categories: item.categories,
        category: item.category,
        bm25Score: Number(item.bm25Score.toFixed(3)),
        llmScore: {
          relevance: item.llmScore.relevance,
          usefulness: item.llmScore.usefulness,
          tags: item.llmScore.tags,
        },
        recencyScore: Number(item.recencyScore.toFixed(3)),
        finalScore: Number(item.finalScore.toFixed(3)),
        reasoning: item.reasoning,
        diversityReason: selectionResult.reasons.get(item.id),
        productMentions: item.productMentions, // Include detected products
        // Include the overall rank (1-indexed, accounting for offset)
        rank: offset + index + 1,
      })),
    });

    // Set cache control headers to prevent Next.js from caching API responses
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error("GET /api/items failed", {
      error: errorMessage,
      stack: errorStack,
      category,
      period,
      limitParam,
      offsetParam,
    });
    return NextResponse.json(
      {
        error: "Failed to fetch items",
        message: errorMessage,
        category,
        period,
      },
      { status: 500 },
    );
  }
}
