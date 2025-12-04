/**
 * API route: GET /api/ask
 * Answer questions using cached digest content with LLM
 */

import { NextRequest, NextResponse } from "next/server";
import { Category } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";
import { initializeDatabase } from "@/src/lib/db/index";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { semanticSearch } from "@/src/lib/pipeline/search";

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
 * Generate answer using Claude API
 */
async function generateAnswerWithClaude(
  question: string,
  contextItems: Array<{
    title: string;
    summary?: string;
    sourceTitle: string;
  }>
): Promise<string> {
  // For MVP, use a simple template-based answer
  // In production, call Claude API or other LLM
  
  const sources = contextItems
    .map((item) => `- "${item.title}" from ${item.sourceTitle}`)
    .join("\n");

  // Template-based answer (placeholder for LLM integration)
  const answer = `Based on the code intelligence digest, here's what I found related to "${question}":

Key sources discussing this topic:
${sources}

The digest contains ${contextItems.length} relevant items on this subject. For more details, review the sources above which cover aspects of code tooling, agents, code search, context management, and developer productivity.

Note: This is a template answer. For full reasoning, integrate with Claude API or preferred LLM.`;

  return answer;
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
    const { searchParams } = new URL(req.url);

    const question = searchParams.get("question");
    const category = searchParams.get("category") as Category | null;
    const period = searchParams.get("period") || "week";
    const limit = Math.min(parseInt(searchParams.get("limit") || "5"), 20);

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

    const periodDays = period === "month" ? 30 : 7;

    logger.info(
      `[ASK] Question: "${question}", category: ${category || "all"}, period: ${periodDays}d, limit: ${limit}`
    );

    // Initialize database
    await initializeDatabase();

    // Load items to use as context
    let contextItems = [];

    if (category) {
      // Use specific category for context
      const categoryItems = await loadItemsByCategory(category, periodDays);
      contextItems = categoryItems || [];
    } else {
      // Use all categories for context
      for (const cat of VALID_CATEGORIES) {
        const items = await loadItemsByCategory(cat, periodDays);
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

    // Find relevant items using semantic search
    const relevantItems = await semanticSearch(question, contextItems, limit);

    if (relevantItems.length === 0) {
      logger.warn(`[ASK] No relevant items found for question: "${question}"`);
      return NextResponse.json({
        question,
        answer:
          "While the digest contains content, I could not find items specifically related to your question.",
        sources: [],
        category: category || "all",
        period: periodDays === 7 ? "week" : "month",
        generatedAt: new Date().toISOString(),
      } as LLMAnswerResponse);
    }

    // Generate answer using LLM (context items)
    const sourceItems = contextItems.filter((item) =>
      relevantItems.some((rel) => rel.id === item.id)
    );

    const answer = await generateAnswerWithClaude(question, sourceItems);

    logger.info(
      `[ASK] Generated answer with ${relevantItems.length} source citations`
    );

    const response: LLMAnswerResponse = {
      question,
      answer,
      sources: relevantItems.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        sourceTitle: item.sourceTitle,
        relevance: item.similarity,
      })),
      category: category || "all",
      period: periodDays === 7 ? "week" : "month",
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error("[ASK] Error in /api/ask", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate answer",
      },
      { status: 500 }
    );
  }
}
