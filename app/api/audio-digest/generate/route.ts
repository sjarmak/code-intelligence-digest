/**
 * POST /api/audio-digest/generate
 * Generate an audio digest from selected categories
 * Reads out salient highlights from articles and research papers
 * Uses custom ranking without recency to prioritize relevance
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { loadItemsByCategory, loadItemsByCategoryWithDateRange } from "@/src/lib/db/items";
import { rankCategoryWithoutRecency } from "@/src/lib/pipeline/rank";
import { selectWithDiversity } from "@/src/lib/pipeline/select";
import { buildPromptProfile, PromptProfile } from "@/src/lib/pipeline/promptProfile";
import { rerankWithPrompt, filterByExclusions } from "@/src/lib/pipeline/promptRerank";
import {
  extractArticleHighlights,
  extractPaperHighlights,
  generateAudioDigestTranscript,
  generateShowNotes,
  type ItemWithHighlights,
  type AudioDigestContent,
} from "@/src/lib/pipeline/audioDigest";
import { Category, FeedItem, RankedItem } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";

const ALLOWED_CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "product_news",
  "community",
  "research",
];

interface AudioDigestRequest {
  sourceMode: "auto" | "manual" | "categories";
  categories?: string[];
  period?: "week" | "month" | "all" | "custom";
  limit?: number;
  selectedItemIds?: string[];
  prompt?: string;
  duration?: number; // Duration in minutes (15-120)
  customDateRange?: {
    startDate: string;
    endDate: string;
  };
}

interface AudioDigestSegmentResponse {
  title: string;
  startTime: string;
  endTime: string;
  duration: number;
  itemsReferenced: Array<{
    id: string;
    title: string;
    url: string;
    sourceTitle: string;
  }>;
  highlights: string[];
}

interface AudioDigestResponse {
  id: string;
  title: string;
  generatedAt: string;
  categories: string[];
  period: string;
  duration: string;
  itemsRetrieved: number;
  itemsIncluded: number;
  transcript: string;
  segments: AudioDigestSegmentResponse[];
  showNotes: string;
  generationMetadata: {
    promptUsed: string;
    modelUsed: string;
    duration: string;
    promptProfile: PromptProfile | null;
  };
}

function validateRequest(body: unknown): { valid: boolean; error?: string; data?: AudioDigestRequest } {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "Request body must be JSON object" };
  }

  const req = body as Record<string, unknown>;

  // Validate sourceMode
  const sourceMode = req.sourceMode as string;
  if (!sourceMode || !["auto", "manual", "categories"].includes(sourceMode)) {
    return { valid: false, error: 'sourceMode must be "auto", "manual", or "categories"' };
  }

  // Validate duration (15-120 minutes)
  const duration = typeof req.duration === "number" ? req.duration : 30;
  if (duration < 15 || duration > 120) {
    return { valid: false, error: "duration must be between 15 and 120 minutes" };
  }

  // Normalize prompt
  const prompt = typeof req.prompt === "string" ? req.prompt.trim() : "";

  const data: AudioDigestRequest = {
    sourceMode: sourceMode as "auto" | "manual" | "categories",
    prompt: prompt || undefined,
    duration,
  };

  if (sourceMode === "categories") {
    // Categories mode: validate categories, period, limit (required)
    if (!Array.isArray(req.categories) || req.categories.length === 0) {
      return { valid: false, error: "categories must be a non-empty array in categories mode" };
    }
    const categories = req.categories as string[];
    for (const cat of categories) {
      if (!ALLOWED_CATEGORIES.includes(cat as Category)) {
        return { valid: false, error: `Invalid category: ${cat}` };
      }
    }

    const period = req.period as string;
    if (!["week", "month", "all", "custom"].includes(period)) {
      return { valid: false, error: 'period must be one of: "week", "month", "all", "custom" in categories mode' };
    }

    // Validate custom date range if period is custom
    if (period === "custom") {
      const customRange = req.customDateRange as { startDate?: string; endDate?: string } | undefined;
      if (!customRange || !customRange.startDate || !customRange.endDate) {
        return { valid: false, error: 'customDateRange with startDate and endDate is required when period is "custom"' };
      }
      const startDate = new Date(customRange.startDate);
      const endDate = new Date(customRange.endDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return { valid: false, error: "Invalid date format in customDateRange" };
      }
      if (startDate > endDate) {
        return { valid: false, error: "startDate must be before endDate" };
      }
      if (endDate > new Date()) {
        return { valid: false, error: "endDate cannot be in the future" };
      }
    }

    const limit = typeof req.limit === "number" ? req.limit : 50;
    if (limit < 1 || limit > 100) {
      return { valid: false, error: "limit must be between 1 and 100" };
    }

    data.categories = categories as Category[];
    data.period = period as "week" | "month" | "all" | "custom";
    data.limit = limit;

    if (period === "custom" && req.customDateRange) {
      data.customDateRange = {
        startDate: (req.customDateRange as { startDate: string; endDate: string }).startDate,
        endDate: (req.customDateRange as { startDate: string; endDate: string }).endDate,
      };
    }
  } else if (sourceMode === "auto") {
    // Auto mode: using digest library, categories/period/limit are optional (not used for filtering)
    // Only validate if provided
    if (req.categories !== undefined) {
      if (!Array.isArray(req.categories) || req.categories.length === 0) {
        return { valid: false, error: "categories must be a non-empty array if provided" };
      }
      const categories = req.categories as string[];
      for (const cat of categories) {
        if (!ALLOWED_CATEGORIES.includes(cat as Category)) {
          return { valid: false, error: `Invalid category: ${cat}` };
        }
      }
      data.categories = categories as Category[];
    }

    if (req.period !== undefined) {
      const period = req.period as string;
      if (!["week", "month", "all", "custom"].includes(period)) {
        return { valid: false, error: 'period must be one of: "week", "month", "all", "custom" if provided' };
      }
      data.period = period as "week" | "month" | "all" | "custom";

      // Validate custom date range if period is custom
      if (period === "custom") {
        const customRange = req.customDateRange as { startDate?: string; endDate?: string } | undefined;
        if (!customRange || !customRange.startDate || !customRange.endDate) {
          return { valid: false, error: 'customDateRange with startDate and endDate is required when period is "custom"' };
        }
        const startDate = new Date(customRange.startDate);
        const endDate = new Date(customRange.endDate);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return { valid: false, error: "Invalid date format in customDateRange" };
        }
        if (startDate > endDate) {
          return { valid: false, error: "startDate must be before endDate" };
        }
        if (endDate > new Date()) {
          return { valid: false, error: "endDate cannot be in the future" };
        }
        data.customDateRange = {
          startDate: customRange.startDate,
          endDate: customRange.endDate,
        };
      }
    }

    if (req.limit !== undefined) {
      const limit = typeof req.limit === "number" ? req.limit : 50;
      if (limit < 1 || limit > 100) {
        return { valid: false, error: "limit must be between 1 and 100" };
      }
      data.limit = limit;
    }
  } else {
    // Manual mode: validate selectedItemIds
    if (!Array.isArray(req.selectedItemIds) || req.selectedItemIds.length === 0) {
      return { valid: false, error: "selectedItemIds must be non-empty array in manual mode" };
    }

    const selectedItemIds = req.selectedItemIds as string[];
    for (const id of selectedItemIds) {
      if (typeof id !== "string") {
        return { valid: false, error: "All selectedItemIds must be strings" };
      }
    }

    data.selectedItemIds = selectedItemIds;
  }

  return {
    valid: true,
    data,
  };
}

/**
 * Helper function to deduplicate by URL
 */
function deduplicateByUrl(rankedItems: RankedItem[]): RankedItem[] {
  const seenUrls = new Map<string, string>();
  const deduped: RankedItem[] = [];

  for (const item of rankedItems) {
    try {
      const urlObj = new URL(item.url);
      const urlKey = urlObj.hostname + urlObj.pathname;

      if (!seenUrls.has(urlKey)) {
        seenUrls.set(urlKey, item.id);
        deduped.push(item);
      }
    } catch {
      // If URL parsing fails, include the item anyway
      deduped.push(item);
    }
  }

  return deduped;
}

/**
 * Select items based on duration target
 * Calculates target word count and selects items until duration target is reached
 */
function selectItemsForDuration(
  items: RankedItem[],
  targetDurationMinutes: number,
  maxItems: number
): RankedItem[] {
  // Calculate target word count: durationMinutes * 150 words/minute
  const targetWordCount = targetDurationMinutes * 150;

  // Estimate words per item when reading highlights directly
  // Each item has 3-5 highlights, each highlight is ~50-100 words when read out
  // Plus intro, transitions, attributions - estimate ~200-300 words per item when reading
  // Be very conservative - LLM tends to condense significantly, so estimate much lower
  const avgWordsPerItem = 120; // Very conservative estimate when reading highlights

  // Calculate how many items we need, with a massive buffer (3x) to ensure we hit target
  // The LLM tends to condense heavily, so we need way more items than mathematically needed
  const estimatedItemsNeeded = Math.ceil((targetWordCount / avgWordsPerItem) * 3.0);
  const itemsToSelect = Math.min(estimatedItemsNeeded, maxItems, items.length);

  logger.info(`Duration-based selection: target=${targetDurationMinutes}min (${targetWordCount} words), selecting ${itemsToSelect} items (estimated ${Math.round(itemsToSelect * avgWordsPerItem)} words, with 3x buffer to account for LLM condensation)`);

  return items.slice(0, itemsToSelect);
}

/**
 * Helper to send SSE event
 */
function sendSSEEvent(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  const encoder = new TextEncoder();
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(message));
}

/**
 * Stream audio digest generation with SSE progress updates
 */
async function streamAudioDigestGeneration(
  req: AudioDigestRequest,
  startTime: number
): Promise<NextResponse<AudioDigestResponse | { error: string }>> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        sendSSEEvent(controller, "progress", { message: "Starting audio digest generation...", step: "init" });

        // Step 1: Retrieve candidates
        let allItems: FeedItem[] = [];
        let mergedItems: RankedItem[] = [];

        sendSSEEvent(controller, "progress", { message: "Loading items...", step: "loading" });

        if (req.sourceMode === "auto") {
          const { getDigestItems } = await import("@/src/lib/db/digestItems");
          allItems = await getDigestItems();
          sendSSEEvent(controller, "progress", {
            message: `Loaded ${allItems.length} items from digest library`,
            step: "loading",
            count: allItems.length
          });

          const MAX_ITEMS_PER_CATEGORY = 500;
          const preFilteredItems: FeedItem[] = [];
          const categories = [...new Set(allItems.map(item => item.category))];

          for (const category of categories) {
            const categoryItems = allItems.filter((item) => item.category === category);
            const sorted = categoryItems.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
            const limited = sorted.slice(0, MAX_ITEMS_PER_CATEGORY);
            preFilteredItems.push(...limited);
          }

          sendSSEEvent(controller, "progress", {
            message: `Ranking items across ${categories.length} categories...`,
            step: "ranking"
          });

          const periodDays = 90;
          const rankedPerCategory = await Promise.all(
            categories.map(async (category) => {
              const categoryItems = preFilteredItems.filter((item) => item.category === category);
              const ranked = await rankCategoryWithoutRecency(categoryItems, category as Category, periodDays, "all");
              return { category, items: ranked };
            })
          );

          for (const { items } of rankedPerCategory) {
            mergedItems.push(...items);
          }

          const deduped = new Map<string, RankedItem>();
          for (const item of mergedItems) {
            if (!deduped.has(item.id)) {
              deduped.set(item.id, item);
            }
          }
          mergedItems = Array.from(deduped.values());
        } else if (req.sourceMode === "categories") {
          if (!req.categories || !req.period) {
            sendSSEEvent(controller, "error", { error: "categories and period are required in categories mode" });
            controller.close();
            return;
          }

          let periodDays: number;
          let startDate: Date | undefined;
          let endDate: Date | undefined;

          if (req.period === "custom" && req.customDateRange) {
            startDate = new Date(req.customDateRange.startDate);
            endDate = new Date(req.customDateRange.endDate);
            periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
          } else {
            periodDays = req.period === "week" ? 7 : req.period === "month" ? 30 : 90;
          }

          for (const category of req.categories) {
            let categoryItems: FeedItem[];
            if (req.period === "custom" && startDate && endDate) {
              categoryItems = await loadItemsByCategoryWithDateRange(category as Category, startDate, endDate);
            } else {
              categoryItems = await loadItemsByCategory(category as Category, periodDays);
            }
            allItems.push(...categoryItems);
          }

          sendSSEEvent(controller, "progress", {
            message: `Loaded ${allItems.length} items, ranking...`,
            step: "ranking",
            count: allItems.length
          });

          const MAX_ITEMS_PER_CATEGORY = 500;
          const preFilteredItems: FeedItem[] = [];
          for (const category of req.categories) {
            const categoryItems = allItems.filter((item) => item.category === category);
            const sorted = categoryItems.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
            const limited = sorted.slice(0, MAX_ITEMS_PER_CATEGORY);
            preFilteredItems.push(...limited);
          }

          const rankedPerCategory = await Promise.all(
            req.categories.map(async (category) => {
              const categoryItems = preFilteredItems.filter((item) => item.category === category);
              const ranked = await rankCategoryWithoutRecency(categoryItems, category as Category, periodDays, req.period || "all");
              return { category, items: ranked };
            })
          );

          for (const { items } of rankedPerCategory) {
            mergedItems.push(...items);
          }

          const deduped = new Map<string, RankedItem>();
          for (const item of mergedItems) {
            if (!deduped.has(item.id)) {
              deduped.set(item.id, item);
            }
          }
          mergedItems = Array.from(deduped.values());
        } else {
          const { loadItem } = await import("@/src/lib/db/items");
          for (const itemId of req.selectedItemIds || []) {
            const item = await loadItem(itemId);
            if (item) {
              allItems.push(item);
            }
          }
          mergedItems = allItems.map((item) => ({
            ...item,
            bm25Score: 0,
            llmScore: { relevance: 0, usefulness: 0, tags: [] },
            recencyScore: 0,
            finalScore: 1,
            reasoning: "Selected from saved items library",
          }));
        }

        sendSSEEvent(controller, "progress", {
          message: `Retrieved ${mergedItems.length} candidate items`,
          step: "ranking",
          count: mergedItems.length
        });

        // Step 3: Parse prompt and re-rank if needed
        let profile: PromptProfile | null = null;
        if (req.prompt && req.prompt.length > 0) {
          sendSSEEvent(controller, "progress", { message: "Analyzing prompt...", step: "rerank" });
          profile = await buildPromptProfile(req.prompt);
          if (profile && profile.focusTopics.length > 0) {
            mergedItems = rerankWithPrompt(mergedItems, profile);
            mergedItems = filterByExclusions(mergedItems, profile);
          }
        }

        // Step 4: Select items
        const deduplicatedItems = deduplicateByUrl(mergedItems);
        deduplicatedItems.sort((a, b) => b.finalScore - a.finalScore);
        // For auto (digest library) and manual modes, use ALL items. For categories mode, use the requested limit.
        const limit = req.sourceMode === "manual" || req.sourceMode === "auto" ? mergedItems.length : (req.limit || 50);
        const selectedItems = selectItemsForDuration(deduplicatedItems, req.duration || 30, limit);

        sendSSEEvent(controller, "progress", {
          message: `Selected ${selectedItems.length} items for ${req.duration || 30} minute digest`,
          step: "selection",
          count: selectedItems.length
        });

        // Step 5: Extract highlights
        sendSSEEvent(controller, "progress", {
          message: `Extracting highlights from ${selectedItems.length} items...`,
          step: "highlights"
        });
        const itemsWithHighlights: ItemWithHighlights[] = [];
        const BATCH_SIZE = 5;
        const totalBatches = Math.ceil(selectedItems.length / BATCH_SIZE);

        for (let i = 0; i < selectedItems.length; i += BATCH_SIZE) {
          const batch = selectedItems.slice(i, i + BATCH_SIZE);
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;

          sendSSEEvent(controller, "progress", {
            message: `Processing batch ${batchNum}/${totalBatches} (${batch.length} items)`,
            step: "highlights",
            progress: Math.round((batchNum / totalBatches) * 50) // 0-50% for highlights
          });

          const batchResults = await Promise.allSettled(
            batch.map(async (item) => {
              try {
                let highlights;
                if (item.category === "research") {
                  sendSSEEvent(controller, "progress", {
                    message: `Chunking paper full text: ${item.title.substring(0, 60)}...`,
                    step: "highlights"
                  });
                  highlights = await extractPaperHighlights(item, req.prompt || "");
                } else {
                  highlights = await extractArticleHighlights(item, req.prompt || "");
                }

                if (highlights.length > 0) {
                  return { item, highlights } as ItemWithHighlights;
                }
                return null;
              } catch (error) {
                logger.warn(`Failed to extract highlights for item "${item.title}"`, {
                  error: error instanceof Error ? error.message : String(error),
                  itemId: item.id,
                });
                return null;
              }
            })
          );

          for (const result of batchResults) {
            if (result.status === "fulfilled" && result.value) {
              itemsWithHighlights.push(result.value);
            }
          }
        }

        if (itemsWithHighlights.length === 0) {
          sendSSEEvent(controller, "error", { error: "No items with highlights available" });
          controller.close();
          return;
        }

        sendSSEEvent(controller, "progress", {
          message: `Extracted highlights from ${itemsWithHighlights.length} items`,
          step: "highlights",
          count: itemsWithHighlights.length
        });

        // Step 6: Generate transcript
        sendSSEEvent(controller, "progress", {
          message: "Generating audio digest transcript...",
          step: "transcript",
          progress: 75
        });
        const content: AudioDigestContent = await generateAudioDigestTranscript(
          itemsWithHighlights,
          req.period || "all",
          (req.categories as Category[]) || [],
          req.prompt || "",
          req.duration || 30
        );

        sendSSEEvent(controller, "progress", {
          message: `Generated transcript with ${content.segments.length} segments`,
          step: "transcript",
          progress: 95
        });

        const endTime = Date.now();
        const generationTime = ((endTime - startTime) / 1000).toFixed(2);

        // Record usage (skip for streaming as it's handled in main POST)

        const response: AudioDigestResponse = {
          id: uuid(),
          title: req.sourceMode === "manual"
            ? `Audio Digest - Curated Selection`
            : req.sourceMode === "auto"
            ? `Audio Digest - Digest Library`
            : `Audio Digest - ${req.period || "all"}`,
          generatedAt: new Date().toISOString(),
          categories: req.categories || [],
          period: req.period || "all",
          duration: content.estimatedDuration,
          itemsRetrieved: mergedItems.length,
          itemsIncluded: itemsWithHighlights.length,
          transcript: content.transcript,
          segments: content.segments.map((seg) => ({
            title: seg.title,
            startTime: seg.startTime,
            endTime: seg.endTime,
            duration: seg.duration,
            itemsReferenced: seg.itemsReferenced,
            highlights: seg.highlights,
          })),
          showNotes: content.showNotes,
          generationMetadata: {
            promptUsed: req.prompt || "",
            modelUsed: "gpt-4o-mini",
            duration: `${generationTime}s`,
            promptProfile: profile,
          },
        };

        logger.info("Sending complete event via SSE", {
          id: response.id,
          title: response.title,
          duration: response.duration,
          itemsIncluded: response.itemsIncluded,
          transcriptLength: response.transcript.length
        });

        sendSSEEvent(controller, "complete", response);
        controller.close();
      } catch (error) {
        logger.error("Audio digest generation failed", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        sendSSEEvent(controller, "error", {
          error: error instanceof Error ? error.message : "Internal server error"
        });
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse<AudioDigestResponse | { error: string }>> {
  const startTime = Date.now();

  // Check if client wants streaming (SSE)
  const url = new URL(request.url);
  const useStreaming = url.searchParams.get('stream') === 'true';

  try {
    // Check rate limits
    const { enforceRateLimit, recordUsage, checkRequestSize } = await import('@/src/lib/rate-limit');
    const rateLimitResponse = await enforceRateLimit(request, '/api/audio-digest/generate');
    if (rateLimitResponse) {
      return rateLimitResponse as NextResponse<AudioDigestResponse | { error: string }>;
    }

    const body = await request.json();
    const validation = validateRequest(body);

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error! }, { status: 400 });
    }

    const req = validation.data!;

    // If streaming requested, return SSE stream
    if (useStreaming) {
      return streamAudioDigestGeneration(req, startTime);
    }

    logger.info(
      `Audio digest request: sourceMode=${req.sourceMode}, ${req.sourceMode === "categories" ? `categories=${req.categories?.join(",")}, period=${req.period}` : req.sourceMode === "auto" ? `digest library` : `selectedItemIds=${req.selectedItemIds?.length} items`}, duration=${req.duration}min, prompt="${(req.prompt || "").substring(0, 50)}..."`
    );

    // Step 1: Retrieve candidates
    let allItems: FeedItem[] = [];
    let mergedItems: RankedItem[] = [];

    if (req.sourceMode === "auto") {
      // Auto mode: load from digest_items
      // In source mode, do NOT filter by category/period - use all items from digest library
      const { getDigestItems } = await import("@/src/lib/db/digestItems");
      allItems = await getDigestItems();
      logger.info(`Loaded ${allItems.length} items from digest library (no category/period filtering in source mode)`);

      // Pre-filter to prevent OOM (sort by date, limit per category)
      const MAX_ITEMS_PER_CATEGORY = 500;
      const preFilteredItems: FeedItem[] = [];
      const categories = [...new Set(allItems.map(item => item.category))];

      for (const category of categories) {
        const categoryItems = allItems.filter((item) => item.category === category);
        const sorted = categoryItems.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
        const limited = sorted.slice(0, MAX_ITEMS_PER_CATEGORY);
        preFilteredItems.push(...limited);
      }

      // Step 2: Rank using custom ranking WITHOUT RECENCY
      // Use a default periodDays for ranking purposes (doesn't affect filtering)
      const periodDays = 90; // Default to all-time for ranking

      const rankedPerCategory = await Promise.all(
        categories.map(async (category) => {
          const categoryItems = preFilteredItems.filter((item) => item.category === category);
          const ranked = await rankCategoryWithoutRecency(categoryItems, category as Category, periodDays, "all");
          return { category, items: ranked };
      })
      );

      // Merge ALL ranked items from all categories
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
    } else if (req.sourceMode === "categories") {
      // Categories mode: load items by category and period from database
      if (!req.categories || !req.period) {
        return NextResponse.json({ error: "categories and period are required in categories mode" }, { status: 400 });
      }

      let periodDays: number;
      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (req.period === "custom" && req.customDateRange) {
        startDate = new Date(req.customDateRange.startDate);
        endDate = new Date(req.customDateRange.endDate);
        periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
      } else {
        periodDays = req.period === "week" ? 7 : req.period === "month" ? 30 : 90;
      }

      // Load items by category and period
      for (const category of req.categories) {
        let categoryItems: FeedItem[];
        if (req.period === "custom" && startDate && endDate) {
          categoryItems = await loadItemsByCategoryWithDateRange(
            category as Category,
            startDate,
            endDate
          );
        } else {
          categoryItems = await loadItemsByCategory(category as Category, periodDays);
        }
        allItems.push(...categoryItems);
      }

      logger.info(`Loaded ${allItems.length} items from categories mode (${req.categories.join(",")}, ${req.period})`);

      // Pre-filter to prevent OOM
      const MAX_ITEMS_PER_CATEGORY = 500;
      const preFilteredItems: FeedItem[] = [];
      for (const category of req.categories) {
        const categoryItems = allItems.filter((item) => item.category === category);
        const sorted = categoryItems.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
        const limited = sorted.slice(0, MAX_ITEMS_PER_CATEGORY);
        preFilteredItems.push(...limited);
      }

      // Rank using custom ranking WITHOUT RECENCY
      const rankedPerCategory = await Promise.all(
        req.categories.map(async (category) => {
          const categoryItems = preFilteredItems.filter((item) => item.category === category);
          const ranked = await rankCategoryWithoutRecency(categoryItems, category as Category, periodDays, req.period || "all");
          return { category, items: ranked };
        })
      );

      // Merge ALL ranked items from all categories
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
    } else {
      // Manual mode: load selected items from saved_items
      const { loadItem } = await import("@/src/lib/db/items");
      for (const itemId of req.selectedItemIds || []) {
        const item = await loadItem(itemId);
        if (item) {
          allItems.push(item);
        }
      }
      logger.info(`Loaded ${allItems.length} items from selectedItemIds`);

      // Convert FeedItems to RankedItems (minimal ranking)
      mergedItems = allItems.map((item) => ({
        ...item,
        bm25Score: 0,
        llmScore: { relevance: 0, usefulness: 0, tags: [] },
        recencyScore: 0,
        finalScore: 1,
        reasoning: "Selected from saved items library",
      }));
    }

    // Deduplicate by ID (keep highest-ranked) - needed for auto and categories modes
    if (req.sourceMode === "auto" || req.sourceMode === "categories") {
      const deduped = new Map<string, RankedItem>();
      for (const item of mergedItems) {
        if (!deduped.has(item.id)) {
          deduped.set(item.id, item);
        }
      }
      mergedItems = Array.from(deduped.values());
    }

    logger.info(`Retrieved ${mergedItems.length} candidate items${req.sourceMode === "auto" ? " from all categories (ranked without recency)" : " from selectedItemIds"}`);

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

    // Step 4: Select items based on duration target
    const deduplicatedItems = deduplicateByUrl(mergedItems);
    deduplicatedItems.sort((a, b) => b.finalScore - a.finalScore);

    // Select items for duration target
    const limit = req.sourceMode === "manual" ? mergedItems.length : req.sourceMode === "categories" ? (req.limit || 50) : (req.limit || 50);
    const selectedItems = selectItemsForDuration(
      deduplicatedItems,
      req.duration || 30,
      limit
    );

    logger.info(`Selected ${selectedItems.length} items for ${req.duration || 30} minute digest`);

    // Step 5: Extract highlights from each item (in parallel batches for speed)
    logger.info(`Extracting highlights from ${selectedItems.length} items...`);
    const itemsWithHighlights: ItemWithHighlights[] = [];

    // Process items in parallel batches (5 at a time to avoid overwhelming the API)
    const BATCH_SIZE = 5;
    for (let i = 0; i < selectedItems.length; i += BATCH_SIZE) {
      const batch = selectedItems.slice(i, i + BATCH_SIZE);
      logger.info(`Processing highlight extraction batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(selectedItems.length / BATCH_SIZE)} (${batch.length} items)`);

      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          try {
            let highlights;
            if (item.category === "research") {
              highlights = await extractPaperHighlights(item, req.prompt || "");
            } else {
              highlights = await extractArticleHighlights(item, req.prompt || "");
            }

            if (highlights.length > 0) {
              return { item, highlights } as ItemWithHighlights;
            }
            return null;
          } catch (error) {
            logger.warn(`Failed to extract highlights for item "${item.title}"`, {
              error: error instanceof Error ? error.message : String(error),
              itemId: item.id,
            });
            return null;
          }
        })
      );

      // Collect successful results
      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value) {
          itemsWithHighlights.push(result.value);
        }
      }
    }

    logger.info(`Extracted highlights from ${itemsWithHighlights.length} items (out of ${selectedItems.length} selected)`);

    if (itemsWithHighlights.length === 0) {
      return NextResponse.json(
        { error: "No items with highlights available for the selected period and categories" },
        { status: 400 }
      );
    }

    // Step 6: Generate synthesized transcript
    logger.info("Generating audio digest transcript...");
    const content: AudioDigestContent = await generateAudioDigestTranscript(
      itemsWithHighlights,
      req.period || "all",
      (req.categories as Category[]) || [],
      req.prompt || "",
      req.duration || 30
    );

    logger.info(`Generated transcript with ${content.segments.length} segments, estimated duration: ${content.estimatedDuration}`);

    const endTime = Date.now();
    const generationTime = ((endTime - startTime) / 1000).toFixed(2);

    // Record usage
    await recordUsage(request, '/api/audio-digest/generate');

    const response: AudioDigestResponse = {
      id: uuid(),
      title: req.sourceMode === "manual"
        ? `Audio Digest - Curated Selection`
        : `Audio Digest - ${req.period || "all"}`,
      generatedAt: new Date().toISOString(),
      categories: req.categories || [],
      period: req.period || "all",
      duration: content.estimatedDuration,
      itemsRetrieved: mergedItems.length,
      itemsIncluded: itemsWithHighlights.length,
      transcript: content.transcript,
      segments: content.segments.map((seg) => ({
        title: seg.title,
        startTime: seg.startTime,
        endTime: seg.endTime,
        duration: seg.duration,
        itemsReferenced: seg.itemsReferenced,
        highlights: seg.highlights,
      })),
      showNotes: content.showNotes,
      generationMetadata: {
        promptUsed: req.prompt || "",
        modelUsed: "gpt-4o-mini",
        duration: `${generationTime}s`,
        promptProfile: profile,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error("Audio digest generation failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
