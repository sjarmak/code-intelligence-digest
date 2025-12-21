/**
 * Newsletter generation (Pass 2 - Synthesis)
 * Converts item digests into a polished newsletter using gpt-5.2-pro
 */

import OpenAI from "openai";
import { RankedItem, Category } from "../model";
import { PromptProfile } from "./promptProfile";
import { ItemDigest } from "./extract";
import { logger } from "../logger";

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
        model: "gpt-5.2",
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
 * Categorize items using LLM based on user prompt
 */
async function categorizItemsWithLLM(
  digests: ItemDigest[],
  userPrompt: string
): Promise<Map<string, ItemDigest[]>> {
  const client = new OpenAI();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || digests.length === 0) {
    // Fallback: group by first topic tag
    const byCategory = new Map<string, ItemDigest[]>();
    for (const digest of digests) {
      const cat = digest.topicTags[0]?.replace(/_|-/g, " ") || "Other";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(digest);
    }
    return byCategory;
  }

  try {
    const itemsList = digests.map((d, idx) => `${idx + 1}. "${d.title}" - ${d.whyItMatters}`).join("\n");

    const response = await client.chat.completions.create({
      model: "gpt-5.2-chat-latest",
      max_completion_tokens: 1000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `Given this user focus: "${userPrompt}"

Categorize these items into logical thematic groups (3-6 categories max). Use category names that make sense for the user's interests.

Items:
${itemsList}

Return JSON with:
- categories: [{ name: "category name", items: [1, 2, 3] }]

Return ONLY valid JSON.`,
        },
      ],
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No response from LLM");

    const result = JSON.parse(content);
    const byCategory = new Map<string, ItemDigest[]>();

    for (const cat of result.categories || []) {
      byCategory.set(cat.name, (cat.items || []).map((idx: number) => digests[idx - 1]).filter(Boolean));
    }

    return byCategory;
  } catch (error) {
    logger.warn("LLM categorization failed, falling back to tag-based grouping", { error });
    const byCategory = new Map<string, ItemDigest[]>();
    for (const digest of digests) {
      const cat = digest.topicTags[0]?.replace(/_|-/g, " ") || "Other";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(digest);
    }
    return byCategory;
  }
}

/**
 * Generate newsletter directly from ItemDigest data (better quality)
 */
async function generateNewsletterFromDigestData(
  digests: ItemDigest[],
  periodLabel: string,
  userPrompt: string
): Promise<NewsletterContent> {
  const client = new OpenAI();
  const apiKey = process.env.OPENAI_API_KEY;

  // Categorize items using LLM
  const byCategory = await categorizItemsWithLLM(digests, userPrompt);

  // Extract themes for metadata
  const themeFreq = new Map<string, number>();
  for (const digest of digests) {
    for (const tag of digest.topicTags) {
      themeFreq.set(tag, (themeFreq.get(tag) || 0) + 1);
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
        .map(d => `- **${d.title}** (${d.sourceTitle})\n  ${d.whyItMatters}`)
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
        sourceTitle: d.sourceTitle,
        summary: d.gist,
        contentSnippet: d.keyBullets.join(" "),
        llmScore: { tags: d.topicTags, relevance: d.userRelevanceScore, usefulness: 0 },
        finalScore: Math.min(1, d.userRelevanceScore / 10),
      } as unknown as RankedItem)),
      periodLabel
    );
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 4000,
      reasoning_effort: "high",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `Generate a curated ${periodLabel} digest newsletter.

User Focus: ${userPrompt}

Total Items: ${digests.length}

Categorized Items:
${categorizedContent}

Generate JSON with:
- summary: 150-200 word executive summary (synthesize trends, highlight what's important for the user focus)
- themes: 4-6 key thematic tags
- markdown: Complete markdown newsletter with:
  * H1 title "Code Intelligence Digest"
  * H2 subtitle "${periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)} Update"
  * Published date and item count
  * Executive summary section
  * Category sections with items
  * Only use provided content, no fabrications
- html: Clean semantic HTML (dark theme: #1a1a1a background, #e8e8e8 text, #0066cc accents, #252525 cards)

Return ONLY valid JSON.`,
        },
      ],
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No response from LLM");

    const result = JSON.parse(content);
    return {
      summary: result.summary || "Curated weekly digest",
      themes: Array.isArray(result.themes) ? result.themes : themes,
      markdown: result.markdown || "# Code Intelligence Digest\n\nNo content generated.",
      html: result.html || "<article>No content generated.</article>",
    };
  } catch (error) {
    logger.warn("LLM synthesis failed, using fallback", { error });
    return generateNewsletterFallback(
      digests.map(d => ({
        title: d.title,
        sourceTitle: d.sourceTitle,
        summary: d.gist,
        contentSnippet: d.keyBullets.join(" "),
        llmScore: { tags: d.topicTags, relevance: d.userRelevanceScore, usefulness: 0 },
        finalScore: Math.min(1, d.userRelevanceScore / 10),
      } as unknown as RankedItem)),
      periodLabel
    );
  }
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
      markdown += `*${item.sourceTitle}* | Relevance: ${score}/100\n\n`;
      markdown += `${firstLine}${firstLine.length >= 250 ? "..." : ""}\n\n`;
    }
  }

  // Build HTML with professional header and improved contrast
  const html = `<article style="font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a;">
  <header style="border-bottom: 2px solid #0066cc; padding-bottom: 1.5rem; margin-bottom: 2rem;">
  <h1 style="margin: 0 0 0.5rem 0; font-size: 2.5em; color: #0066cc;">Code Intelligence Digest</h1>
  <h2 style="margin: 0 0 1rem 0; font-size: 1.3em; color: #333; font-weight: 500;">${subtitle}</h2>
  <p style="margin: 0; color: #666; font-size: 0.95em;"><em>Published ${publishDate} | ${items.length} curated items</em></p>
  </header>
  <section style="margin-bottom: 2rem;">
  <h2 style="font-size: 1.5em; color: #0066cc; border-bottom: 1px solid #ddd; padding-bottom: 0.5rem;">Executive Summary</h2>
  <p style="line-height: 1.7; font-size: 1.05em; color: #1a1a1a;">This ${periodLabel} digest features <strong>${items.length} curated items</strong> focused on code search, semantic IR, agentic workflows, and developer tooling. Emerging themes: <strong>${topThemes.join("</strong>, <strong>")}</strong>.</p>
  <p style="line-height: 1.7; color: #333;">The community is advancing context management techniques, multi-step reasoning patterns, and productivity infrastructure—with particular momentum in benchmarking methodologies and enterprise-scale codebase tooling. Featured sources include ${topSources.join(", ")}.</p>
  </section>
  ${Array.from(byCategory.entries())
  .filter(([category]) => category && category.length > 0)
  .map(
    ([category, categoryItems]) => `
  <section style="margin-bottom: 2rem;">
  <h2 style="font-size: 1.5em; color: #0066cc; border-bottom: 1px solid #ddd; padding-bottom: 0.5rem;">${category.charAt(0).toUpperCase()}${category.slice(1).replace(/_/g, " ")}</h2>
  ${categoryItems
  .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))
  .slice(0, 7)
  .map(
    (item) => {
      const score = Math.round((item.finalScore || 0) * 100);
      const desc = (item.summary || item.contentSnippet || "").split("\n")[0].substring(0, 250);
      return `
  <article style="margin-bottom: 1.5rem; padding: 1.25rem; border-left: 4px solid #0066cc; background: #f8f9fa;">
  <h3 style="margin: 0 0 0.5rem 0; font-size: 1.1em;"><a href="${item.url}" style="color: #0066cc; text-decoration: none; font-weight: 600;">${item.title}</a></h3>
  <p style="margin: 0.25rem 0; font-size: 0.9em; color: #555;"><em>${item.sourceTitle}</em> | Relevance: <strong>${score}/100</strong></p>
  <p style="margin: 0.75rem 0 0 0; line-height: 1.6; color: #333;">${desc}${desc.length >= 250 ? "..." : ""}</p>
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
