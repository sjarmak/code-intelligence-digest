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
import { generateNewsletterFromDigests } from "@/src/lib/pipeline/newsletter";
import { extractBatchDigests } from "@/src/lib/pipeline/extract";
import { Category, FeedItem, RankedItem } from "@/src/lib/model";
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
    // Check rate limits
    const { enforceRateLimit, recordUsage, checkRequestSize } = await import('@/src/lib/rate-limit');
    const rateLimitResponse = await enforceRateLimit(request, '/api/newsletter/generate');
    if (rateLimitResponse) {
      return rateLimitResponse as NextResponse<NewsletterResponse | { error: string }>;
    }

    const body = await request.json();
    const validation = validateRequest(body);

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error! }, { status: 400 });
    }

    const req = validation.data!;
    const periodDays = req.period === "week" ? 7 : 30;

    // Check request size limits
    const itemCount = req.categories.length * 50; // Rough estimate
    const sizeCheck = checkRequestSize('/api/newsletter/generate', itemCount);
    if (!sizeCheck.allowed) {
      return NextResponse.json({ error: sizeCheck.error || 'Request size too large' }, { status: 400 });
    }

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

    // Merge ALL ranked items from all categories (no pre-filtering)
    let mergedItems: RankedItem[] = [];
    for (const { items } of rankedPerCategory) {
      mergedItems.push(...items);
    }

    // Deduplicate by ID (keep highest-ranked)
    const deduped = new Map<string, RankedItem>();
    for (const item of mergedItems) {
      if (!deduped.has(item.id)) {
        deduped.set(item.id, item);
      }
    }
    mergedItems = Array.from(deduped.values());

    logger.info(`Retrieved ${mergedItems.length} candidate items from all categories`);

    // Step 3: Filter out oversized content FIRST (before selection)
    // Articles >50KB are likely newsletters, podcasts, or spam; skip them
    const maxContentLength = 50000; // 50KB threshold
    const beforeSizeFilter = mergedItems.length;
    mergedItems = mergedItems.filter((item) => {
      const contentLength = (item.fullText || item.summary || item.contentSnippet || "").length;
      if (contentLength > maxContentLength) {
        logger.info(`Filtering out oversized article: "${item.title}" (${contentLength} chars)`);
        return false;
      }
      return true;
    });
    logger.info(`Size filter: ${beforeSizeFilter} → ${mergedItems.length} items (removed ${beforeSizeFilter - mergedItems.length} oversized)`);

    // Step 4: Parse prompt and re-rank if needed
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

    // Step 5: Diversity selection with limit
    // Note: After extraction & decomposition, item count may increase.
    // Reduce pre-selection to account for newsletter decomposition (~1.3x expansion typical).
    // This ensures final digest count is close to requested limit.
    const maxPerSource = req.period === "week" ? 2 : 3;
    const decompositionFactor = 1.3; // Typical expansion from newsletter decomposition
    const adjustedLimit = Math.ceil(req.limit / decompositionFactor);
    const selection = selectWithDiversity(mergedItems, req.categories[0] as Category, maxPerSource, adjustedLimit);
    const selectedItems = selection.items;

    logger.info(`Selected ${selectedItems.length} items (adjusted limit: ${adjustedLimit}, requested: ${req.limit}) with diversity constraints`);

    // Log newsletter items being selected
    const selectedNewsletters = selectedItems.filter(item => item.sourceTitle.includes("TLDR") || item.sourceTitle.includes("Byte Byte Go") || item.sourceTitle.includes("Elevate") || item.sourceTitle.includes("Pointer"));
    if (selectedNewsletters.length > 0) {
      logger.info(`Selected ${selectedNewsletters.length} newsletter items: ${selectedNewsletters.slice(0, 3).map(i => i.title).join(", ")}`);
    }

    // Step 6: Extract item digests (Pass 1)
    const digests = await extractBatchDigests(selectedItems, req.prompt || "");
    logger.info(`Extracted ${digests.length} item digests from ${selectedItems.length} selected items`);

    // Filter out digests without valid URLs before synthesis
    const validDigests = digests.filter(digest => {
      const hasValidUrl = digest.url &&
                         (digest.url.startsWith("http://") || digest.url.startsWith("https://")) &&
                         !digest.url.includes("inoreader.com");
      if (!hasValidUrl) {
        logger.warn(`Excluding digest without valid URL: "${digest.title}" (url: "${digest.url}" source: "${digest.sourceTitle}")`);
      }
      return hasValidUrl;
    });
    logger.info(`URL filter: ${digests.length} → ${validDigests.length} digests (removed ${digests.length - validDigests.length} without valid URLs)`);

    // Critical: Track count discrepancy
    if (validDigests.length !== selectedItems.length) {
      logger.warn(`Item count mismatch: selected ${selectedItems.length}, extracted ${digests.length}, valid ${validDigests.length}`);
    }

    // Step 7: Synthesize newsletter from digests (Pass 2)
    const { summary, themes, markdown, html } = await generateNewsletterFromDigests(
      validDigests,
      req.period,
      req.categories as Category[],
      profile,
      req.prompt
    );

    // Build response
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const id = `nl-${uuid()}`;

    // Record successful usage
    await recordUsage(request, '/api/newsletter/generate');

    const response: NewsletterResponse = {
      id,
      title: `Code Intelligence Digest – ${req.period === "week" ? "Week" : "Month"} of ${new Date().toLocaleDateString()}`,
      generatedAt: new Date().toISOString(),
      categories: req.categories,
      period: req.period,
      itemsRetrieved: mergedItems.length,
      itemsIncluded: validDigests.length,
      summary,
      markdown,
      html,
      themes,
      generationMetadata: {
        promptUsed: req.prompt || "",
        modelUsed: "gpt-4o-mini (extraction + synthesis)",
        tokensUsed: Math.ceil(selectedItems.length * 300 + 3000), // Extraction + synthesis estimate
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
