import { NextRequest, NextResponse } from "next/server";
import { Category } from "@/src/lib/model";
import { createInoreaderClient } from "@/src/lib/inoreader/client";
import { getStreamsByCategory } from "@/src/config/feeds";
import { normalizeItems } from "@/src/lib/pipeline/normalize";
import { categorizeItems } from "@/src/lib/pipeline/categorize";
import { logger } from "@/src/lib/logger";
import { blockInProduction } from "@/src/lib/auth/guards";

export async function GET(req: NextRequest) {
  // Block in production
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    const { searchParams } = new URL(req.url);
    const category = (searchParams.get("category") || "research") as Category;
    const periodDays = searchParams.get("period") === "month" ? 30 : 7;

    logger.info(`DEBUG: Fetching items for category: ${category}`);

    const client = createInoreaderClient();
    const streamIds = await getStreamsByCategory(category);

    logger.info(`DEBUG: Found ${streamIds.length} streams for ${category}`);

    const allItems = [];
    for (const streamId of streamIds) {
      try {
        const response = await client.getStreamContents(streamId, { n: 50 });
        logger.info(`DEBUG: Stream ${streamId} returned ${response.items.length} items`);
        allItems.push(...response.items);
      } catch (error) {
        logger.error(`DEBUG: Error fetching ${streamId}`, error);
      }
    }

    logger.info(`DEBUG: Total raw items: ${allItems.length}`);

    const normalized = await normalizeItems(allItems);
    logger.info(`DEBUG: After normalize: ${normalized.length}`);

    const categorized = categorizeItems(normalized);
    logger.info(`DEBUG: After categorize: ${categorized.length}`);

    const filtered = categorized.filter((i) => i.category === category);
    logger.info(`DEBUG: After filter by category: ${filtered.length}`);

    const now = Date.now();
    const windowMs = periodDays * 24 * 60 * 60 * 1000;
    const recent = filtered.filter((item) => {
      const ageMs = now - item.publishedAt.getTime();
      return ageMs <= windowMs;
    });
    logger.info(`DEBUG: After recency filter (${periodDays}d): ${recent.length}`);

    return NextResponse.json({
      category,
      periodDays,
      rawItems: allItems.length,
      normalizedItems: normalized.length,
      categorizedItems: categorized.length,
      filteredByCategory: filtered.length,
      filteredByRecency: recent.length,
      streamIds,
      sampleItems: recent.slice(0, 3).map((i) => ({
        title: i.title,
        sourceTitle: i.sourceTitle,
        category: i.category,
        publishedAt: i.publishedAt,
        age: Math.round((Date.now() - i.publishedAt.getTime()) / (1000 * 60 * 60 * 24)),
      })),
    });
  } catch (error) {
    logger.error("DEBUG: Error", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
