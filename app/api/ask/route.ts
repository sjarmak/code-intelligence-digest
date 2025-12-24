/**
 * API route: GET /api/ask
 * Answer questions using cached digest content with LLM
 */

import { NextRequest, NextResponse } from "next/server";
import { Category } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { retrieveRelevantItems } from "@/src/lib/pipeline/retrieval";
import { generateAnswer } from "@/src/lib/pipeline/answer";

const VALID_CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "product_news",
  "community",
  "research",
];

interface LLMAnswerResponse {
  question: string;
  answer: string;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    sourceTitle: string;
    relevance: number;
  }>;
  category?: string;
  period: string;
  generatedAt: string;
}

/**
 * GET /api/ask?question=How+do+code+agents+handle+context?&category=research&period=week&limit=5
 *
 * Query parameters:
 * - question (required): Question to answer
 * - category (optional): Restrict context to specific category
 * - period (optional): "week" or "month" (default: "week")
 * - limit (optional): Max source items (default: 5, max: 20)
 */
export async function GET(req: NextRequest) {
  try {
    // Check rate limits (gracefully handle if table doesn't exist)
    let rateLimitResponse = null;
    try {
      const { enforceRateLimit, recordUsage } = await import('@/src/lib/rate-limit');
      rateLimitResponse = await enforceRateLimit(req, '/api/ask');
      if (rateLimitResponse) {
        return rateLimitResponse;
      }
    } catch (rateLimitError) {
      // If rate limiting fails (e.g., table doesn't exist), log but continue
      logger.warn('[ASK] Rate limit check failed, continuing without rate limit', { error: rateLimitError });
    }

    const { searchParams } = new URL(req.url);

    const question = searchParams.get("question");
    const category = searchParams.get("category") as Category | null;
    const period = searchParams.get("period") || "week";
    const limit = Math.min(parseInt(searchParams.get("limit") || "5"), 20);
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");

    // Validate required parameters
    if (!question || question.trim().length === 0) {
      return NextResponse.json(
        { error: "Question (question parameter) is required" },
        { status: 400 }
      );
    }

    // Validate category if provided
    if (category && !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        {
          error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Map period to days or handle custom range
    const periodDaysMap: Record<string, number> = {
      day: 1,
      week: 7,
      month: 30,
      all: 90,
    };

    let periodDays: number;
    let loadOptions: { startDate?: Date; endDate?: Date } | undefined;

    if (period === "custom") {
      if (!startDateParam || !endDateParam) {
        return NextResponse.json(
          { error: "Custom period requires startDate and endDate parameters" },
          { status: 400 }
        );
      }
      const startDate = new Date(startDateParam);
      const endDate = new Date(endDateParam);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return NextResponse.json(
          { error: "Invalid date format. Use YYYY-MM-DD" },
          { status: 400 }
        );
      }
      if (startDate > endDate) {
        return NextResponse.json(
          { error: "Start date must be before end date" },
          { status: 400 }
        );
      }
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      loadOptions = { startDate, endDate };
      periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    } else {
      periodDays = periodDaysMap[period] || 7;
    }

    logger.info(
      `[ASK] Question: "${question}", category: ${category || "all"}, period: ${periodDays}d, limit: ${limit}`
    );

    // Initialize database
    await initializeDatabase();

    // Load items to use as context
    let contextItems = [];

    if (category) {
      // Use specific category for context
      const categoryItems = await loadItemsByCategory(category, periodDays, loadOptions);
      contextItems = categoryItems || [];
    } else {
      // Use all categories for context
      for (const cat of VALID_CATEGORIES) {
        const items = await loadItemsByCategory(cat, periodDays, loadOptions);
        if (items && items.length > 0) {
          contextItems.push(...items);
        }
      }
    }

    if (contextItems.length === 0) {
      logger.warn(`[ASK] No context items found for question: "${question}"`);
      return NextResponse.json({
        question,
        answer:
          "I could not find relevant content in the digest to answer this question. Please try a different question or adjust your time period.",
        sources: [],
        category: category || "all",
        period: periodDays === 7 ? "week" : "month",
        generatedAt: new Date().toISOString(),
      } as LLMAnswerResponse);
    }

    logger.info(`[ASK] Using ${contextItems.length} context items`);

    // Use retrieval pipeline to find relevant items
    const targetCategory = category || "newsletters"; // Default for retrieval
    const rankedItems = await retrieveRelevantItems(
      question,
      contextItems,
      targetCategory as Category,
      periodDays,
      limit
    );

    if (rankedItems.length === 0) {
      logger.warn(`[ASK] No relevant items found for question: "${question}"`);
      return NextResponse.json({
        question,
        answer:
          "While the digest contains content, I could not find items specifically related to your question.",
        sources: [],
        category: category || "all",
        period: Object.entries(periodDaysMap).find(([, v]) => v === periodDays)?.[0] || "week",
        generatedAt: new Date().toISOString(),
      } as LLMAnswerResponse);
    }

    // Generate answer using retrieved items
    let answerResult;
    try {
      answerResult = await generateAnswer(question, rankedItems);
      logger.info(`[ASK] Generated answer with ${rankedItems.length} source citations`);
    } catch (answerError) {
      logger.error('[ASK] Failed to generate answer', { error: answerError });
      throw new Error(`Failed to generate answer: ${answerError instanceof Error ? answerError.message : 'Unknown error'}`);
    }

    // Map period back to string
    const periodName =
      Object.entries(periodDaysMap).find(([, v]) => v === periodDays)?.[0] || "week";

    const response: LLMAnswerResponse = {
      question,
      answer: answerResult.answer,
      sources: answerResult.sources.map((source) => ({
        id: source.id,
        title: source.title,
        url: source.url,
        sourceTitle: rankedItems.find((item) => item.id === source.id)?.sourceTitle || "Unknown",
        relevance: source.relevance,
      })),
      category: category || "all",
      period: periodName,
      generatedAt: answerResult.generatedAt,
    };

    // Record successful usage (gracefully handle errors)
    try {
      const { recordUsage } = await import('@/src/lib/rate-limit');
      await recordUsage(req, '/api/ask');
    } catch (usageError) {
      logger.warn('[ASK] Failed to record usage', { error: usageError });
      // Don't fail the request if usage tracking fails
    }

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to generate answer";
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error("[ASK] Error in /api/ask", {
      error: errorMessage,
      stack: errorStack,
    });

    // Return more detailed error information
    return NextResponse.json(
      {
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}
