/**
 * GET /api/items/[itemId]/fulltext
 * Retrieve full text for an item (if available)
 */

import { NextRequest, NextResponse } from "next/server";
import { loadItem, clearBadFullText } from "@/src/lib/db/items";
import { logger } from "@/src/lib/logger";
import { fetchFullText } from "@/src/lib/pipeline/fulltext";
import { saveFullText } from "@/src/lib/db/items";

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;

    if (!itemId) {
      return NextResponse.json(
        { error: "itemId is required" },
        { status: 400 }
      );
    }

    // Force reset SQLite connection to avoid stale data
    const { resetSqliteConnection } = await import("@/src/lib/db/index");
    resetSqliteConnection();

    const item = await loadItem(itemId);

    if (!item) {
      return NextResponse.json(
        { error: "Item not found" },
        { status: 404 }
      );
    }

    const hasFullText = !!item.fullText && (item.fullText.length >= 100);

    // If no full text exists, try to fetch it automatically (but don't block response)
    if (!hasFullText && item.url && !item.url.includes('inoreader.com') && item.url.startsWith('http')) {
      // Fetch in background (don't await - return immediately)
      fetchFullText(item)
        .then(result => {
          if (result.source !== 'error' && result.text.length > 100) {
            return saveFullText(itemId, result.text, result.source);
          }
        })
        .catch(err => {
          logger.warn(`[FULLTEXT] Background fetch failed for ${itemId}`, { error: err });
        });
    }

    // Check if full text contains Inoreader login page (bad cached content)
    if (hasFullText && (item.fullText.includes('Sign in | Inoreader') || item.fullText.includes('inoreader-logo'))) {
      logger.warn(`[FULLTEXT] Item ${itemId} has Inoreader login page in cached full text - clearing cache and re-fetching`);
      // Clear the bad cached full text
      await clearBadFullText(itemId).catch(err => {
        logger.error(`Failed to clear bad full text for ${itemId}`, { error: err });
      });

      // Try to re-fetch full text immediately with correct URL (with timeout)
      // Only re-fetch if URL is valid and not Inoreader
      if (item.url && !item.url.includes('inoreader.com') && item.url.startsWith('http')) {
        try {
          // Fetch with 10 second timeout
          const fetchPromise = fetchFullText(item);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Fetch timeout')), 10000)
          );

          const result = await Promise.race([fetchPromise, timeoutPromise]);

          if (result.source !== 'error' && result.text.length > 100) {
            await saveFullText(itemId, result.text, result.source);
            // Return the newly fetched full text
            return NextResponse.json({
              fullText: result.text,
              hasFullText: true,
            });
          }
        } catch (err) {
          logger.warn(`[FULLTEXT] Failed to re-fetch full text for ${itemId}`, { error: err });
        }
      }

      // Return empty if re-fetch failed or wasn't attempted
      return NextResponse.json({
        fullText: null,
        hasFullText: false,
      });
    }

    logger.debug(`[FULLTEXT] Item ${itemId}: hasFullText=${hasFullText}, length=${item.fullText?.length || 0}`);

    const responseData = {
      fullText: item.fullText || null,
      hasFullText,
    };

    const response = NextResponse.json(responseData);

    // Set cache control headers to prevent Next.js from caching
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');

    return response;
  } catch (error) {
    logger.error("Failed to get item full text", error);
    return NextResponse.json(
      { error: "Failed to get item full text" },
      { status: 500 }
    );
  }
}
