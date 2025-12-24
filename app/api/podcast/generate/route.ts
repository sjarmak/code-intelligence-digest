/**
 * POST /api/podcast/generate
 * Generate a podcast episode from selected categories using four-stage pipeline
 * Stage A: Extract per-item digests (gpt-4o-mini)
 * Stage B: Build rundown with editorial clustering (gpt-4o-mini)
 * Stage C: Write conversational script (gpt-4o-mini)
 * Stage D: Verify against digests (gpt-4o-mini)
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { loadItemsByCategory, loadItemsByCategoryWithDateRange } from "@/src/lib/db/items";
import { rankCategory } from "@/src/lib/pipeline/rank";
import { selectWithDiversity } from "@/src/lib/pipeline/select";
import { buildPromptProfile, PromptProfile } from "@/src/lib/pipeline/promptProfile";
import { rerankWithPrompt, filterByExclusions } from "@/src/lib/pipeline/promptRerank";
import { extractPodcastBatchDigests } from "@/src/lib/pipeline/podcastDigest";
import { generatePodcastRundown } from "@/src/lib/pipeline/podcastRundown";
import { generatePodcastScript } from "@/src/lib/pipeline/podcastScript";
import { verifyPodcastScript, generateVerificationReport } from "@/src/lib/pipeline/podcastVerify";
import { Category, FeedItem, RankedItem } from "@/src/lib/model";
import { logger } from "@/src/lib/logger";

interface PodcastRequest {
  categories: string[];
  period: "week" | "month" | "all" | "custom";
  limit: number;
  prompt?: string;
  format?: string;
  voiceStyle?: string;
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
  "product_news",
  "community",
  "research",
];

const VOICE_STYLES = ["conversational", "technical", "executive"];

/**
 * Build show notes from digests and rundown
 */
function buildShowNotes(
  digests: Awaited<ReturnType<typeof extractPodcastBatchDigests>>,
  rundown: Awaited<ReturnType<typeof generatePodcastRundown>>
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
  if (!["week", "month", "all", "custom"].includes(period)) {
    return { valid: false, error: 'period must be "week", "month", "all", or "custom"' };
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

  // Extract customDateRange for type narrowing
  const customDateRange = period === "custom" && req.customDateRange ? req.customDateRange : undefined;

  return {
    valid: true,
    data: {
      categories: categories as Category[],
      period: period as "week" | "month" | "all" | "custom",
      ...(customDateRange ? {
        customDateRange: {
          startDate: customDateRange.startDate,
          endDate: customDateRange.endDate,
        },
      } : {}),
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
    // Check rate limits
    const { enforceRateLimit, recordUsage, checkRequestSize } = await import('@/src/lib/rate-limit');
    const rateLimitResponse = await enforceRateLimit(request, '/api/podcast/generate');
    if (rateLimitResponse) {
      return rateLimitResponse as NextResponse<PodcastResponse | { error: string }>;
    }

    const body = await request.json();
    const validation = validateRequest(body);

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error! }, { status: 400 });
    }

    const req = validation.data!;

    // Calculate period days or use custom date range
    let periodDays: number;
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (req.period === "custom" && req.customDateRange) {
      startDate = new Date(req.customDateRange.startDate);
      endDate = new Date(req.customDateRange.endDate);
      // Calculate days for ranking purposes (use the range span)
      periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    } else {
      periodDays = req.period === "week" ? 7 : req.period === "month" ? 30 : 90;
    }

    logger.info(
      `Podcast request: categories=${req.categories.join(",")}, period=${req.period}, voice=${req.voiceStyle}, prompt="${(req.prompt || "").substring(0, 50)}..."${req.period === "custom" ? `, dateRange=${req.customDateRange?.startDate} to ${req.customDateRange?.endDate}` : ""}`
    );

    // Step 1: Retrieve candidates
    const allItems: FeedItem[] = [];
    for (const category of req.categories) {
      let items: FeedItem[];
      if (req.period === "custom" && startDate && endDate) {
        items = await loadItemsByCategoryWithDateRange(category, startDate, endDate);
      } else {
        items = await loadItemsByCategory(category, periodDays);
      }
      allItems.push(...items);
    }

    // Step 1.5: Early filtering to prevent OOM on large datasets
    // Limit items per category before ranking to reduce memory usage
    // Use recency as a simple pre-filter (most recent first)
    const MAX_ITEMS_PER_CATEGORY = 500; // Limit before ranking to prevent OOM
    const preFilteredItems: FeedItem[] = [];
    for (const category of req.categories) {
      const categoryItems = allItems.filter((item) => item.category === category);
      // Sort by recency (most recent first) and take top N
      const sorted = categoryItems.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
      const limited = sorted.slice(0, MAX_ITEMS_PER_CATEGORY);
      preFilteredItems.push(...limited);
      if (categoryItems.length > MAX_ITEMS_PER_CATEGORY) {
        logger.info(
          `Pre-filtered ${category}: ${categoryItems.length} → ${limited.length} items (recency-based)`
        );
      }
    }

    // Step 2: Rank pre-filtered candidates
     const rankedPerCategory = await Promise.all(
       req.categories.map(async (category) => {
         const categoryItems = preFilteredItems.filter((item) => item.category === category);
         const ranked = await rankCategory(categoryItems, category as Category, periodDays);
         return { category, items: ranked };
       })
     );

     // Merge ALL ranked items from all categories
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

    // Step 4: Diversity selection with limit
    const maxPerSource = req.period === "week" ? 2 : req.period === "month" ? 3 : 4;
    const selection = selectWithDiversity(mergedItems, req.categories[0] as Category, maxPerSource, req.limit);
    const selectedItems = selection.items;

    logger.info(`Selected ${selectedItems.length} items (requested limit: ${req.limit}) with diversity constraints`);

    // FOUR-STAGE PIPELINE:

    // Stage A: Extract per-item digests
    logger.info("Stage A: Extracting per-item digests (gpt-4o-mini)...");
    const digests = await extractPodcastBatchDigests(selectedItems, req.prompt || "");
    logger.info(`Stage A complete: ${digests.length} digests extracted`);

    // Stage B: Build editorial rundown
    logger.info("Stage B: Generating podcast rundown (gpt-4o-mini)...");
    const rundown = await generatePodcastRundown(
      digests,
      req.period,
      req.categories as Category[],
      profile
    );
    logger.info(`Stage B complete: ${rundown.segments.length} segments, ${rundown.total_time_seconds}s total`);

    // Stage C: Write conversational script
    logger.info("Stage C: Writing podcast script (gpt-4o-mini)...");
    const { transcript, segments, estimatedDuration } = await generatePodcastScript(
      digests,
      rundown,
      req.period,
      req.categories as Category[],
      profile,
      req.voiceStyle
    );
    logger.info(`Stage C complete: ${transcript.split(/\s+/).length} words, ${estimatedDuration} duration`);

    // Stage D: Verify script
    logger.info("Stage D: Verifying script accuracy (gpt-4o-mini)...");
    const verificationResult = await verifyPodcastScript(transcript, digests);
    const verificationReport = generateVerificationReport(verificationResult);
    const errorCount = verificationResult.issues.filter((i) => i.severity === "error").length;
    logger.info(
      `Stage D complete: ${verificationResult.issues.length} issues found (${errorCount} errors), passed=${verificationResult.passedVerification}`
    );

    // Build show notes from rundown
    const showNotes = buildShowNotes(digests, rundown);

    // Build response
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const id = `pod-${uuid()}`;

    const response: PodcastResponse = {
      id,
      title: rundown.episode_title || `Code Intelligence Digest – ${req.period === "week" ? "Week" : req.period === "month" ? "Month" : req.period === "all" ? "All Time" : "Custom Range"}`,
      generatedAt: new Date().toISOString(),
      categories: req.categories,
      period: req.period,
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
        modelUsed: "gpt-4o-mini (all stages)",
        tokensUsed: Math.ceil(transcript.split(/\s+/).length * 1.3 + digests.length * 300 + 2000), // Estimate all stages
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
    await recordUsage(request, '/api/podcast/generate');

    return NextResponse.json(response);
  } catch (error) {
    logger.error("Podcast generation failed", { error });
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
