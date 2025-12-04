/**
 * API route: GET /api/admin/analytics/scores
 * Analyze score distributions and performance metrics
 */

import { NextRequest, NextResponse } from "next/server";
import { Category } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { getAverageScoresByCategory } from "@/src/lib/db/scores";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { rankCategory } from "@/src/lib/pipeline/rank";

const VALID_CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "product_news",
  "community",
  "research",
];

/**
 * Compute histogram of score distribution
 */
function computeHistogram(scores: number[], buckets: number = 10): number[] {
  if (scores.length === 0) return Array(buckets).fill(0);

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;
  const histogram = Array(buckets).fill(0);

  for (const score of scores) {
    const bucket = Math.min(buckets - 1, Math.floor(((score - min) / range) * buckets));
    histogram[bucket]++;
  }

  return histogram;
}

/**
 * GET /api/admin/analytics/scores?category=research&period=week
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const category = searchParams.get("category") as Category | null;
    const period = searchParams.get("period") || "week";
    const showHistogram = searchParams.get("histogram") !== "false";
    const showTopSources = searchParams.get("topSources") !== "false";

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        {
          error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const periodDays = period === "month" ? 30 : 7;

    logger.info(
      `[ANALYTICS] Computing score stats for category: ${category}, period: ${periodDays}d`
    );

    // Initialize database
    await initializeDatabase();

    // Get average scores for category
    const avgScores = await getAverageScoresByCategory(category);

    // Load and rank items to compute score distributions
    const cachedItems = await loadItemsByCategory(category, periodDays);
    if (!cachedItems || cachedItems.length === 0) {
      return NextResponse.json({
        category,
        period: periodDays === 7 ? "week" : "month",
        averageScores: avgScores,
        message: "No items found for this category",
      });
    }

    const rankedItems = await rankCategory(cachedItems, category, periodDays);

    // Compute score distributions
    const bm25Scores = rankedItems.map((i) => i.bm25Score);
    const llmRelevanceScores = rankedItems.map((i) => i.llmScore.relevance);
    const llmUsefulnessScores = rankedItems.map((i) => i.llmScore.usefulness);
    const recencyScores = rankedItems.map((i) => i.recencyScore);
    const finalScores = rankedItems.map((i) => i.finalScore);

    const stats: Record<string, unknown> = {
      category,
      period: periodDays === 7 ? "week" : "month",
      itemsAnalyzed: rankedItems.length,
      averageScores: avgScores,
    };

    if (showHistogram) {
      stats.distributions = {
        bm25: {
          histogram: computeHistogram(bm25Scores),
          min: Math.min(...bm25Scores),
          max: Math.max(...bm25Scores),
          mean: bm25Scores.reduce((a, b) => a + b, 0) / bm25Scores.length,
          median:
            bm25Scores.length > 0
              ? bm25Scores.sort((a, b) => a - b)[Math.floor(bm25Scores.length / 2)]
              : 0,
        },
        llmRelevance: {
          histogram: computeHistogram(llmRelevanceScores),
          min: Math.min(...llmRelevanceScores),
          max: Math.max(...llmRelevanceScores),
          mean: llmRelevanceScores.reduce((a, b) => a + b, 0) / llmRelevanceScores.length,
          median:
            llmRelevanceScores.length > 0
              ? llmRelevanceScores.sort((a, b) => a - b)[Math.floor(llmRelevanceScores.length / 2)]
              : 0,
        },
        llmUsefulness: {
          histogram: computeHistogram(llmUsefulnessScores),
          min: Math.min(...llmUsefulnessScores),
          max: Math.max(...llmUsefulnessScores),
          mean: llmUsefulnessScores.reduce((a, b) => a + b, 0) / llmUsefulnessScores.length,
          median:
            llmUsefulnessScores.length > 0
              ? llmUsefulnessScores.sort((a, b) => a - b)[
                  Math.floor(llmUsefulnessScores.length / 2)
                ]
              : 0,
        },
        recency: {
          histogram: computeHistogram(recencyScores),
          min: Math.min(...recencyScores),
          max: Math.max(...recencyScores),
          mean: recencyScores.reduce((a, b) => a + b, 0) / recencyScores.length,
          median:
            recencyScores.length > 0
              ? recencyScores.sort((a, b) => a - b)[Math.floor(recencyScores.length / 2)]
              : 0,
        },
        final: {
          histogram: computeHistogram(finalScores),
          min: Math.min(...finalScores),
          max: Math.max(...finalScores),
          mean: finalScores.reduce((a, b) => a + b, 0) / finalScores.length,
          median:
            finalScores.length > 0
              ? finalScores.sort((a, b) => a - b)[Math.floor(finalScores.length / 2)]
              : 0,
        },
      };
    }

    if (showTopSources) {
      const sourceScores = new Map<string, number[]>();
      for (const item of rankedItems) {
        if (!sourceScores.has(item.sourceTitle)) {
          sourceScores.set(item.sourceTitle, []);
        }
        sourceScores.get(item.sourceTitle)!.push(item.finalScore);
      }

      const topSources = Array.from(sourceScores.entries())
        .map(([source, scores]) => ({
          source,
          itemCount: scores.length,
          avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
          maxScore: Math.max(...scores),
          minScore: Math.min(...scores),
        }))
        .sort((a, b) => b.avgScore - a.avgScore)
        .slice(0, 10);

      stats.topSources = topSources;
    }

    logger.info(
      `[ANALYTICS] Computed stats for ${category}: ${rankedItems.length} items analyzed`
    );

    return NextResponse.json(stats);
  } catch (error) {
    logger.error("[ANALYTICS] Error in /api/admin/analytics/scores", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to compute analytics",
      },
      { status: 400 }
    );
  }
}
