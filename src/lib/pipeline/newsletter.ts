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
  profile: PromptProfile | null
): Promise<NewsletterContent> {
  const periodLabel = period === "week" ? "weekly" : "monthly";
  return generateNewsletterFromDigestData(digests, periodLabel);
}

/**
 * Generate newsletter directly from ItemDigest data (better quality)
 */
function generateNewsletterFromDigestData(
  digests: ItemDigest[],
  periodLabel: string
): NewsletterContent {
  // Group by category (infer from topics)
  const byCategory = new Map<string, ItemDigest[]>();
  for (const digest of digests) {
    const cat = digest.topicTags[0] || "tech_articles";
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push(digest);
  }

  // Extract themes - weighted by frequency AND score
  const themeFreq = new Map<string, { count: number; avgScore: number }>();
  for (const digest of digests) {
    for (const tag of digest.topicTags) {
      const current = themeFreq.get(tag) || { count: 0, avgScore: 0 };
      current.count += 1;
      current.avgScore = (current.avgScore * (current.count - 1) + digest.userRelevanceScore / 10) / current.count;
      themeFreq.set(tag, current);
    }
  }
  const themes = Array.from(themeFreq.entries())
    .sort((a, b) => (b[1].avgScore * b[1].count) - (a[1].avgScore * a[1].count))
    .slice(0, 8)
    .map(([t]) => t);

  // Build executive summary from top items' "why it matters"
  const topDigests = [...digests].sort((a, b) => b.userRelevanceScore - a.userRelevanceScore).slice(0, 5);
  const keyInsights = topDigests
    .map(d => d.whyItMatters)
    .filter(Boolean)
    .slice(0, 3);

  const subtitle = `${periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)} Update`;
  const publishDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const topSources = Array.from(new Set(digests.map(d => d.sourceTitle))).slice(0, 3);

  // Build markdown
  let markdown = `# Code Intelligence Digest\n`;
  markdown += `## ${subtitle}\n`;
  markdown += `**Published:** ${publishDate} | **Items:** ${digests.length}\n\n`;
  markdown += `## Executive Summary\n\n`;
  markdown += `This ${periodLabel} digest features **${digests.length} curated items** focused on code search, semantic IR, agentic workflows, and developer tooling. `;
  markdown += `Emerging themes: **${themes.slice(0, 4).map(t => t.replace(/-/g, " ")).join("**, **")}**.\n\n`;
  
  if (keyInsights.length > 0) {
    markdown += `Key developments:\n`;
    keyInsights.forEach(insight => {
      markdown += `- ${insight}\n`;
    });
    markdown += `\n`;
  }

  markdown += `Featured sources: ${topSources.join(", ")}.\n\n`;

  // Group by topic and render items
  for (const [topic, categoryDigests] of byCategory) {
    if (!categoryDigests.length) continue;
    const categoryLabel = topic.charAt(0).toUpperCase() + topic.slice(1).replace(/_|-/g, " ");
    markdown += `## ${categoryLabel}\n\n`;
    
    // Sort by relevance
    const sorted = categoryDigests.sort((a, b) => b.userRelevanceScore - a.userRelevanceScore).slice(0, 7);
    
    for (const digest of sorted) {
      markdown += `**[${digest.title}](${digest.url})**\n`;
      markdown += `*${digest.sourceTitle}*\n\n`;
      markdown += `${digest.whyItMatters}\n\n`;
    }
  }

  // Build HTML
  const html = `<article style="font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a;">
 <header style="border-bottom: 2px solid #0066cc; padding-bottom: 1.5rem; margin-bottom: 2rem;">
   <h1 style="margin: 0 0 0.5rem 0; font-size: 2.5em; color: #0066cc;">Code Intelligence Digest</h1>
   <h2 style="margin: 0 0 1rem 0; font-size: 1.3em; color: #333; font-weight: 500;">${subtitle}</h2>
   <p style="margin: 0; color: #666; font-size: 0.95em;"><em>Published ${publishDate} | ${digests.length} curated items</em></p>
 </header>
 <section style="margin-bottom: 2rem;">
   <h2 style="font-size: 1.5em; color: #0066cc; border-bottom: 1px solid #ddd; padding-bottom: 0.5rem;">Executive Summary</h2>
   <p style="line-height: 1.7; font-size: 1.05em; color: #1a1a1a;">This ${periodLabel} digest features <strong>${digests.length} curated items</strong> focused on code search, semantic IR, agentic workflows, and developer tooling. Emerging themes: <strong>${themes.slice(0, 4).map(t => t.replace(/-/g, " ")).join("</strong>, <strong>")}</strong>.</p>
   ${keyInsights.length > 0 ? `<div style="margin-top: 1rem;"><strong>Key developments:</strong><ul style="margin: 0.5rem 0; padding-left: 1.5rem;">${keyInsights.map(insight => `<li style="margin: 0.5rem 0; color: #333;">${insight}</li>`).join("")}</ul></div>` : ""}
   <p style="margin-top: 1rem; color: #333;">Featured sources: ${topSources.join(", ")}.</p>
 </section>
 ${Array.from(byCategory.entries())
   .filter(([, items]) => items.length > 0)
   .map(
     ([topic, categoryDigests]) => {
       const categoryLabel = topic.charAt(0).toUpperCase() + topic.slice(1).replace(/_|-/g, " ");
       return `
 <section style="margin-bottom: 2rem;">
   <h2 style="font-size: 1.5em; color: #0066cc; border-bottom: 1px solid #ddd; padding-bottom: 0.5rem;">${categoryLabel}</h2>
   ${categoryDigests
     .sort((a, b) => b.userRelevanceScore - a.userRelevanceScore)
     .slice(0, 7)
     .map(
       (digest) => `
   <article style="margin-bottom: 1.5rem; padding: 1.25rem; border-left: 4px solid #0066cc; background: #f8f9fa;">
     <h3 style="margin: 0 0 0.5rem 0; font-size: 1.1em;"><a href="${digest.url}" style="color: #0066cc; text-decoration: none; font-weight: 600;">${digest.title}</a></h3>
     <p style="margin: 0.25rem 0 0.75rem 0; font-size: 0.9em; color: #555;"><em>${digest.sourceTitle}</em></p>
     <p style="margin: 0; color: #333; line-height: 1.6;">${digest.whyItMatters}</p>
   </article>
   `
     )
     .join("")}
 </section>
 `;
     }
   )
   .join("")}
 </article>`;

  return {
    summary: `This ${periodLabel} digest synthesizes ${digests.length} curated items focusing on code search, semantic IR, agentic workflows, and enterprise developer tooling. Key themes: ${themes.slice(0, 3).map(t => t.replace(/-/g, " ")).join(", ")}. Leading sources: ${topSources.join(", ")}.`,
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
