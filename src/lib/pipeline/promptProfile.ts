/**
 * Prompt profile extraction
 * Parses user prompt into structured intent for re-ranking guidance
 */

import { logger } from "../logger";

export interface PromptProfile {
  audience?: string;
  intent?: string;
  focusTopics: string[];
  formatHints?: string[];
  voiceStyle?: string;
  excludeTopics?: string[];
}

/**
 * Build a prompt profile from user input
 * Uses deterministic extraction to properly break down domain terms
 * (LLM extraction was producing full phrases as single tokens, breaking re-ranking)
 */
export async function buildPromptProfile(prompt: string): Promise<PromptProfile | null> {
  if (!prompt || prompt.trim().length === 0) {
    return null;
  }

  logger.info(`Building prompt profile from: "${prompt.substring(0, 100)}..."`);

  // Use deterministic extraction - it properly breaks domain terms into individual keywords
  // LLM was producing full phrases like "code search innovation" as single tokens
  // which broke re-ranking because items rarely have those exact phrases in tags
  const profile = extractProfileDeterministic(prompt);
  logger.info(`Extracted prompt profile: ${JSON.stringify(profile)}`);
  return profile;
}

/**
 * Deterministic keyword extraction
 */
function extractProfileDeterministic(prompt: string): PromptProfile {
  const lower = prompt.toLowerCase();
  const profile: PromptProfile = { focusTopics: [] };

  // Detect audience
  if (lower.includes("senior") || lower.includes("lead") || lower.includes("engineer")) {
    profile.audience = "senior engineers";
  } else if (lower.includes("everyone") || lower.includes("team")) {
    profile.audience = "everyone";
  }

  // Detect intent
  if (lower.includes("focus") || lower.includes("emphasize")) {
    profile.intent = "focus";
  } else if (lower.includes("deep") || lower.includes("detailed")) {
    profile.intent = "deep-dive";
  } else if (lower.includes("summary") || lower.includes("overview")) {
    profile.intent = "summary";
  }

  // Extract focus topics from known domain terms
  // NOTE: Order matters - check longer phrases first to avoid partial matches
  const domainTerms = [
    "agentic workflows",
    "information retrieval",
    "developer productivity",
    "vector database",
    "context management",
    "context window",
    "code search",
    "semantic search",
    "ai tools",
    "ai coding",
    "code review",
    "devtools",
    "embeddings",
    "refactoring",
    "monorepo",
    "enterprise",
    "infrastructure",
    "testing",
    "vector database",
    "productivity",
    "research",
    "agents",
    "agentic",
    "vector",
    "rag",
    "RAG",
    "llm",
  ];

  for (const term of domainTerms) {
    if (lower.includes(term)) {
      profile.focusTopics.push(term);
    }
  }

  // Detect format hints
  const hints: string[] = [];
  if (lower.includes("actionable")) hints.push("actionable");
  if (lower.includes("strategic")) hints.push("strategic");
  if (lower.includes("practical")) hints.push("practical");
  if (lower.includes("detailed")) hints.push("detailed");
  if (lower.includes("summary")) hints.push("summary");
  if (hints.length > 0) {
    profile.formatHints = hints;
  }

  // Detect voice style
  if (lower.includes("conversational") || lower.includes("casual")) {
    profile.voiceStyle = "conversational";
  } else if (lower.includes("technical") || lower.includes("deep")) {
    profile.voiceStyle = "technical";
  } else if (lower.includes("executive") || lower.includes("brief")) {
    profile.voiceStyle = "executive";
  }

  // Detect excluded topics
  const excluded: string[] = [];
  if (lower.includes("avoid theory")) excluded.push("theory");
  if (lower.includes("avoid research")) excluded.push("research");
  if (lower.includes("no research")) excluded.push("research");
  if (excluded.length > 0) {
    profile.excludeTopics = excluded;
  }

  // Deduplicate topics
  profile.focusTopics = [...new Set(profile.focusTopics)];

  logger.debug(`Extracted deterministic prompt profile: ${JSON.stringify(profile)}`);
  return profile;
}
