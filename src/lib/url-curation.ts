/**
 * URL curation for newsletter and digest: ensure we use article URLs, not subscription/plan pages.
 * Resolves tracking URLs and extracts article URLs from subscribe/redirect params when possible.
 * Returns null when a URL points to a subscription/plan page and we cannot resolve to an article.
 */

import { logger } from "./logger";

/** Path segments that indicate a URL is a subscription, plan, or paywall page, not an article */
const SUBSCRIPTION_PLAN_PATHS = [
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
  "/login",
  "/sign-in",
  "/paywall",
];

const REDIRECT_PARAMS = [
  "next",
  "redirect",
  "url",
  "return",
  "return_to",
  "redirect_uri",
  "continue",
];

/** Article path indicators: having one suggests the URL is an article, not a plan page */
const ARTICLE_PATH_INDICATORS = ["/p/", "/post/", "/article/", "/blog/", "/posts/"];

function decodeTrackingUrl(url: string): string {
  if (!url || !url.startsWith("http")) return url;

  if (url.includes("convertkit-mail") || url.includes("convertkit.com")) {
    const parts = url.split("/");
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.length > 20) {
      try {
        const decoded = Buffer.from(lastPart, "base64").toString("utf-8");
        if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
          return decoded;
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (url.includes("substack.com/redirect/")) {
    const base64Match = url.match(/substack\.com\/redirect\/\d+\/([A-Za-z0-9_-]+)/);
    if (base64Match) {
      try {
        const base64 = base64Match[1].replace(/-/g, "+").replace(/_/g, "/");
        const decoded = Buffer.from(base64, "base64").toString("utf-8");
        const payload = JSON.parse(decoded);
        if (payload.e && typeof payload.e === "string") return payload.e;
      } catch {
        /* ignore */
      }
    }
  }

  return url;
}

/**
 * Returns true if the URL path looks like a subscription, plan, or paywall page (not an article).
 */
export function isSubscriptionOrPlanUrl(url: string | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return SUBSCRIPTION_PLAN_PATHS.some((path) => lower.includes(path));
}

/**
 * Returns true if the URL looks like an article (has common article path segments).
 */
function hasArticlePath(url: string): boolean {
  return ARTICLE_PATH_INDICATORS.some((seg) => url.includes(seg));
}

/**
 * Try to resolve a URL to the actual article URL.
 * - Decodes tracking redirects (Substack, ConvertKit, etc.).
 * - If the result is a subscription/plan page, tries to extract article URL from next/redirect params.
 * Returns the article URL to use, or null if this is a subscription/plan page we cannot resolve
 * (so the item should not be included in the newsletter).
 */
export function tryResolveToArticleUrl(url: string | undefined): string | null {
  if (!url || !url.startsWith("http")) return null;

  const decoded = decodeTrackingUrl(url);
  const lower = decoded.toLowerCase();

  const isSubscription = SUBSCRIPTION_PLAN_PATHS.some((path) => lower.includes(path));
  if (!isSubscription) {
    return decoded;
  }

  try {
    const parsed = new URL(decoded);
    for (const param of REDIRECT_PARAMS) {
      const value = parsed.searchParams.get(param);
      if (value) {
        try {
          const resolved = decodeURIComponent(value);
          if (
            (resolved.startsWith("http://") || resolved.startsWith("https://")) &&
            hasArticlePath(resolved)
          ) {
            logger.info(
              `[url-curation] Resolved subscription URL to article: ${decoded.substring(0, 60)}... -> ${resolved.substring(0, 60)}...`,
            );
            return resolved;
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore URL parse errors */
  }

  logger.debug(
    `[url-curation] Subscription/plan URL with no extractable article, excluding: ${decoded.substring(0, 80)}...`,
  );
  return null;
}
