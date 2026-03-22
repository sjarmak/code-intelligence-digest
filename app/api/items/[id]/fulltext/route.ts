/**
 * GET /api/items/[id]/fulltext
 * Check if an item has full text available and optionally return it
 *
 * Uses PostgreSQL via `getDbClient()`
 */

import { NextRequest, NextResponse } from "next/server";
import { getDbClient } from "@/src/lib/db/driver";
import { looksLikeHtml, stripHtmlFromText } from "@/src/lib/pipeline/fulltext";

/**
 * Check if the "full text" is actually subscription/paywall boilerplate
 * rather than real article content
 */
function isSubscriptionBoilerplate(text: string): boolean {
  if (!text) return true;

  const textLower = text.toLowerCase();

  // Subscription page indicators
  const subscriptionPhrases = [
    'by subscribing, i agree to',
    'terms of use',
    'privacy policy',
    'information collection notice',
    'already have an account? sign in',
    'sign in to your account',
    'create your free account',
    'subscribe to continue reading',
    'subscribe to read',
    'become a member',
    'join to unlock',
    'unlock this article',
    'this post is for paid subscribers',
    'this post is for paying subscribers',
    'upgrade to paid',
    'start your free trial',
    'subscribers only',
  ];

  // Count how many subscription phrases appear
  let subscriptionPhraseCount = 0;
  for (const phrase of subscriptionPhrases) {
    if (textLower.includes(phrase)) {
      subscriptionPhraseCount++;
    }
  }

  // If text is short and has subscription phrases, it's likely boilerplate
  if (text.length < 1000 && subscriptionPhraseCount >= 1) {
    return true;
  }

  // If text has multiple subscription phrases, it's likely a paywall page
  if (subscriptionPhraseCount >= 2) {
    return true;
  }

  // Check for very short text that's mostly about subscribing
  if (text.length < 500) {
    const subscriberMatch = textLower.match(/over\s+[\d,]+\s+subscribers?/);
    if (subscriberMatch) {
      return true;
    }
  }

  return false;
}

async function loadFullTextFromDb(itemId: string): Promise<{
  text: string;
  source: string;
  isFallback?: boolean;
} | null> {
  try {
    const db = await getDbClient();

    const result = await db.query(
      `SELECT full_text, full_text_source, summary FROM items WHERE id = $1`,
      [itemId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as {
      full_text: string | null;
      full_text_source: string | null;
      summary: string | null;
    };

    // Return full text when available and valid
    if (row.full_text && row.full_text.length > 100) {
      return {
        text: row.full_text,
        source: row.full_text_source || "unknown",
      };
    }

    // Fallback to RSS summary when full text is missing
    const summary = row.summary?.trim();
    if (summary && summary.length > 50) {
      return {
        text: summary,
        source: "rss_summary",
        isFallback: true,
      };
    }

    return null;
  } catch (error) {
    console.error(`Failed to load full text for item ${itemId}:`, error);
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const itemId = decodeURIComponent(id);
    const driver = "postgres" as const;

    // Check if full text exists (or summary as fallback)
    const fullText = await loadFullTextFromDb(itemId);

    // Validate full text from scrape (not for RSS summary fallback)
    const hasValidFullText =
      fullText !== null &&
      (fullText.isFallback || !isSubscriptionBoilerplate(fullText.text));

    // Check if caller wants the full content
    const includeContent = request.nextUrl.searchParams.get("include_content") === "true";

    if (includeContent && fullText) {
      const text =
        looksLikeHtml(fullText.text) ? stripHtmlFromText(fullText.text) : fullText.text;
      return NextResponse.json({
        hasFullText: !fullText.isFallback,
        text,
        source: fullText.source,
        isFallback: fullText.isFallback ?? false,
        driver,
      });
    }

    return NextResponse.json({
      hasFullText: hasValidFullText || (fullText?.isFallback ?? false),
      source: fullText?.source ?? null,
      isFallback: fullText?.isFallback ?? false,
      driver,
    });
  } catch (error) {
    console.error("Error checking full text:", error);
    return NextResponse.json(
      { error: "Failed to check full text", hasFullText: false },
      { status: 500 }
    );
  }
}
