/**
 * Newsletter generation (Pass 2 - Synthesis)
 * Converts item digests into a polished newsletter using gpt-4o-mini
 */

import OpenAI from "openai";
import { RankedItem, Category } from "../model";
import { PromptProfile } from "./promptProfile";
import { ItemDigest } from "./extract";
import { logger } from "../logger";
import { reviewNewsletter } from "./reviewNewsletter";

export interface NewsletterContent {
  summary: string;
  themes: string[];
  markdown: string;
  html: string;
}

/**
 * Lazy-load OpenAI client
 */
function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new OpenAI({ apiKey });
}

/**
 * Truncate text for LLM input while respecting word boundaries
 */
function truncateForLLM(text: string | undefined, maxChars: number): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;

  const truncated = text.substring(0, maxChars);
  const lastSpaceIdx = truncated.lastIndexOf(" ");
  return lastSpaceIdx > 0 ? truncated.substring(0, lastSpaceIdx) : truncated;
}

/**
 * Check if URL is valid (not Inoreader, not empty, http/https)
 */
function isValidUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  if (url.includes("inoreader.com") || url.includes("google.com/reader")) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * Build synthesis context from item digests (Pass 2)
 */
function buildDigestContext(digests: ItemDigest[]): string {
  return digests
    .map((digest, idx) => {
      return `[${idx + 1}] "${digest.title}"
Source: ${digest.sourceTitle}
URL: ${digest.url}
Credibility: ${digest.sourceCredibility.toUpperCase()}
User Relevance Score: ${digest.userRelevanceScore}/10

Gist: ${digest.gist}

Key Points:
${digest.keyBullets.map(b => `- ${b}`).join("\n")}

Why It Matters: ${digest.whyItMatters}

Topics: ${digest.topicTags.join(", ")}
Named Entities: ${digest.namedEntities.join(", ") || "None"}
---`;
    })
    .join("\n\n");
}

/**
 * Build synthesis context from selected items with full text for top items
 * (Legacy - kept for fallback)
 */
function buildSynthesisContext(items: RankedItem[]): string {
  return items
    .map((item, idx) => {
      // For top 3 items, include full text; for others, use summary
      const isTopItem = idx < 3;
      const text = isTopItem
        ? truncateForLLM(item.fullText || item.summary || item.contentSnippet, 3000)
        : truncateForLLM(item.summary || item.contentSnippet, 500);
      const score = Math.min(100, Math.round(item.finalScore * 100));
      return `[${idx + 1}] "${item.title}" — ${item.sourceTitle} (${item.author || "Unknown"}) | Score: ${score}
URL: ${item.url}
${text ? `Content: ${text}` : "Content: No text available"}
Tags: ${item.llmScore.tags.join(", ")}
${isTopItem ? "[TOP_ITEM]" : ""}
`;
    })
    .join("\n---\n");
}

/**
 * Generate newsletter content using LLM
 */
export async function generateNewsletterContent(
  items: RankedItem[],
  period: "week" | "month",
  categories: Category[],
  profile: PromptProfile | null
): Promise<NewsletterContent> {
  if (items.length === 0) {
    return {
      summary: `No items found for ${period}.`,
      themes: [],
      markdown: "# Code Intelligence Digest\n\nNo items available.",
      html: "<article><h1>Code Intelligence Digest</h1><p>No items available.</p></article>",
    };
  }

  logger.info(
    `Generating newsletter for ${items.length} items, period=${period}, categories=${categories.join(",")}`
  );

  const synthesisContext = buildSynthesisContext(items);
  const periodLabel = period === "week" ? "weekly" : "monthly";
  const categoryLabels = categories.join(", ");

  let summary: string;
  let themes: string[];
  let markdown: string;
  let html: string;

  const client = getClient();
  if (client) {
    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_completion_tokens: 4000,
        reasoning_effort: "high",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: `Generate a ${periodLabel} Code Intelligence Digest newsletter from these curated items.

Categories: ${categoryLabels}
${profile ? `User focus: ${profile.focusTopics.join(", ")}` : ""}

Total Items: ${items.length}

Items (numbered 1-${items.length}):
${synthesisContext}

INSTRUCTIONS:
1. Write for a senior engineering audience focused on code intelligence, agents, and IR
2. Synthesize across sources to find emerging themes and connections
3. Explain WHY each item matters in relation to the user's focus areas
4. For research papers, include 1-2 key findings aligned to user interests
5. Maintain consistent editorial voice and structure
6. Ensure minimum 10 items are represented (with source diversity)
7. Highlight strategic importance, not just novelty

Generate JSON with:
- summary: 200-300 word executive summary that synthesizes trends, connects items across categories, and explains strategic importance to the user's focus areas
- themes: 5-10 key thematic strings (e.g., "code-search", "agents", "context-management", "benchmarking")
- markdown: Complete markdown newsletter with:
  * H1 title "Code Intelligence Digest"
  * Executive summary section (from summary field)
  * Thematic sections (H2) grouping related items
  * Each item: title, source, 2-3 sentence description (gist + key points + why it matters)
  * Research paper items: include 1-2 key findings relevant to user focus
  * 4-5 strategic callout boxes (>) highlighting standout items and cross-source themes
  * No fabricated content - only use provided digests
- html: Clean semantic HTML version of markdown (use <article>, <section>, <h1>-<h2>, <p>, <blockquote>, <ul>, <li>)

Return only valid JSON.`,
          },
        ],
      });

      const content = response.choices[0].message.content;
      if (!content) {
        throw new Error("No content returned from LLM");
      }

      try {
        const parsed = JSON.parse(content);
        summary = parsed.summary || "No summary generated.";
        themes = Array.isArray(parsed.themes) ? parsed.themes : [];
        markdown = parsed.markdown || "# Code Intelligence Digest\n\nNo content generated.";
        html = parsed.html || "<article><h1>Code Intelligence Digest</h1><p>No content generated.</p></article>";

        if (!markdown || markdown === "# Code Intelligence Digest\n\nNo content generated.") {
          throw new Error("LLM returned empty markdown");
        }
      } catch (parseError) {
        logger.error("Failed to parse LLM response", {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          responsePreview: content?.substring(0, 500),
        });
        throw parseError;
      }
    } catch (error) {
      logger.warn("LLM newsletter generation failed, using fallback template", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      const fallback = generateNewsletterFallback(items, periodLabel);
      summary = fallback.summary;
      themes = fallback.themes;
      markdown = fallback.markdown;
      html = fallback.html;
    }
  } else {
    logger.info("OPENAI_API_KEY not set, using fallback newsletter");
    const fallback = generateNewsletterFallback(items, periodLabel);
    summary = fallback.summary;
    themes = fallback.themes;
    markdown = fallback.markdown;
    html = fallback.html;
  }

  return { summary, themes, markdown, html };
}

/**
 * Generate newsletter from item digests (Pass 2 - Synthesis)
 * Called after extraction pass with structured digests
 */
export async function generateNewsletterFromDigests(
  digests: ItemDigest[],
  period: "week" | "month",
  categories: Category[],
  profile: PromptProfile | null,
  userPrompt?: string
): Promise<NewsletterContent> {
  const periodLabel = period === "week" ? "weekly" : "monthly";
  return await generateNewsletterFromDigestData(digests, periodLabel, userPrompt || "");
}

/**
   * Group digests by their resource category label (research, community, newsletters, etc.)
   * Returns ordered map: research > tech_articles > product_news > ai_news > other prioritized items
  */
function groupByResourceCategory(digests: ItemDigest[]): Map<string, ItemDigest[]> {
    const byCategory = new Map<string, ItemDigest[]>();

    // Category label mapping for display
    const categoryLabels: Record<string, string> = {
      newsletters: "Newsletters",
      podcasts: "Podcasts",
      tech_articles: "Tech Articles",
      ai_news: "AI News",
      product_news: "Product News",
      community: "Community",
      research: "Research",
    };

    // Define priority order (lower number = higher priority)
    const categoryPriority: Record<string, number> = {
      research: 1,
      tech_articles: 2,
      product_news: 3,
      ai_news: 4,
      community: 5,
      newsletters: 6,
      podcasts: 7,
    };

    // Group by category first
    const tempMap = new Map<string, ItemDigest[]>();
    for (const digest of digests) {
      const displayLabel = categoryLabels[digest.category] || digest.category;

      if (!tempMap.has(displayLabel)) {
        tempMap.set(displayLabel, []);
      }
      tempMap.get(displayLabel)!.push(digest);
    }

    // Sort entries by category priority and add to result map (which preserves insertion order)
    const sortedEntries = Array.from(tempMap.entries()).sort((a, b) => {
      const catKeyA = Object.entries(categoryLabels).find(([, v]) => v === a[0])?.[0] || a[0];
      const catKeyB = Object.entries(categoryLabels).find(([, v]) => v === b[0])?.[0] || b[0];
      const priorA = categoryPriority[catKeyA] ?? 99;
      const priorB = categoryPriority[catKeyB] ?? 99;
      return priorA - priorB;
    });

    for (const [label, items] of sortedEntries) {
      byCategory.set(label, items);
    }

    return byCategory;
  }

/**
 * Generate newsletter directly from ItemDigest data (better quality)
 */
async function generateNewsletterFromDigestData(
  digests: ItemDigest[],
  periodLabel: string,
  userPrompt: string
): Promise<NewsletterContent> {
  const apiKey = process.env.OPENAI_API_KEY;
  // Note: OpenAI client created later if apiKey exists

  // Log items with missing/invalid URLs for transparency
  const itemsWithoutUrl = digests.filter(d => !isValidUrl(d.url));
  if (itemsWithoutUrl.length > 0) {
    logger.warn(`${itemsWithoutUrl.length} items without valid URLs will appear without links`, {
      titles: itemsWithoutUrl.map(d => d.title),
    });
  }

  // Debug: Log digest URLs for newsletters category
  const newsletterDigests = digests.filter(d => d.category === "newsletters");
  if (newsletterDigests.length > 0) {
    logger.info(`[URL_DEBUG] Newsletter digests (${newsletterDigests.length}): ${newsletterDigests.slice(0, 5).map(d => `${d.title.substring(0, 30)}... -> ${d.url}`).join(" | ")}`);
  }

  // Group items by resource category (research, community, newsletters, etc.)
   const byCategory = groupByResourceCategory(digests);

   // Extract themes for metadata, respecting user prompt guidance
   const themeFreq = new Map<string, number>();
   for (const digest of digests) {
     for (const tag of digest.topicTags) {
       themeFreq.set(tag, (themeFreq.get(tag) || 0) + 1);
     }
   }

   // Parse user prompt to extract focus topics for theme boosting
   let userPromptTopics: string[] = [];
   if (userPrompt) {
     // Extract known domain terms from prompt
     const domainTerms = [
       "code search",
       "semantic search",
       "context management",
       "information retrieval",
       "agentic workflows",
       "agents",
       "developer productivity",
       "embeddings",
       "rag",
       "vector database",
     ];
     const lowerPrompt = userPrompt.toLowerCase();
     userPromptTopics = domainTerms.filter(term => lowerPrompt.includes(term));
   }

   // Boost themes that match user prompt topics
   if (userPromptTopics.length > 0) {
     for (const [theme, score] of themeFreq.entries()) {
       const themeLower = theme.toLowerCase();
       const isPromptTopic = userPromptTopics.some(
         topic => themeLower.includes(topic) || topic.includes(themeLower)
       );
       if (isPromptTopic) {
         themeFreq.set(theme, score * 2.5);
       }
     }
   }

   const themes = Array.from(themeFreq.entries())
     .sort((a, b) => b[1] - a[1])
     .slice(0, 5)
     .map(([t]) => t);

  // Build categorized digest text for LLM
  const categorizedContent = Array.from(byCategory.entries())
    .map(([catName, categoryDigests]) => {
      const itemsList = categoryDigests
        .map(d => {
          // Build attribution line: sourceTitle + author + originalSource
          const attributions: string[] = [];
          if (d.sourceTitle) attributions.push(d.sourceTitle);
          if (d.author) attributions.push(`by ${d.author}`);
          if (d.originalSource && d.originalSource !== d.sourceTitle?.toLowerCase()) {
            attributions.push(`on ${d.originalSource}`);
          }
          const attribution = attributions.join(" · ");

          return `- **[${d.title}](${d.url})** — *${attribution}*\n  ${d.whyItMatters}`;
        })
        .join("\n");
      return `## ${catName}\n\n${itemsList}`;
    })
    .join("\n\n");

  if (!apiKey) {
    // Fallback: return basic structure
    logger.warn("No OPENAI_API_KEY for synthesis, using basic template");
    return generateNewsletterFallback(
      digests.map(d => ({
        title: d.title,
        url: d.url, // CRITICAL: preserve URL from digest
        sourceTitle: d.sourceTitle,
        category: d.category,
        summary: d.gist,
        contentSnippet: d.keyBullets.join(" "),
        llmScore: { tags: d.topicTags, relevance: d.userRelevanceScore, usefulness: 0 },
        finalScore: Math.min(1, d.userRelevanceScore / 10),
      } as unknown as RankedItem)),
      periodLabel
    );
  }

  // Filter by user relevance score BEFORE quality review
  // Items with score < 3 are likely off-topic for the user's focus areas
  const MIN_RELEVANCE_SCORE = 3;
  const relevantDigests = digests.filter((d) => d.userRelevanceScore >= MIN_RELEVANCE_SCORE);

  if (relevantDigests.length < digests.length) {
    logger.info("Filtered low-relevance digests", {
      totalDigests: digests.length,
      relevantDigests: relevantDigests.length,
      filtered: digests.length - relevantDigests.length,
      minScore: MIN_RELEVANCE_SCORE,
    });
  }

  // Review remaining digests for quality issues BEFORE summary generation
  const review = await reviewNewsletter("", relevantDigests);
  const filteredDigests = relevantDigests.filter((d) => !review.digestsWithIssues.has(d.id));

  if (review.issues.length > 0) {
    logger.warn("Filtering out low-quality digests", {
      totalDigests: relevantDigests.length,
      filtered: relevantDigests.length - filteredDigests.length,
      issues: review.issues.slice(0, 3),
    });
  }

  // Use filtered digests for newsletter
  const usedDigests = filteredDigests.length > 0 ? filteredDigests : digests;
  const byCategory2 = groupByResourceCategory(usedDigests);

  // Build summary from digests (async LLM-based)
  const summaryText = await buildExecutiveSummary(usedDigests, themes);

  // Build markdown directly from categorized digests
  const markdown = buildNewsletterMarkdown(byCategory2, periodLabel, summaryText);

  // Build HTML from markdown
  const html = buildNewsletterHTML(markdown, summaryText);

  logger.info("Newsletter passed quality filters", {
    totalDigests: digests.length,
    includedDigests: usedDigests.length,
    filtered: digests.length - usedDigests.length,
  });

  logger.info("Newsletter synthesis complete", {
    summaryLength: summaryText.length,
    markdownLength: markdown.length,
    categoriesCount: byCategory.size,
    itemsCount: digests.length,
    reviewPassed: review.passed,
    reviewIssueCount: review.issues.length,
  });

  return {
    summary: summaryText,
    themes,
    markdown,
    html,
  };
}

/**
 * Fallback newsletter template when LLM is unavailable
 */
function generateNewsletterFallback(
  items: RankedItem[],
  periodLabel: string
): NewsletterContent {
  // Group by category
  const byCategory = new Map<Category, RankedItem[]>();
  for (const item of items) {
    const cat = item.category || "tech_articles"; // Default to tech_articles if missing
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push(item);
  }

  // Extract themes - weighted by frequency AND score
  const themeFreq = new Map<string, { count: number; avgScore: number }>();
  for (const item of items) {
    for (const tag of item.llmScore.tags) {
      const current = themeFreq.get(tag) || { count: 0, avgScore: 0 };
      current.count += 1;
      current.avgScore = (current.avgScore * (current.count - 1) + item.finalScore) / current.count;
      themeFreq.set(tag, current);
    }
  }
  const themes = Array.from(themeFreq.entries())
    .sort((a, b) => (b[1].avgScore * b[1].count) - (a[1].avgScore * a[1].count))
    .slice(0, 8)
    .map(([t]) => t);

  // Build markdown with professional header
  const title = `Code Intelligence Digest`;
  const subtitle = `${periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)} Update`;
  const publishDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  let markdown = `# ${title}\n`;
  markdown += `## ${subtitle}\n`;
  markdown += `**Published:** ${publishDate} | **Items:** ${items.length}\n\n`;

  // Get top items for insightful summary
  const topItems = Array.from(items).sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0)).slice(0, 5);
  const topThemes = themes.slice(0, 4).map(t => t.replace(/-/g, " "));

  // Build a more substantive executive summary
  const sourceScores = new Map<string, number>();
  for (const item of items) {
    const score = item.finalScore || 0;
    sourceScores.set(item.sourceTitle, Math.max(sourceScores.get(item.sourceTitle) || 0, score));
  }
  const topSources = Array.from(sourceScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([src]) => src);

  markdown += `## Executive Summary\n\n`;
  markdown += `This ${periodLabel} digest features **${items.length} curated items** focused on code search, semantic IR, agentic workflows, and developer tooling. `;
  markdown += `Emerging themes: **${topThemes.join("**, **")}**. `;
  markdown += `\n\nThe community is advancing context management techniques, multi-step reasoning patterns, and productivity infrastructure—with particular momentum in benchmarking methodologies and enterprise-scale codebase tooling. `;
  markdown += `Featured sources include ${topSources.join(", ")}.\n\n`;

  // Group by category and synthesize (markdown only)
  for (const [category, categoryItems] of byCategory) {
    if (!category || categoryItems.length === 0) continue;
    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, " ");
    markdown += `## ${categoryLabel}\n\n`;

    // Sort by score and take top items
    const topItems = categoryItems.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0)).slice(0, 7);

    for (const item of topItems) {
      const score = Math.round((item.finalScore || 0) * 100);
      const desc = item.summary || item.contentSnippet || "No description available.";
      const firstLine = desc.split("\n")[0].substring(0, 250);

      markdown += `**[${item.title}](${item.url})**\n`;
      markdown += `*${item.sourceTitle}*\n\n`;
      markdown += `${firstLine}${firstLine.length >= 250 ? "..." : ""}\n\n`;
    }
  }

  // Build HTML with professional header and dark theme
  const html = `<article style="font-family: system-ui, -apple-system, sans-serif; color: #e8e8e8; background: #1a1a1a;">
  <header style="border-bottom: 2px solid #0066cc; padding-bottom: 1.5rem; margin-bottom: 2rem;">
  <h1 style="margin: 0 0 0.5rem 0; font-size: 2.5em; color: #0066cc;">Code Intelligence Digest</h1>
  <h2 style="margin: 0 0 1rem 0; font-size: 1.3em; color: #e8e8e8; font-weight: 500;">${subtitle}</h2>
  <p style="margin: 0; color: #aaa; font-size: 0.95em;"><em>Published ${publishDate} | ${items.length} curated items</em></p>
  </header>
  <section style="margin-bottom: 2rem;">
  <h2 style="font-size: 1.5em; color: #0066cc; border-bottom: 1px solid #333; padding-bottom: 0.5rem;">Executive Summary</h2>
  <p style="line-height: 1.7; font-size: 1.05em; color: #e8e8e8;">This ${periodLabel} digest features <strong>${items.length} curated items</strong> focused on code search, semantic IR, agentic workflows, and developer tooling. Emerging themes: <strong>${topThemes.join("</strong>, <strong>")}</strong>.</p>
  <p style="line-height: 1.7; color: #aaa;">The community is advancing context management techniques, multi-step reasoning patterns, and productivity infrastructure—with particular momentum in benchmarking methodologies and enterprise-scale codebase tooling. Featured sources include ${topSources.join(", ")}.</p>
  </section>
  ${Array.from(byCategory.entries())
  .filter(([category]) => category && category.length > 0)
  .map(
    ([category, categoryItems]) => `
  <section style="margin-bottom: 2rem;">
  <h2 style="font-size: 1.5em; color: #0066cc; border-bottom: 1px solid #333; padding-bottom: 0.5rem;">${category.charAt(0).toUpperCase()}${category.slice(1).replace(/_/g, " ")}</h2>
  ${categoryItems
  .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))
  .slice(0, 7)
  .map(
    (item) => {
      const desc = (item.summary || item.contentSnippet || "").split("\n")[0].substring(0, 250);
      return `
  <article style="margin-bottom: 1.5rem; padding: 1.25rem; border-left: 4px solid #0066cc; background: #252525;">
  <h3 style="margin: 0 0 0.5rem 0; font-size: 1.1em;"><a href="${item.url}" style="color: #0066cc; text-decoration: none; font-weight: 600;">${item.title}</a></h3>
  <p style="margin: 0.25rem 0; font-size: 0.9em; color: #aaa;"><em>${item.sourceTitle}</em></p>
  <p style="margin: 0.75rem 0 0 0; line-height: 1.6; color: #ccc;">${desc}${desc.length >= 250 ? "..." : ""}</p>
  </article>
  `;
    }
  )
  .join("")}
  </section>
  `
  )
  .join("")}
  </article>`;

  return {
    summary: `This ${periodLabel} code intelligence digest synthesizes ${items.length} curated items across code search, semantic IR, agentic workflows, and enterprise developer tooling. Key themes emerging this period: ${themes.slice(0, 3).map(t => t.replace(/-/g, " ")).join(", ")}. Featured sources: ${topSources.join(", ")}. The sector continues accelerating context management, multi-step reasoning, and codebase-scale productivity infrastructure with expanding benchmark ecosystems.`,
    themes,
    markdown,
    html,
  };
  }

  /**
   * Build executive summary from digests using LLM
   */
  async function buildExecutiveSummary(digests: ItemDigest[], themes: string[]): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return buildExecutiveSummaryFallback(digests, themes);
    }

    const client = new OpenAI({ apiKey });

    // Use more items for richer context
    const itemCount = Math.min(15, digests.length);
    const itemSummaries = digests
      .slice(0, itemCount)
      .map(d => `- **${d.title}** (${d.sourceTitle}): ${d.whyItMatters}${d.keyBullets.length > 0 ? ` Key point: ${d.keyBullets[0]}` : ""}`)
      .join("\n");

    try {
       logger.info(`Generating LLM summary for ${digests.length} digests with themes: ${themes.slice(0, 3).join(", ")}`);

       const response = await client.chat.completions.create({
         model: "gpt-4o-mini",
         max_completion_tokens: 600,
         messages: [
           {
             role: "user",
             content: `Write a 300-400 word executive summary for a code intelligence digest. NO corporate language. NO AI-speak. Be direct and specific.

    **Featured Topics:** ${themes.join(", ") || "code search, context management, agents, information retrieval, developer productivity"}

    **Key Items Featured:**
    ${itemSummaries}

    **Target Audience:** Sourcegraph engineering and leadership evaluating code search, coding agents, information retrieval, and developer productivity.

    **What NOT to do:**
    - Avoid: "highlights," "underscores," "shapes," "fosters," "landscape," "emerging," "approaches," "methodologies"
    - Avoid treating trends as active agents. Say "Google's approach" not "this trend showcases"
    - Avoid vague corporate language. Say what actually happened/was built/was proven
    - No bullet-point lists
    - No AI-style verbose preamble

    **What to do:**
    1. Open with the single most important finding or shift. Be specific (e.g., "LLM-based code search is scaling to 100M+ LOC" not "code search is advancing")
    2. Organize around 3-4 concrete developments:
      - Specific company/project approach (what they built, how it works)
      - What problem it solves or challenge it addresses
      - Performance numbers or real-world results if available
      - Competitive/strategic implication for code search/agents/IR
    3. Cite specific items and sources. Use authors' names and actual findings
    4. For competitive insights: mention specific companies and concrete product capabilities
    5. Close with the practical implication: what does this mean teams should evaluate or explore

    **Tone:** Like an engineering memo or analyst report. Direct, evidence-based, no speculation.

    Write substantive paragraphs. Ground every claim in the actual items provided.`,
           },
         ],
       });

      const content = response.choices[0].message.content;
      if (!content || content.trim().length === 0) {
        logger.warn("LLM returned empty response, using fallback", {
          model: "gpt-4o-mini",
          responseId: response.id,
          finishReason: response.choices[0]?.finish_reason,
          usage: response.usage,
        });
        // Try fallback to gpt-4o-mini if primary model fails
        try {
          logger.info("Attempting fallback to gpt-4o-mini");
          const fallbackResponse = await client.chat.completions.create({
            model: "gpt-4o-mini",
            max_completion_tokens: 600,
            messages: [
              {
                role: "user",
                content: `Write a 300-400 word executive summary for a code intelligence digest. NO corporate language. NO AI-speak. Be direct and specific.

**Featured Topics:** ${themes.join(", ") || "code search, context management, agents, information retrieval, developer productivity"}

**Key Items Featured:**
${itemSummaries}

Write substantive paragraphs. Ground every claim in the actual items provided.`,
              },
            ],
          });
          const fallbackContent = fallbackResponse.choices[0].message.content;
          if (fallbackContent && fallbackContent.trim().length > 0) {
            logger.info(`Fallback model (gpt-4o-mini) generated summary: ${fallbackContent.length} chars`);
            return fallbackContent;
          }
        } catch (fallbackError) {
          logger.warn("Fallback model also failed", {
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
        return buildExecutiveSummaryFallback(digests, themes);
      }
      logger.info(`LLM summary generated: ${content.length} chars`);
      return content;
      } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logger.warn("Failed to generate LLM summary, using fallback", {
        error: errorMsg,
        stack: e instanceof Error ? e.stack : undefined,
        model: "gpt-4o-mini",
      });
      // If it's a model error, try fallback model
      if (errorMsg.includes("model") || errorMsg.includes("not found") || errorMsg.includes("invalid")) {
        try {
          logger.info("Model error detected, attempting fallback to gpt-4o-mini");
          const client = new OpenAI({ apiKey });
          const fallbackResponse = await client.chat.completions.create({
            model: "gpt-4o-mini",
            max_completion_tokens: 600,
            messages: [
              {
                role: "user",
                content: `Write a 300-400 word executive summary for a code intelligence digest focusing on: ${themes.join(", ")}`,
              },
            ],
          });
          const fallbackContent = fallbackResponse.choices[0].message.content;
          if (fallbackContent && fallbackContent.trim().length > 0) {
            logger.info(`Fallback model (gpt-4o-mini) generated summary: ${fallbackContent.length} chars`);
            return fallbackContent;
          }
        } catch (fallbackError) {
          logger.warn("Fallback model also failed", {
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
      }
      return buildExecutiveSummaryFallback(digests, themes);
      }
  }

  /**
   * Fallback summary template (avoids AI-like language, focuses on actual insights)
   */
  function buildExecutiveSummaryFallback(digests: ItemDigest[], themes: string[]): string {
    // Extract real, concrete insights from top digests
    const topItems = digests.slice(0, 10);
    const insights: string[] = [];

    // Build specific insights from actual content (not templates)
    for (const item of topItems) {
      // Use whyItMatters if it contains actual findings
      if (item.whyItMatters && !item.whyItMatters.match(/^(This|The|Research|provides|relevant)/i)) {
        insights.push(item.whyItMatters);
      } else if (item.keyBullets && item.keyBullets.length > 0) {
        // Otherwise use key bullets
        const bullet = item.keyBullets[0];
        if (bullet && bullet.length > 30) {
          insights.push(bullet);
        }
      }
    }

    // Get unique insights
    const uniqueInsights = Array.from(new Set(insights.map(i => i.trim()))).slice(0, 4);

    // Build summary with actual findings
    let summary = "";

    // Start with what's actually being covered
    const topSources = Array.from(new Set(digests.map(d => d.sourceTitle))).slice(0, 3);

    if (uniqueInsights.length > 0) {
      summary = uniqueInsights.join(" ");
      if (summary.length < 200) {
        // If too short, add topic context
        const topThemes = themes.slice(0, 3).join(", ");
        summary += ` These updates cover ${topThemes}.`;
      }
    } else {
      // Minimal fallback
      const topThemes = themes.slice(0, 3).join(", ");
      summary = `This digest covers ${topThemes}. Content from ${topSources.join(", ")}.`;
    }

    return summary;
  }

  /**
   * Build markdown newsletter directly from categorized digests
   */
  function buildNewsletterMarkdown(byCategory: Map<string, ItemDigest[]>, periodLabel: string, summary?: string): string {
    const publishDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    let markdown = `# Code Intelligence Digest\n\n`;
    markdown += `${periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)} Edition — ${publishDate}\n\n`;

    if (summary) {
      markdown += `## Overview\n\n${summary}\n\n`;
    }

    // Build each category section
    for (const [categoryName, items] of byCategory) {
      if (!categoryName || items.length === 0) continue;

      markdown += `## ${categoryName}\n\n`;

      for (const item of items) {
         // Only create a link if the URL is valid (not Inoreader, not empty)
         const urlValid = isValidUrl(item.url);
         if (!urlValid) {
           logger.warn(`[URL_MISSING] ${categoryName} item without valid URL: title="${item.title.substring(0, 50)}...", url="${item.url}", source="${item.sourceTitle}"`);
         }
         const titleMD = urlValid
           ? `**[${item.title}](${item.url})**`
           : `**${item.title}**`;
         markdown += `- ${titleMD} — *${item.sourceTitle}*\n`;
         markdown += `  ${item.whyItMatters}\n\n`;
       }
    }

    return markdown;
  }

  /**
   * Convert markdown newsletter to semantic HTML with light theme
   */
  function buildNewsletterHTML(markdown: string, summary?: string): string {
    let html = markdown;

    // Convert markdown headers (before links, so we can detect them)
    html = html.replace(/^# (.*?)$/gm, '<h1 style="color: #1a1a1a; margin-bottom: 0.25rem; font-size: 2.5em; font-weight: 700;">$1</h1>');
    html = html.replace(/^## (.*?)$/gm, '<h2 style="color: #1a1a1a; margin-top: 2rem; margin-bottom: 0.75rem; font-size: 1.5em; font-weight: 600;">$1</h2>');

    // Convert links BEFORE bold/italic (so we don't accidentally format link text)
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="color: #0066cc; text-decoration: none; font-weight: 500;" target="_blank" rel="noopener noreferrer">$1</a>');

    // Convert bold and italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight: 600; color: #1a1a1a;">$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em style="font-style: italic; color: #555;">$1</em>');

    // Convert list items: collapse consecutive lines starting with - into a list
    const lines = html.split('\n');
    const result: string[] = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.match(/^- /)) {
        if (!inList) {
          result.push('<ul style="margin-left: 1.5rem; margin-bottom: 1.5rem; list-style: none; padding: 0;">');
          inList = true;
        }
        // Remove leading dash and convert to list item
        const itemText = line.replace(/^- /, '').trim();
        result.push(`<li style="margin-bottom: 0.75rem; line-height: 1.6; color: #333; padding-left: 1.5rem; position: relative;"><span style="position: absolute; left: 0;">•</span> ${itemText}</li>`);
      } else {
        if (inList) {
          result.push('</ul>');
          inList = false;
        }

        // Handle paragraph breaks (empty lines)
        if (line.trim() === '') {
          // Skip empty lines; they'll be handled by CSS margins
        } else if (line.match(/^<h[1-2]/)) {
          // Don't wrap headers in paragraph
          result.push(line);
        } else {
          // Wrap regular text in paragraph
          result.push(`<p style="line-height: 1.7; color: #333; margin-bottom: 1rem; font-size: 1rem;">${line}</p>`);
        }
      }
    }

    if (inList) {
      result.push('</ul>');
    }

    html = result.join('\n');

    return `<article style="font-family: system-ui, -apple-system, sans-serif; color: #333; background: #ffffff; padding: 3rem 2rem;">
    <div style="max-width: 900px; margin: 0 auto;">
      ${html}
    </div>
  </article>`;
  }
