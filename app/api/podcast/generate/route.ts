/**
 * POST /api/podcast/generate
 * Generate a podcast episode from selected categories
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { loadItemsByCategory } from "@/src/lib/db/items";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { selectWithDiversity } from "@/src/lib/pipeline/select";
import { buildPromptProfile, PromptProfile } from "@/src/lib/pipeline/promptProfile";
import { rerankWithPrompt, filterByExclusions } from "@/src/lib/pipeline/promptRerank";
import { generatePodcastContent, PodcastSegment } from "@/src/lib/pipeline/podcast";
import { Category, FeedItem } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";

interface PodcastRequest {
  categories: string[];
  period: "week" | "month";
  limit: number;
  prompt?: string;
  format?: string;
  voiceStyle?: string;
}

interface PodcastResponse {
  id: string;
  title: string;
  generatedAt: string;
  categories: string[];
  period: string;
  duration: string;
  itemsRetrieved: number;
  itemsIncluded: number;
  transcript: string;
  segments: PodcastSegment[];
  showNotes: string;
  generationMetadata: {
    promptUsed: string;
    modelUsed: string;
    tokensUsed: number;
    voiceStyle: string;
    duration: string;
    promptProfile: PromptProfile | null;
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

const VOICE_STYLES = ["conversational", "technical", "executive"];

function validateRequest(body: unknown): { valid: boolean; error?: string; data?: PodcastRequest } {
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
  const limit = typeof req.limit === "number" ? req.limit : 15;
  if (limit < 1 || limit > 50) {
    return { valid: false, error: "limit must be between 1 and 50" };
  }

  // Validate voice style
  const voiceStyle = req.voiceStyle as string || "conversational";
  if (!VOICE_STYLES.includes(voiceStyle)) {
    return { valid: false, error: `voiceStyle must be one of: ${VOICE_STYLES.join(", ")}` };
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
      format: "transcript",
      voiceStyle,
    },
  };
}

export async function POST(request: NextRequest): Promise<NextResponse<PodcastResponse | { error: string }>> {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const validation = validateRequest(body);

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error! }, { status: 400 });
    }

    const req = validation.data!;
    const periodDays = req.period === "week" ? 7 : 30;

    logger.info(
      `Podcast request: categories=${req.categories.join(",")}, period=${req.period}, voice=${req.voiceStyle}, prompt="${(req.prompt || "").substring(0, 50)}..."`
    );

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

    if (req.prompt && req.prompt.length > 0) {
      profile = await buildPromptProfile(req.prompt);
      if (profile && profile.focusTopics.length > 0) {
        // Apply re-ranking
        mergedItems = rerankWithPrompt(mergedItems, profile);
        // Apply exclusions
        mergedItems = filterByExclusions(mergedItems, profile);
        logger.info(`Re-ranked with prompt profile: ${JSON.stringify(profile)}`);
      }
    }

    // Step 4: Diversity selection
    const maxPerSource = req.period === "week" ? 2 : 3;
    const selection = selectWithDiversity(mergedItems, req.categories[0] as Category, maxPerSource, 12);
    const selectedItems = selection.items;

    logger.info(`Selected ${selectedItems.length} items with diversity constraints`);

    // Step 5: Generate content
    const { transcript, segments, showNotes, estimatedDuration } = await generatePodcastContent(
      selectedItems,
      req.period,
      req.categories as Category[],
      profile,
      req.voiceStyle
    );

    // Build response
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const id = `pod-${uuid()}`;

    const response: PodcastResponse = {
      id,
      title: `Code Intelligence Weekly – Episode ${Math.floor(Math.random() * 100)}`,
      generatedAt: new Date().toISOString(),
      categories: req.categories,
      period: req.period,
      duration: estimatedDuration,
      itemsRetrieved: mergedItems.length,
      itemsIncluded: selectedItems.length,
      transcript,
      segments,
      showNotes,
      generationMetadata: {
        promptUsed: req.prompt || "",
        modelUsed: "gpt-4o-mini",
        tokensUsed: Math.ceil(transcript.split(/\s+/).length * 1.3), // Rough estimate: 1.3 tokens per word
        voiceStyle: req.voiceStyle!,
        duration: `${duration}s`,
        promptProfile: profile,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error("Podcast generation failed", { error });
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
