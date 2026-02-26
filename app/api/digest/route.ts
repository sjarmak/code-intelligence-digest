/**
 * API route: GET /api/digest
 * Returns AI summary + highlights + themes for a digest period
 */

import { NextRequest, NextResponse } from "next/server";
import { Category } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { rankCategory } from "@/src/lib/pipeline/rank";
import {
  extractThemes,
  getTopThemes,
  generateDigestSummary,
} from "@/src/lib/pipeline/digest";
import {
  getDateRangeForPeriodDays,
  formatDateRangeLabel,
} from "@/src/lib/dateRange";

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

interface DigestResponse {
  period: string;
  dateRange: {
    start: string;
    end: string;
  };
  summary: string;
  themes: string[];
  itemCount: number;
  highlights: Record<
    string,
    Array<{
      id: string;
      title: string;
      url: string;
      sourceTitle: string;
      finalScore: number;
    }>
  >;
  generatedAt: string;
}

/**
 * GET /api/digest?period=week
 *
 * Query parameters:
 * - period (optional): "day" | "week" | "month" (default: "week")
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const period = searchParams.get("period") || "week";

    // Map period to days
    const periodDaysMap: Record<string, { days: number; label: string }> = {
      day: { days: 1, label: "Daily" }, // Last 24 hours (today)
      week: { days: 7, label: "Weekly" },
      month: { days: 30, label: "Monthly" },
    };

    const periodConfig = periodDaysMap[period] || periodDaysMap["week"];
    const periodDays = periodConfig.days;
    const periodLabel = periodConfig.label;

    logger.info(
      `[DIGEST] Generating ${periodLabel} digest (${periodDays}d window)`,
    );

    // Initialize database
    await initializeDatabase();

    // Load items from all categories
    const allRankedItems = [];
    const highlights: Record<
      string,
      Array<{
        id: string;
        title: string;
        url: string;
        sourceTitle: string;
        finalScore: number;
      }>
    > = {};

    for (const cat of VALID_CATEGORIES) {
      const items = await loadItemsByCategory(cat, periodDays);
      if (items && items.length > 0) {
        // Rank items for this category
        const rankedItems = await rankCategory(items, cat, periodDays);

        // Take top 5 per category for highlights
        const topItems = rankedItems.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.title,
          url: item.url,
          sourceTitle: item.sourceTitle,
          finalScore: item.finalScore,
        }));

        highlights[cat] = topItems;

        // Add ranked items to all items for theme extraction
        allRankedItems.push(...rankedItems);
      }
    }

    if (allRankedItems.length === 0) {
      logger.warn(`[DIGEST] No items found for ${periodLabel} digest`);
      return NextResponse.json({
        period,
        dateRange: getDateRangeForPeriodDays(periodDays),
        summary: `No content available for this ${periodLabel.toLowerCase()} period.`,
        themes: [],
        itemCount: 0,
        highlights: {},
        generatedAt: new Date().toISOString(),
      } as DigestResponse);
    }

    // Extract themes
    logger.info(
      `[DIGEST] Extracting themes from ${allRankedItems.length} items`,
    );
    const themeMap = extractThemes(allRankedItems);
    const themes = getTopThemes(themeMap, 10);

    // Generate summary with actual date range so the model doesn't invent a date
    const dateRange = getDateRangeForPeriodDays(periodDays);
    const dateRangeLabel = formatDateRangeLabel(dateRange, period as "day" | "week" | "month");
    logger.info(`[DIGEST] Generating AI summary`);
    const summary = await generateDigestSummary(
      themes,
      allRankedItems.length,
      periodLabel,
      undefined,
      dateRangeLabel,
    );

    const response: DigestResponse = {
      period,
      dateRange,
      summary,
      themes,
      itemCount: allRankedItems.length,
      highlights,
      generatedAt: new Date().toISOString(),
    };

    logger.info(
      `[DIGEST] Generated ${periodLabel} digest with ${themes.length} themes and ${Object.keys(highlights).length} category highlights`,
    );

    return NextResponse.json(response);
  } catch (error) {
    logger.error("[DIGEST] Error in /api/digest", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to generate digest",
      },
      { status: 500 },
    );
  }
}

