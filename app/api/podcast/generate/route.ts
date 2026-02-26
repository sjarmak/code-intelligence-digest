/**
 * POST /api/podcast/generate
 * Generate a podcast episode from selected categories using four-stage pipeline
 * Stage A: Extract per-item digests (gpt-4o-mini)
 * Stage B: Build rundown with editorial clustering (gpt-4o-mini)
 * Stage C: Write conversational script (gpt-4o-mini)
 * Stage D: Verify against digests (gpt-4o-mini)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { v4 as uuid } from "uuid";
import { LEGACY_USER_ID } from "@/src/lib/db/constants";
import {
  loadItemsByCategory,
  loadItemsByCategoryWithDateRange,
} from "@/src/lib/db/items";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { selectWithDiversity } from "@/src/lib/pipeline/select";

// Helper function to deduplicate by URL (same logic as in select.ts)
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
import {
  buildPromptProfile,
  PromptProfile,
} from "@/src/lib/pipeline/promptProfile";
import {
  rerankWithPrompt,
  filterByExclusions,
} from "@/src/lib/pipeline/promptRerank";
import { extractPodcastBatchDigests } from "@/src/lib/pipeline/podcastDigest";
import { generatePodcastRundown } from "@/src/lib/pipeline/podcastRundown";
import { generatePodcastScript } from "@/src/lib/pipeline/podcastScript";
import {
  verifyPodcastScript,
  generateVerificationReport,
} from "@/src/lib/pipeline/podcastVerify";
import { Category, FeedItem, RankedItem } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";
import { resolveLLMOptions, getOpenAICompatibleClient } from "@/src/lib/llm/client";
import {
  getDateRangeForPeriodDays,
  formatDateRangeLabel,
  formatDateLong,
} from "@/src/lib/dateRange";

interface PodcastRequest {
  sourceMode: "auto" | "manual" | "categories";
  categories?: string[];
  period?: "week" | "month" | "all" | "custom";
  limit?: number;
  selectedItemIds?: string[];
  prompt?: string;
  format?: string;
  voiceStyle?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  customDateRange?: {
    startDate: string;
    endDate: string;
  };
}

interface PodcastSegmentResponse {
  title: string;
  startTime: string;
  endTime: string;
  duration: number;
}

interface VerificationInfo {
  passed: boolean;
  issueCount: number;
  errorCount: number;
  report: string;
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
  segments: PodcastSegmentResponse[];
  showNotes: string;
  generationMetadata: {
    promptUsed: string;
    modelUsed: string;
    tokensUsed: number;
    voiceStyle: string;
    duration: string;
    promptProfile: PromptProfile | null;
    pipelineStages: {
      digestExtraction: boolean;
      rundownGeneration: boolean;
      scriptWriting: boolean;
      verification: VerificationInfo;
    };
  };
}

const ALLOWED_CATEGORIES: Category[] = [
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

const VOICE_STYLES = ["conversational", "technical", "executive"];

/**
 * Build show notes from digests and rundown
 */
function buildShowNotes(
  digests: Awaited<ReturnType<typeof extractPodcastBatchDigests>>,
  rundown: Awaited<ReturnType<typeof generatePodcastRundown>>,
): string {
  let notes = "# Show Notes\n\n";

  // Attribution plan section
  notes += "## Sources & Attribution\n\n";
  for (const attr of rundown.attribution_plan) {
    const digest = digests.find((d) => d.url === attr.url);
    if (digest) {
      notes += `- [${digest.title}](${digest.url}) — ${digest.source_name}\n`;
      notes += `  ${attr.spoken_attribution}\n`;
    }
  }

  // Segments section
  notes += "\n## Segments\n\n";
  for (const segment of rundown.segments) {
    notes += `### ${segment.name} (~${segment.time_seconds}s)\n\n`;
    for (const url of segment.stories_used) {
      const digest = digests.find((d) => d.url === url);
      if (digest) {
        notes += `- [${digest.title}](${digest.url}) — ${digest.source_name}\n`;
      }
    }
    notes += "\n";
  }

  // Lightning round
  if (rundown.lightning_round.length > 0) {
    notes += "## Lightning Round\n\n";
    for (const item of rundown.lightning_round) {
      const digest = digests.find((d) => d.url === item.url);
      if (digest) {
        notes += `- [${item.headline}](${item.url}) — ${digest.source_name}\n`;
      }
    }
    notes += "\n";
  }

  // All digests as reference
  notes += "## All Items\n\n";
  for (const digest of digests) {
    notes += `- [${digest.title}](${digest.url}) — ${digest.source_name} (${digest.credibility_notes})\n`;
  }

  return notes;
}

function validateRequest(body: unknown): {
  valid: boolean;
  error?: string;
  data?: PodcastRequest;
} {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "Request body must be JSON object" };
  }

  const req = body as Record<string, unknown>;

  // Validate sourceMode
  const sourceMode = req.sourceMode as string;
  if (!sourceMode || !["auto", "manual", "categories"].includes(sourceMode)) {
    return {
      valid: false,
      error: 'sourceMode must be "auto", "manual", or "categories"',
    };
  }

  // Validate voice style
  const voiceStyle = (req.voiceStyle as string) || "conversational";
  if (!VOICE_STYLES.includes(voiceStyle)) {
    return {
      valid: false,
      error: `voiceStyle must be one of: ${VOICE_STYLES.join(", ")}`,
    };
  }

  // Normalize prompt
  const prompt = typeof req.prompt === "string" ? req.prompt.trim() : "";

  const openaiApiKey = typeof req.openaiApiKey === "string" ? req.openaiApiKey.trim() : undefined;
  const openaiBaseUrl = typeof req.openaiBaseUrl === "string" ? req.openaiBaseUrl.trim() : undefined;

  const data: PodcastRequest = {
    sourceMode: sourceMode as "auto" | "manual" | "categories",
    prompt: prompt || undefined,
    format: "transcript",
    voiceStyle,
    openaiApiKey: openaiApiKey || undefined,
    openaiBaseUrl: openaiBaseUrl || undefined,
  };

  if (sourceMode === "categories") {
    // Categories mode: validate categories, period, limit (required)
    if (!Array.isArray(req.categories) || req.categories.length === 0) {
      return {
        valid: false,
        error: "categories must be non-empty array in categories mode",
      };
    }

    const categories = req.categories as string[];
    for (const cat of categories) {
      if (!ALLOWED_CATEGORIES.includes(cat as Category)) {
        return { valid: false, error: `Invalid category: ${cat}` };
      }
    }

    const period = req.period as string;
    if (!["week", "month", "all", "custom"].includes(period)) {
      return {
        valid: false,
        error:
          'period must be "week", "month", "all", or "custom" in categories mode',
      };
    }

    // Validate custom date range if period is custom
    if (period === "custom") {
      const customRange = req.customDateRange as
        | { startDate?: string; endDate?: string }
        | undefined;
      if (!customRange || !customRange.startDate || !customRange.endDate) {
        return {
          valid: false,
          error:
            'customDateRange with startDate and endDate is required when period is "custom"',
        };
      }
      const startDate = new Date(customRange.startDate);
      const endDate = new Date(customRange.endDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return {
          valid: false,
          error: "Invalid date format in customDateRange",
        };
      }
      if (startDate > endDate) {
        return { valid: false, error: "startDate must be before endDate" };
      }
      if (endDate > new Date()) {
        return { valid: false, error: "endDate cannot be in the future" };
      }
    }

    const limit = typeof req.limit === "number" ? req.limit : 15;
    if (limit < 1 || limit > 50) {
      return { valid: false, error: "limit must be between 1 and 50" };
    }

    data.categories = categories as Category[];
    data.period = period as "week" | "month" | "all" | "custom";
    data.limit = limit;

    if (period === "custom" && req.customDateRange) {
      data.customDateRange = {
        startDate: (
          req.customDateRange as { startDate: string; endDate: string }
        ).startDate,
        endDate: (req.customDateRange as { startDate: string; endDate: string })
          .endDate,
      };
    }
  } else if (sourceMode === "auto") {
    // Auto mode: using digest library, categories/period/limit are optional (not used for filtering)
    // Only validate if provided
    if (req.categories !== undefined) {
      if (!Array.isArray(req.categories) || req.categories.length === 0) {
        return {
          valid: false,
          error: "categories must be non-empty array if provided",
        };
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
        return {
          valid: false,
          error:
            'period must be "week", "month", "all", or "custom" if provided',
        };
      }
      data.period = period as "week" | "month" | "all" | "custom";

      // Validate custom date range if period is custom
      if (period === "custom") {
        const customRange = req.customDateRange as
          | { startDate?: string; endDate?: string }
          | undefined;
        if (!customRange || !customRange.startDate || !customRange.endDate) {
          return {
            valid: false,
            error:
              'customDateRange with startDate and endDate is required when period is "custom"',
          };
        }
        const startDate = new Date(customRange.startDate);
        const endDate = new Date(customRange.endDate);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return {
            valid: false,
            error: "Invalid date format in customDateRange",
          };
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
      const limit = typeof req.limit === "number" ? req.limit : 15;
      if (limit < 1 || limit > 50) {
        return { valid: false, error: "limit must be between 1 and 50" };
      }
      data.limit = limit;
    }
  } else {
    // Manual mode: validate selectedItemIds
    if (
      !Array.isArray(req.selectedItemIds) ||
      req.selectedItemIds.length === 0
    ) {
      return {
        valid: false,
        error: "selectedItemIds must be non-empty array in manual mode",
      };
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

export async function POST(
  request: NextRequest,
): Promise<NextResponse<PodcastResponse | { error: string }>> {
  const startTime = Date.now();

  try {
    // Check rate limits
    const { enforceRateLimit, recordUsage } =
      await import("@/src/lib/rate-limit");
    const rateLimitResponse = await enforceRateLimit(
      request,
      "/api/podcast/generate",
    );
    if (rateLimitResponse) {
      return rateLimitResponse as NextResponse<
        PodcastResponse | { error: string }
      >;
    }

    const body = await request.json();
    const validation = validateRequest(body);

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error! }, { status: 400 });
    }

    const req = validation.data!;

    const session = await auth();
    const userId = session?.user?.id ?? LEGACY_USER_ID;
    const sessionUser = session?.user
      ? {
          email: session.user.email ?? undefined,
          emailVerified: (session.user as { emailVerified?: boolean }).emailVerified ?? undefined,
        }
      : undefined;

    // Resolve LLM options (BYOK from body; session for Sourcegraph.com exception)
    const llmOptions = resolveLLMOptions(
      {
        openaiApiKey: req.openaiApiKey,
        openaiBaseUrl: req.openaiBaseUrl,
      },
      undefined,
      sessionUser,
    );
    const llmClient = getOpenAICompatibleClient(llmOptions);
    if (!llmClient) {
      return NextResponse.json(
        {
          error:
            "LLM is required for podcast generation. Provide openaiApiKey (and optionally openaiBaseUrl) in the request body, or sign in with a verified Sourcegraph.com account.",
        },
        { status: 400 },
      );
    }

    logger.info(
      `Podcast request: sourceMode=${req.sourceMode}, ${req.sourceMode === "categories" ? `categories=${req.categories?.join(",")}, period=${req.period}` : req.sourceMode === "auto" ? `digest library (${req.categories?.join(",") || "all"})` : `selectedItemIds=${req.selectedItemIds?.length} items`}, voice=${req.voiceStyle}, prompt="${(req.prompt || "").substring(0, 50)}..."`,
    );

    // Step 1: Retrieve candidates
    let allItems: FeedItem[] = [];
    let mergedItems: RankedItem[] = [];

    if (req.sourceMode === "auto") {
      // Auto mode: load from digest_items
      // In source mode, do NOT filter by category/period - use all items from digest library
      const { getDigestItems } = await import("@/src/lib/db/digestItems");
      allItems = await getDigestItems(undefined, undefined, userId);
      logger.info(
        `Loaded ${allItems.length} items from digest library (no category/period filtering in source mode)`,
      );

      // Early filtering to prevent OOM (sort by date, limit per category)
      const MAX_ITEMS_PER_CATEGORY = 500;
      const preFilteredItems: FeedItem[] = [];
      const categories = [...new Set(allItems.map((item) => item.category))];

      for (const category of categories) {
        const categoryItems = allItems.filter(
          (item) => item.category === category,
        );
        const sorted = categoryItems.sort(
          (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
        );
        const limited = sorted.slice(0, MAX_ITEMS_PER_CATEGORY);
        preFilteredItems.push(...limited);
      }

      // Rank all items without category/period filtering
      // Use a default periodDays for ranking purposes (doesn't affect filtering)
      const periodDays = 90; // Default to all-time for ranking

      const rankedPerCategory = await Promise.all(
        categories.map(async (category) => {
          const categoryItems = preFilteredItems.filter(
            (item) => item.category === category,
          );
          const ranked = await rankCategory(
            categoryItems,
            category as Category,
            periodDays,
          );
          return { category, items: ranked };
        }),
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
        return NextResponse.json(
          { error: "categories and period are required in categories mode" },
          { status: 400 },
        );
      }

      let periodDays: number;
      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (req.period === "custom" && req.customDateRange) {
        startDate = new Date(req.customDateRange.startDate);
        endDate = new Date(req.customDateRange.endDate);
        periodDays = Math.ceil(
          (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
        );
      } else {
        periodDays =
          req.period === "week" ? 7 : req.period === "month" ? 30 : 90;
      }

      // Load items by category and period
      for (const category of req.categories) {
        let categoryItems: FeedItem[];
        if (req.period === "custom" && startDate && endDate) {
          categoryItems = await loadItemsByCategoryWithDateRange(
            category as Category,
            startDate,
            endDate,
          );
        } else {
          categoryItems = await loadItemsByCategory(
            category as Category,
            periodDays,
          );
        }
        allItems.push(...categoryItems);
      }

      logger.info(
        `Loaded ${allItems.length} items from categories mode (${req.categories.join(",")}, ${req.period})`,
      );

      // Early filtering to prevent OOM
      const MAX_ITEMS_PER_CATEGORY = 500;
      const preFilteredItems: FeedItem[] = [];
      for (const category of req.categories) {
        const categoryItems = allItems.filter(
          (item) => item.category === category,
        );
        const sorted = categoryItems.sort(
          (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
        );
        const limited = sorted.slice(0, MAX_ITEMS_PER_CATEGORY);
        preFilteredItems.push(...limited);
      }

      // Rank pre-filtered candidates
      const rankedPerCategory = await Promise.all(
        req.categories.map(async (category) => {
          const categoryItems = preFilteredItems.filter(
            (item) => item.category === category,
          );
          const ranked = await rankCategory(
            categoryItems,
            category as Category,
            periodDays,
          );
          return { category, items: ranked };
        }),
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

      // Convert FeedItems to RankedItems
      mergedItems = allItems.map((item) => ({
        ...item,
        bm25Score: 0,
        llmScore: { relevance: 0, usefulness: 0, tags: [] },
        recencyScore: 0,
        finalScore: 1,
        reasoning: "Selected from saved items library",
      }));
    }

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
        logger.info(
          `Re-ranked with prompt profile: ${JSON.stringify(profile)}`,
        );
      }
    }

    // Step 4: Select items based on relevance
    // When no prompt is provided, use highest relevance items (sorted by finalScore)
    // When prompt is provided, apply diversity constraints
    let selectedItems: RankedItem[];

    if (!req.prompt || req.prompt.length === 0) {
      // No prompt: Sort by finalScore (highest first) and take top N
      // Still deduplicate by URL to avoid duplicates
      const deduplicatedItems = deduplicateByUrl(mergedItems);
      deduplicatedItems.sort((a, b) => b.finalScore - a.finalScore);
      // For auto (digest library) and manual modes, use ALL items. For categories mode, use the requested limit.
      const limit =
        req.sourceMode === "manual" || req.sourceMode === "auto"
          ? mergedItems.length
          : req.limit || 15;
      selectedItems = deduplicatedItems.slice(0, limit);
      logger.info(
        `Selected ${selectedItems.length} highest relevance items (no prompt, sorted by finalScore)`,
      );
    } else {
      // With prompt: Apply diversity constraints
      const maxPerSource =
        req.period === "week" ? 2 : req.period === "month" ? 3 : 4;
      // For auto (digest library) and manual modes, use ALL items. For categories mode, use the requested limit.
      const limit =
        req.sourceMode === "manual" || req.sourceMode === "auto"
          ? mergedItems.length
          : req.limit || 15;
      const category = req.categories?.[0] || "tech_articles";
      const selection = selectWithDiversity(
        mergedItems,
        category as Category,
        maxPerSource,
        limit,
      );
      selectedItems = selection.items;
      logger.info(
        `Selected ${selectedItems.length} items (with prompt, diversity constraints applied)`,
      );
    }

    // For auto (digest library) and manual modes, use ALL items. For categories mode, use the requested limit.
    const limit =
      req.sourceMode === "manual" || req.sourceMode === "auto"
        ? mergedItems.length
        : req.limit || 15;
    logger.info(
      `Selected ${selectedItems.length} items (requested limit: ${limit}) with diversity constraints`,
    );

    // FOUR-STAGE PIPELINE:

    // Stage A: Extract per-item digests
    logger.info("Stage A: Extracting per-item digests (gpt-4o-mini)...");
    const digests = await extractPodcastBatchDigests(
      selectedItems,
      req.prompt || "",
      llmOptions,
    );
    logger.info(`Stage A complete: ${digests.length} digests extracted`);

    // Stage B: Build editorial rundown
    logger.info("Stage B: Generating podcast rundown (gpt-4o-mini)...");
    const rundown = await generatePodcastRundown(
      digests,
      req.period || "all",
      (req.categories as Category[]) || [],
      profile,
      llmOptions,
    );
    logger.info(
      `Stage B complete: ${rundown.segments.length} segments, ${rundown.total_time_seconds}s total`,
    );

    // Stage C: Write conversational script
    logger.info("Stage C: Writing podcast script (gpt-4o-mini)...");
    const { transcript, segments, estimatedDuration } =
      await generatePodcastScript(
        digests,
        rundown,
        req.period || "all",
        (req.categories as Category[]) || [],
        profile,
        req.voiceStyle,
        llmOptions,
      );
    logger.info(
      `Stage C complete: ${transcript.split(/\s+/).length} words, ${estimatedDuration} duration`,
    );

    // Stage D: Verify script
    logger.info("Stage D: Verifying script accuracy (gpt-4o-mini)...");
    const verificationResult = await verifyPodcastScript(transcript, digests, llmOptions);
    const verificationReport = generateVerificationReport(verificationResult);
    const errorCount = verificationResult.issues.filter(
      (i) => i.severity === "error",
    ).length;
    logger.info(
      `Stage D complete: ${verificationResult.issues.length} issues found (${errorCount} errors), passed=${verificationResult.passedVerification}`,
    );

    // Build show notes from rundown
    const showNotes = buildShowNotes(digests, rundown);

    // Build response with date-aware title
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const id = `pod-${uuid()}`;

    const dateRangeLabel = ((): string | null => {
      if (req.sourceMode === "manual") return null;
      if (req.sourceMode === "auto") return formatDateLong(new Date());
      const period = req.period || "all";
      if (period === "custom" && req.customDateRange) {
        return formatDateRangeLabel(
          { start: req.customDateRange.startDate, end: req.customDateRange.endDate },
          "custom",
        );
      }
      if (period === "week" || period === "month") {
        const range = getDateRangeForPeriodDays(period === "week" ? 7 : 30);
        return formatDateRangeLabel(range, period);
      }
      return formatDateLong(new Date());
    })();

    const baseTitle =
      req.sourceMode === "manual"
        ? "Code Intelligence Digest – Curated Selection"
        : `Code Intelligence Digest – ${req.period === "week" ? "Week" : req.period === "month" ? "Month" : req.period === "all" ? "All Time" : "Custom Range"}`;
    const podcastTitle = (rundown.episode_title || baseTitle) +
      (dateRangeLabel ? ` – ${dateRangeLabel}` : "");

    const response: PodcastResponse = {
      id,
      title: podcastTitle,
      generatedAt: new Date().toISOString(),
      categories: req.categories || [],
      period: req.period || "all",
      duration: estimatedDuration,
      itemsRetrieved: mergedItems.length,
      itemsIncluded: selectedItems.length,
      transcript: verificationResult.script,
      segments: segments.map((s) => ({
        title: s.title,
        startTime: s.startTime,
        endTime: s.endTime,
        duration: s.duration,
      })),
      showNotes,
      generationMetadata: {
        promptUsed: req.prompt || "",
        modelUsed: "quality model (all stages)",
        tokensUsed: Math.ceil(
          transcript.split(/\s+/).length * 1.3 + digests.length * 300 + 2000,
        ), // Estimate all stages
        voiceStyle: req.voiceStyle!,
        duration: `${duration}s`,
        promptProfile: profile,
        pipelineStages: {
          digestExtraction: true,
          rundownGeneration: true,
          scriptWriting: true,
          verification: {
            passed: verificationResult.passedVerification,
            issueCount: verificationResult.issues.length,
            errorCount,
            report: verificationReport,
          },
        },
      },
    };

    // Record successful usage
    await recordUsage(request, "/api/podcast/generate");

    return NextResponse.json(response);
  } catch (error) {
    logger.error("Podcast generation failed", { error });
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
