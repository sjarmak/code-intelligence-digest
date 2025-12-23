/**
 * Newsletter review and quality gate
 * Checks final digests for:
 * - Bad URLs (advertise, digest collections, meta pages)
 * - AI-style writing in blurbs (overused vocabulary, inanimate subjects)
 * - Over-focus on Sourcegraph / heavy keyword stuffing
 * - Generic boilerplate language
 */

import OpenAI from "openai";
import { ItemDigest } from "./extract";
import { logger } from "../logger";

const BAD_URL_DOMAINS = [
  "csharpdigest.com",
  "leadershipintech.com",
  "reactdigest.com",
  "programmingdigest.net",
  "newsletter-digest",
  "bonobopress.com",
];

const BAD_URL_PATTERNS = [
  /\/advertis(e|ing)/i,
  /\/sponsor/i,
  /\/media-kit/i,
  /\/unsubscribe/i,
  /\/subscribe/i,
  /\/privacy/i,
  /\/terms/i,
  /\/press/i,
  // Reddit URLs - discussion threads, not primary sources
  /reddit\.com\/r\//i,
  /reddit\.com\/u\//i,
  /reddit\.com\/user\//i,
  // Google News redirect URLs (not actual articles)
  /news\.google\.com\/rss\/articles\//i,
];

const AI_LANGUAGE_WORDS = [
  "highlights",
  "underscores",
  "shapes",
  "fosters",
  "emerging",
  "landscape",
  "approaches",
  "methodologies",
  "ecosystem",
  "leveraging",
  "harnessing",
  "delve",
  "showcase",
  "explore",
  "unpack",
];

export interface ReviewResult {
  passed: boolean;
  issues: string[];
  digestsWithIssues: Set<string>; // digest IDs that have problems
}

/**
 * Check if URL looks like a bad link
 */
function isBadUrl(url: string): boolean {
  if (!url) return true;

  // Check domain blocklist
  for (const domain of BAD_URL_DOMAINS) {
    if (url.includes(domain)) {
      return true;
    }
  }

  // Check bad patterns
  for (const pattern of BAD_URL_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }

  // Check for redirect/tracking URLs that point to meta pages
  // Pattern: /links/ paths typically redirect to collection pages
  if (url.includes("/links/") && url.match(/programmingdigest|digest/i)) {
    return true;
  }

  // Check for newsletter index patterns in URLs
  if (
    /newsletters?\/\d+|issues?\/\d+|archive|index|(?:\/\d+$)/.test(
      url.replace(/\?.*$/, "")
    ) &&
    url.match(/programmingdigest|csharpdigest|leadershipintech|reactdigest/i)
  ) {
    return true;
  }

  return false;
}

/**
 * Check if text contains AI-like language patterns
 */
function hasAILanguage(text: string): string[] {
  const issues: string[] = [];
  const lowerText = text.toLowerCase();

  // Check for overused AI vocabulary
  let aiWordCount = 0;
  for (const word of AI_LANGUAGE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = lowerText.match(regex);
    if (matches) {
      aiWordCount += matches.length;
      issues.push(`Overused AI word: "${word}" (${matches.length}x)`);
    }
  }

  // Check for inanimate subject patterns ("this trend showcases", "the paper highlights")
  if (
    /(this|that|the|research|finding|trend|approach|method)\s+(highlights|underscores|shapes|shows|demonstrates|indicates)/i.test(
      text
    )
  ) {
    issues.push("Possible inanimate subject doing human action");
  }

  // Check for corporate preamble language
  if (/^(This|The|Research|Studies?)\s+(further|also)?\s*(highlights|shows|demonstrates)/i.test(text)) {
    issues.push("Corporate preamble pattern detected");
  }

  return issues;
}

/**
 * Check if text is overly focused on Sourcegraph or keyword-stuffed
 */
function hasSourcegraphBias(text: string): string[] {
  const issues: string[] = [];

  // Check for excessive Sourcegraph mentions
  const sourceGraphMatches = (text.match(/sourcegraph/gi) || []).length;
  if (sourceGraphMatches > 2) {
    issues.push(`Over-mentions Sourcegraph (${sourceGraphMatches}x)`);
  }

  // Check for keyword stuffing (common keywords repeated)
  const keywords = ["code search", "context management", "agents", "information retrieval"];
  let keywordCount = 0;
  for (const kw of keywords) {
    const matches = (text.match(new RegExp(kw, "gi")) || []).length;
    keywordCount += matches;
  }

  if (keywordCount > 4) {
    issues.push(`Heavy keyword stuffing detected (${keywordCount} keyword mentions)`);
  }

  // Check for generic corporate language
  if (/teams (should|can|must) (evaluate|explore|understand)/i.test(text)) {
    issues.push("Generic corporate advice pattern");
  }

  return issues;
}

/**
 * Review digests for quality issues
 * Returns issues found and list of digest IDs with problems
 */
export function reviewDigests(digests: ItemDigest[]): ReviewResult {
  const issues: string[] = [];
  const digestsWithIssues = new Set<string>();

  // Check each digest
  for (const digest of digests) {
    const digestIssues: string[] = [];

    // 1. Check URL
    if (isBadUrl(digest.url)) {
      digestIssues.push(`Bad URL domain/pattern: ${digest.url}`);
    }

    // 2. Check gist for AI language
    const gistIssues = hasAILanguage(digest.gist);
    if (gistIssues.length > 0) {
      digestIssues.push(`Gist has AI language: ${gistIssues.join("; ")}`);
    }

    // 3. Check whyItMatters for AI language and Sourcegraph bias
    const whyIssues = hasAILanguage(digest.whyItMatters);
    const biasIssues = hasSourcegraphBias(digest.whyItMatters);
    if (whyIssues.length > 0) {
      digestIssues.push(`Why It Matters has AI language: ${whyIssues.join("; ")}`);
    }
    if (biasIssues.length > 0) {
      digestIssues.push(`Why It Matters: ${biasIssues.join("; ")}`);
    }

    // 4. Check keyBullets
    for (const bullet of digest.keyBullets) {
      const bulletIssues = hasAILanguage(bullet);
      if (bulletIssues.length > 0) {
        digestIssues.push(`Key bullet has AI language: ${bullet.substring(0, 50)}...`);
        break; // Only report first bad bullet
      }
    }

    // Record issues for this digest
    if (digestIssues.length > 0) {
      digestsWithIssues.add(digest.id);
      issues.push(`${digest.title}: ${digestIssues.join(" | ")}`);
    }
  }

  return {
    passed: digestsWithIssues.size === 0,
    issues,
    digestsWithIssues,
  };
}

/**
 * Use LLM to review final newsletter for overall quality
 */
export async function reviewNewsletterWithLLM(
  markdown: string,
  digests: ItemDigest[]
): Promise<{ passed: boolean; feedback: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.info("OPENAI_API_KEY not set, skipping LLM review");
    return { passed: true, feedback: "" };
  }

  const client = new OpenAI({ apiKey });

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Review this newsletter for quality issues. Be critical.

**Markdown:**
${markdown.substring(0, 2000)}

**Digests (count: ${digests.length}):**
${digests
  .slice(0, 5)
  .map((d) => `- "${d.title}" (${d.sourceTitle}): ${d.whyItMatters.substring(0, 100)}...`)
  .join("\n")}

**Review for:**
1. Any links that look like digest collections, advertise pages, or meta links?
2. AI-style writing? (Look for: "highlights," "shapes," "underscores," "fosters," etc.)
3. Over-focus on Sourcegraph or heavy keyword stuffing from prompts?
4. Generic corporate language instead of specific findings?
5. Do the blurbs sound like they're from actual content or generic templates?

**Response format:**
Return JSON with:
- passed: boolean (true only if newsletter is high quality)
- issues: [list of specific problems found]
- recommendation: brief text on what to fix or if it's good to go

Be specific. Point to exact problems, not vague concerns.`,
        },
      ],
    });

    const content = response.choices[0].message.content;
    if (!content) {
      return { passed: true, feedback: "No LLM feedback" };
    }

    try {
      const parsed = JSON.parse(content);
      return {
        passed: parsed.passed === true,
        feedback: parsed.issues?.join("; ") || parsed.recommendation || "No feedback",
      };
    } catch {
      logger.warn("Failed to parse LLM review response", { content: content.substring(0, 200) });
      return { passed: true, feedback: "Review parse error" };
    }
  } catch (error) {
    logger.warn("LLM review failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { passed: true, feedback: "" };
  }
}

/**
 * Full newsletter review process
 */
export async function reviewNewsletter(
  markdown: string,
  digests: ItemDigest[]
): Promise<{ passed: boolean; issues: string[]; llmFeedback: string; digestsWithIssues: Set<string> }> {
  logger.info(`Starting newsletter review for ${digests.length} digests`);

  // 1. Rule-based review
  const ruleReview = reviewDigests(digests);

  // 2. LLM review (only if markdown provided)
  let llmReview = { passed: true, feedback: "" };
  if (markdown) {
    llmReview = await reviewNewsletterWithLLM(markdown, digests);
  }

  const allIssues: string[] = [];
  if (ruleReview.issues.length > 0) {
    allIssues.push(...ruleReview.issues);
  }

  // Pass only if rule-based check passes (LLM is informational)
  const passed = ruleReview.passed;

  logger.info(`Newsletter review complete`, {
    passed,
    ruleIssueCount: ruleReview.issues.length,
    digestsWithIssues: ruleReview.digestsWithIssues.size,
  });

  return {
    passed,
    issues: allIssues,
    llmFeedback: llmReview.feedback,
    digestsWithIssues: ruleReview.digestsWithIssues,
  };
}
