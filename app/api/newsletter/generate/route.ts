/**
 * POST /api/newsletter/generate
 * Generate a newsletter from selected categories
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { selectWithDiversity } from "@/src/lib/pipeline/select";
import { buildPromptProfile, PromptProfile } from "@/src/lib/pipeline/promptProfile";
import { rerankWithPrompt, filterByExclusions } from "@/src/lib/pipeline/promptRerank";
import { generateNewsletterContent } from "@/src/lib/pipeline/newsletter";
import { Category, FeedItem } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";

interface NewsletterRequest {
  categories: string[];
  period: "week" | "month";
  limit: number;
  prompt?: string;
}

interface NewsletterResponse {
  id: string;
  title: string;
  generatedAt: string;
  categories: string[];
  period: string;
  itemsRetrieved: number;
  itemsIncluded: number;
  summary: string;
  markdown: string;
  html: string;
  themes: string[];
  generationMetadata: {
    promptUsed: string;
    modelUsed: string;
    tokensUsed: number;
    duration: string;
    promptProfile: PromptProfile | null;
    rerankApplied: boolean;
  };
}

const ALLOWED_CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "product_news",
  "community",
  "research",
];

function validateRequest(body: unknown): { valid: boolean; error?: string; data?: NewsletterRequest } {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "Request body must be JSON object" };
  }

  const req = body as Record<string, unknown>;

  // Validate categories
  if (!Array.isArray(req.categories) || req.categories.length === 0) {
    return { valid: false, error: "categories must be non-empty array" };
  }

  const categories = req.categories as string[];
  for (const cat of categories) {
    if (!ALLOWED_CATEGORIES.includes(cat as Category)) {
      return { valid: false, error: `Invalid category: ${cat}` };
    }
  }

  // Validate period
  const period = req.period as string;
  if (!["week", "month"].includes(period)) {
    return { valid: false, error: 'period must be "week" or "month"' };
  }

  // Validate limit
  const limit = typeof req.limit === "number" ? req.limit : 20;
  if (limit < 1 || limit > 50) {
    return { valid: false, error: "limit must be between 1 and 50" };
  }

  // Normalize prompt
  const prompt = typeof req.prompt === "string" ? req.prompt.trim() : "";

  return {
    valid: true,
    data: {
      categories: categories as Category[],
      period: period as "week" | "month",
      limit,
      prompt,
    },
  };
}

export async function POST(request: NextRequest): Promise<NextResponse<NewsletterResponse | { error: string }>> {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const validation = validateRequest(body);

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error! }, { status: 400 });
    }

    const req = validation.data!;
    const periodDays = req.period === "week" ? 7 : 30;

    logger.info(`Newsletter request: categories=${req.categories.join(",")}, period=${req.period}, prompt="${(req.prompt || "").substring(0, 50)}..."`);

    // Step 1: Retrieve candidates
    const allItems: FeedItem[] = [];
    for (const category of req.categories) {
      const items = await loadItemsByCategory(category, periodDays);
      allItems.push(...items);
    }

    // Step 2: Rank candidates
    const rankedPerCategory = await Promise.all(
      req.categories.map(async (category) => {
        const categoryItems = allItems.filter((item) => item.category === category);
        const ranked = await rankCategory(categoryItems, category as Category, periodDays);
        return { category, items: ranked };
      })
    );

    // Merge and take top candidates per category
    let mergedItems = [];
    for (const { items } of rankedPerCategory) {
      mergedItems.push(...items.slice(0, req.limit * 3));
    }

    // Deduplicate by ID
    const deduped = new Map();
    for (const item of mergedItems) {
      if (!deduped.has(item.id)) {
        deduped.set(item.id, item);
      }
    }
    mergedItems = Array.from(deduped.values());

    logger.info(`Retrieved ${mergedItems.length} candidate items`);

    // Step 3: Parse prompt and re-rank if needed
    let profile: PromptProfile | null = null;
    let rerankApplied = false;

    if (req.prompt && req.prompt.length > 0) {
      profile = await buildPromptProfile(req.prompt);
      if (profile && profile.focusTopics.length > 0) {
        // Apply re-ranking
        mergedItems = rerankWithPrompt(mergedItems, profile);
        // Apply exclusions
        mergedItems = filterByExclusions(mergedItems, profile);
        rerankApplied = true;
        logger.info(`Re-ranked with prompt profile: ${JSON.stringify(profile)}`);
      }
    }

    // Step 4: Diversity selection
    const maxPerSource = req.period === "week" ? 2 : 3;
    const selection = selectWithDiversity(mergedItems, req.categories[0] as Category, maxPerSource, 15);
    const selectedItems = selection.items;

    logger.info(`Selected ${selectedItems.length} items with diversity constraints`);

    // Step 5: Generate content
    const { summary, themes, markdown, html } = await generateNewsletterContent(
      selectedItems,
      req.period,
      req.categories as Category[],
      profile
    );

    // Build response
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const id = `nl-${uuid()}`;

    const response: NewsletterResponse = {
      id,
      title: `Code Intelligence Digest – ${req.period === "week" ? "Week" : "Month"} of ${new Date().toLocaleDateString()}`,
      generatedAt: new Date().toISOString(),
      categories: req.categories,
      period: req.period,
      itemsRetrieved: mergedItems.length,
      itemsIncluded: selectedItems.length,
      summary,
      markdown,
      html,
      themes,
      generationMetadata: {
        promptUsed: req.prompt || "",
        modelUsed: "gpt-4o-mini",
        tokensUsed: Math.ceil(selectedItems.length * 250), // Rough estimate
        duration: `${duration}s`,
        promptProfile: profile,
        rerankApplied,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error("Newsletter generation failed", { error });
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
