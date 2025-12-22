#!/usr/bin/env node

/**
 * Full pipeline test: Generate newsletter with all categories + user prompt
 * Tests the complete flow: load → rank → select → decompose → extract → synthesize
 */

import { loadItemsByCategory } from "../src/lib/db/items";
import { rankCategory } from "../src/lib/pipeline/rank";
import { selectWithDiversity } from "../src/lib/pipeline/select";
import { extractBatchDigests } from "../src/lib/pipeline/extract";
import { generateNewsletterFromDigests } from "../src/lib/pipeline/newsletter";
import { buildPromptProfile } from "../src/lib/pipeline/promptProfile";
import { rerankWithPrompt, filterByExclusions } from "../src/lib/pipeline/promptRerank";
import { Category, FeedItem, RankedItem } from "../src/lib/model";
import { logger } from "../src/lib/logger";

const USER_PROMPT = "focus on code search, information retrieval or RAG or context management for coding agents, software engineering with coding agents, and developer productivity with AI";

const CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "product_news",
  "community",
  "research",
];

async function testFullPipeline() {
  console.log("\n🚀 Full Newsletter Generation Pipeline Test\n");
  console.log(`Categories: ${CATEGORIES.join(", ")}`);
  console.log(`Period: 7 days`);
  console.log(`User Prompt: "${USER_PROMPT}"\n`);

  const startTime = Date.now();
  const periodDays = 7;
  const limit = 20;
  const maxPerSource = 2; // For weekly

  try {
    // Step 1: Load items
    console.log("📥 Step 1: Loading items...");
    const allItems: FeedItem[] = [];
    const loadStats = new Map<string, number>();

    for (const category of CATEGORIES) {
      const items = await loadItemsByCategory(category, periodDays);
      allItems.push(...items);
      loadStats.set(category, items.length);
    }

    console.log(`   Loaded ${allItems.length} total items:`);
    for (const [cat, count] of loadStats) {
      console.log(`   - ${cat}: ${count}`);
    }

    if (allItems.length === 0) {
      console.error("   ❌ No items found!");
      process.exit(1);
    }

    // Step 2: Rank per category
    console.log("\n📊 Step 2: Ranking per category...");
    const rankedPerCategory = await Promise.all(
      CATEGORIES.map(async (category) => {
        const categoryItems = allItems.filter((item) => item.category === category);
        if (categoryItems.length === 0) {
          return { category, items: [] };
        }
        const ranked = await rankCategory(categoryItems, category, periodDays);
        return { category, items: ranked };
      })
    );

    // Merge all ranked items
    let mergedItems: RankedItem[] = [];
    for (const { category, items } of rankedPerCategory) {
      console.log(`   - ${category}: ${items.length} ranked items`);
      mergedItems.push(...items);
    }

    // Deduplicate by ID
    const deduped = new Map<string, RankedItem>();
    for (const item of mergedItems) {
      if (!deduped.has(item.id)) {
        deduped.set(item.id, item);
      }
    }
    mergedItems = Array.from(deduped.values());
    console.log(`   Total after dedup: ${mergedItems.length} items`);

    // Step 3: Size filter
    console.log("\n🔍 Step 3: Size filtering (max 50KB)...");
    const maxContentLength = 50000;
    const beforeSizeFilter = mergedItems.length;
    mergedItems = mergedItems.filter((item) => {
      const contentLength = (item.fullText || item.summary || item.contentSnippet || "").length;
      return contentLength <= maxContentLength;
    });
    console.log(`   Filtered: ${beforeSizeFilter} → ${mergedItems.length} (removed ${beforeSizeFilter - mergedItems.length})`);

    // Step 4: Prompt-based re-ranking
    console.log("\n🎯 Step 4: Applying user prompt profile...");
    const profile = await buildPromptProfile(USER_PROMPT);
    let rerankApplied = false;

    if (profile && profile.focusTopics.length > 0) {
      console.log(`   Focus topics: ${profile.focusTopics.join(", ")}`);
      console.log(`   Exclusions: ${profile.excludeTopics?.join(", ") || "none"}`);
      
      mergedItems = rerankWithPrompt(mergedItems, profile);
      mergedItems = filterByExclusions(mergedItems, profile);
      rerankApplied = true;
      console.log(`   Re-ranked: ${mergedItems.length} items remaining`);
    }

    // Step 5: Diversity selection
    console.log("\n🎲 Step 5: Diversity-constrained selection...");
    const selection = selectWithDiversity(mergedItems, CATEGORIES[0], maxPerSource, limit);
    const selectedItems = selection.items;
    console.log(`   Selected: ${selectedItems.length} items (limit: ${limit}, max per source: ${maxPerSource})`);

    // Log top 5 selected items
    console.log("   Top selected items:");
    for (let i = 0; i < Math.min(5, selectedItems.length); i++) {
      const item = selectedItems[i];
      console.log(
        `   [${i + 1}] "${item.title.substring(0, 60)}..." (${item.sourceTitle}, score: ${(item.finalScore || 0).toFixed(2)})`
      );
    }

    // Step 6: Extract digests
    console.log("\n✨ Step 6: Extracting digests (newsletter decomposition + LLM extraction)...");
    const digests = await extractBatchDigests(selectedItems, USER_PROMPT);
    console.log(`   Extracted: ${digests.length} digests`);

    // Validate digest URLs
    let validUrlCount = 0;
    let inoreaderUrlCount = 0;
    for (const digest of digests) {
      if (digest.url && digest.url.startsWith("http")) {
        if (!digest.url.includes("inoreader.com")) {
          validUrlCount++;
        } else {
          inoreaderUrlCount++;
        }
      }
    }
    console.log(`   URLs: ${validUrlCount} valid, ${inoreaderUrlCount} Inoreader, ${digests.length - validUrlCount - inoreaderUrlCount} missing`);

    // Show sample digests
    console.log("   Sample digests:");
    for (let i = 0; i < Math.min(3, digests.length); i++) {
      const digest = digests[i];
      const urlStatus = !digest.url
        ? "❌ MISSING"
        : digest.url.includes("inoreader.com")
          ? "⚠️  INOREADER"
          : "✅ VALID";
      console.log(
        `   [${i + 1}] "${digest.title.substring(0, 50)}..." (${digest.sourceTitle}) [${digest.category}] ${urlStatus}`
      );
      console.log(`       Tags: ${digest.topicTags.join(", ")}`);
    }

    // Step 7: Generate newsletter
    console.log("\n📝 Step 7: Synthesizing newsletter (LLM synthesis)...");
    const { summary, themes, markdown, html } = await generateNewsletterFromDigests(
      digests,
      "week",
      CATEGORIES,
      profile,
      USER_PROMPT
    );

    console.log(`   Summary: ${summary.length} chars`);
    console.log(`   Themes: ${themes.join(", ")}`);
    console.log(`   Markdown: ${markdown.length} chars`);
    console.log(`   HTML: ${html.length} chars`);

    // Validate output
    console.log("\n✅ Validation:");
    let passCount = 0;
    let totalChecks = 0;

    // Check 1: Summary exists and is substantial
    totalChecks++;
    if (summary.length > 150) {
      console.log("   ✅ Summary is substantial");
      passCount++;
    } else {
      console.log("   ❌ Summary too short");
    }

    // Check 2: Themes extracted (ok if LLM not available)
    totalChecks++;
    if (themes.length >= 1) {
      console.log(`   ✅ ${themes.length} theme(s) extracted`);
      passCount++;
    } else {
      console.log("   ❌ No themes extracted");
    }

    // Check 3: Markdown contains items
    totalChecks++;
    if (markdown.includes("##") && markdown.length > 500) {
      console.log("   ✅ Markdown newsletter well-formed");
      passCount++;
    } else {
      console.log("   ❌ Markdown format issue");
    }

    // Check 4: HTML is substantial
    totalChecks++;
    if (html.length > 1000) {
      console.log(`   ✅ HTML generated (${html.length} chars)`);
      passCount++;
    } else {
      console.log("   ❌ HTML too short");
    }

    // Check 5: URLs preserved in output
    totalChecks++;
    const markdownUrls = (markdown.match(/https?:\/\/[^\s\)]+/g) || []).length;
    if (markdownUrls > 0) {
      console.log(`   ✅ ${markdownUrls} URLs in markdown output`);
      passCount++;
    } else {
      console.log("   ❌ No URLs in output");
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n📊 Test Summary:`);
    console.log(`   Duration: ${duration}s`);
    console.log(`   Items loaded: ${allItems.length}`);
    console.log(`   Items selected: ${selectedItems.length}`);
    console.log(`   Digests extracted: ${digests.length}`);
    console.log(`   Validation: ${passCount}/${totalChecks} checks passed`);

    if (passCount === totalChecks) {
      console.log("\n✅ All tests passed!\n");
      process.exit(0);
    } else {
      console.log("\n⚠️  Some tests failed\n");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Test failed with error:");
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testFullPipeline();
