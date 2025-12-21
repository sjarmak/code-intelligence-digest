/**
 * Newsletter generation
 * Synthesizes ranked items into a structured newsletter with summary and HTML
 */

import OpenAI from "openai";
import { RankedItem, Category } from "../model";
import { PromptProfile } from "./promptProfile";
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
 * Build synthesis context from selected items
 */
function buildSynthesisContext(items: RankedItem[]): string {
  return items
    .map((item, idx) => {
      const text = truncateForLLM(item.fullText || item.summary || item.contentSnippet, 1200);
      const score = Math.min(100, Math.round(item.finalScore * 100));
      return `[${idx + 1}] "${item.title}" — ${item.sourceTitle} (${item.author || "Unknown"}) | Score: ${score}
URL: ${item.url}
${text ? `Content: ${text}` : "Content: No text available"}
Tags: ${item.llmScore.tags.join(", ")}
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
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: `Generate a ${periodLabel} code intelligence digest newsletter from these items.

Categories: ${categoryLabels}
${profile ? `User focus: ${profile.focusTopics.join(", ")}` : ""}

Items (numbered 1-${items.length}):
${synthesisContext}

Generate JSON with:
- summary: 100-150 word executive summary focusing on trends and actionable insights
- themes: 3-8 key theme strings (e.g., "code-search", "agents", "context-management")
- markdown: Complete markdown newsletter with:
  * H1 title "Code Intelligence Digest"
  * Executive summary section
  * Sections per category (H2)
  * Each item as "[Title](url) — SourceTitle — Score: 0.XX" with 1-2 sentence grounded description
  * 2-4 callout boxes with ">" for standout items
  * No fabricated content, only from provided text
- html: Clean semantic HTML version of markdown (use <article>, <section>, <h1>-<h2>, <p>, <blockquote>, etc.)

Return only valid JSON.`,
          },
        ],
      });

      const content = response.choices[0].message.content;
      if (content) {
        const parsed = JSON.parse(content);
        summary = parsed.summary || "No summary generated.";
        themes = Array.isArray(parsed.themes) ? parsed.themes : [];
        markdown = parsed.markdown || "# Code Intelligence Digest\n\nNo content generated.";
        html = parsed.html || "<article><h1>Code Intelligence Digest</h1><p>No content generated.</p></article>";
      } else {
        throw new Error("No content returned from LLM");
      }
    } catch (error) {
      logger.warn("LLM newsletter generation failed, using fallback template", { error });
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
 * Fallback newsletter template when LLM is unavailable
 */
function generateNewsletterFallback(
  items: RankedItem[],
  periodLabel: string
): NewsletterContent {
  // Group by category
  const byCategory = new Map<Category, RankedItem[]>();
  for (const item of items) {
    if (!byCategory.has(item.category)) {
      byCategory.set(item.category, []);
    }
    byCategory.get(item.category)!.push(item);
  }

  // Extract themes
  const themeFreq = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.llmScore.tags) {
      themeFreq.set(tag, (themeFreq.get(tag) || 0) + 1);
    }
  }
  const themes = Array.from(themeFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t);

  // Build markdown
  let markdown = `# Code Intelligence Digest – ${periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1)} Digest\n\n`;
  markdown += `Generated: ${new Date().toLocaleDateString()}\n\n`;
  markdown += `This digest covers ${items.length} items across key topics including ${themes.slice(0, 3).join(", ")}.\n\n`;

  for (const [category, categoryItems] of byCategory) {
    markdown += `## ${category.charAt(0).toUpperCase()}${category.slice(1).replace(/_/g, " ")}\n\n`;
    for (const item of categoryItems.slice(0, 5)) {
      const score = Math.round(item.finalScore * 100);
      const desc = item.summary || item.contentSnippet || "No description available.";
      markdown += `- [${item.title}](${item.url}) — ${item.sourceTitle} — Score: ${score}\n`;
      markdown += `  ${desc.split("\n")[0]}\n\n`;
    }
  }

  // Build HTML
  const html = `<article>
<h1>Code Intelligence Digest</h1>
<p>This ${periodLabel} digest covers ${items.length} items across ${Array.from(byCategory.keys()).join(", ")}.</p>
<p>Key themes: ${themes.slice(0, 3).join(", ")}</p>
${Array.from(byCategory.entries())
  .map(
    ([category, categoryItems]) => `
<section>
<h2>${category.charAt(0).toUpperCase()}${category.slice(1).replace(/_/g, " ")}</h2>
<ul>
${categoryItems
  .slice(0, 5)
  .map(
    (item) => `
<li>
  <a href="${item.url}">${item.title}</a> — ${item.sourceTitle}
  <p>${(item.summary || item.contentSnippet || "").split("\n")[0]}</p>
</li>
`
  )
  .join("")}
</ul>
</section>
`
  )
  .join("")}
</article>`;

  return {
    summary: `This ${periodLabel} code intelligence digest covers ${items.length} items focused on ${themes.slice(0, 3).join(", ")}. The community continues to prioritize developer productivity, advanced context management, and agentic workflow patterns.`,
    themes,
    markdown,
    html,
  };
}
