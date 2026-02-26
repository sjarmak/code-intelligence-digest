/**
 * Competitor and whole-product ecosystem configuration.
 * Used by the competitor intel agent and for goal-aware retrieval/ranking.
 */

export type CompetitorType = "direct" | "augmenting";

export interface CompetitorEntry {
  name: string;
  type: CompetitorType;
  /** Primary domains for web search filtering */
  domains: string[];
  /** Keywords for matching in content (names, product names, etc.) */
  keywords: string[];
  /** Short capability description */
  capabilities: string;
  productCategory: string;
}

/**
 * Direct competitors: code search / code intelligence / codebase tooling
 * that compete with Sourcegraph-style code intelligence and MCP.
 */
const DIRECT_COMPETITORS: CompetitorEntry[] = [
  {
    name: "Augment Code",
    type: "direct",
    domains: ["augmentcode.com", "augment.dev"],
    keywords: ["Augment Code", "Augment"],
    capabilities: "AI-powered code search and codebase understanding",
    productCategory: "code search / AI code assistant",
  },
  {
    name: "Moderne",
    type: "direct",
    domains: ["moderne.io", "moderne.com"],
    keywords: ["Moderne", "Moderne.io"],
    capabilities: "Large-scale code transformation and codebase analysis",
    productCategory: "codebase analysis / refactoring",
  },
  {
    name: "OpenGrok",
    type: "direct",
    domains: ["opengrok.github.io", "oracle.com/groff"],
    keywords: ["OpenGrok", "opengrok"],
    capabilities: "Source code search and cross-reference engine",
    productCategory: "code search",
  },
  {
    name: "GitHub MCP",
    type: "direct",
    domains: ["github.com"],
    keywords: ["GitHub MCP", "GitHub Model Context Protocol", "MCP GitHub"],
    capabilities: "Model Context Protocol integration for GitHub repositories",
    productCategory: "context retrieval / MCP",
  },
];

/**
 * Augmenting products: part of the "whole product" around code intelligence—
 * coding agents and context retrieval tools that complement or sit alongside
 * Sourcegraph MCP (e.g., Claude Code, Cursor, Copilot use our context; ripgrep
 * is a baseline retrieval option).
 */
const AUGMENTING_COMPETITORS: CompetitorEntry[] = [
  {
    name: "Claude Code",
    type: "augmenting",
    domains: ["anthropic.com", "claude.ai"],
    keywords: ["Claude Code", "Claude", "Anthropic"],
    capabilities: "AI coding assistant and agent",
    productCategory: "coding agent",
  },
  {
    name: "Cursor",
    type: "augmenting",
    domains: ["cursor.com", "cursor.sh"],
    keywords: ["Cursor", "Cursor IDE", "Cursor AI"],
    capabilities: "AI-first IDE and coding agent",
    productCategory: "coding agent / IDE",
  },
  {
    name: "GitHub Copilot",
    type: "augmenting",
    domains: ["github.com", "copilot.github.com"],
    keywords: ["GitHub Copilot", "Copilot", "Copilot Chat"],
    capabilities: "AI pair programmer and code completion",
    productCategory: "coding agent",
  },
  {
    name: "Codex CLI",
    type: "augmenting",
    domains: ["openai.com", "codex.com"],
    keywords: ["Codex", "Codex CLI", "OpenAI Codex"],
    capabilities: "CLI-based coding agent",
    productCategory: "coding agent",
  },
  {
    name: "Gemini",
    type: "augmenting",
    domains: ["google.com", "deepmind.google", "gemini.google"],
    keywords: ["Gemini", "Gemini CLI", "Google Gemini", "Antigravity"],
    capabilities: "Google AI coding and general assistant",
    productCategory: "coding agent",
  },
  {
    name: "Windsurf",
    type: "augmenting",
    domains: ["codeium.com", "windsurf.com"],
    keywords: ["Windsurf", "Codeium Windsurf"],
    capabilities: "AI coding assistant",
    productCategory: "coding agent",
  },
  {
    name: "Sourcegraph MCP / Open harnesses",
    type: "augmenting",
    domains: ["sourcegraph.com", "github.com/sourcegraph"],
    keywords: ["Sourcegraph MCP", "Sourcegraph", "MCP", "open harness"],
    capabilities: "Code context retrieval for MCP; code search and embeddings",
    productCategory: "context retrieval / MCP",
  },
  {
    name: "ripgrep / grep-based retrieval",
    type: "augmenting",
    domains: [],
    keywords: ["ripgrep", "rg ", "grep", "code search grep", "text search codebase"],
    capabilities: "Text search in codebase as baseline context retrieval",
    productCategory: "context retrieval",
  },
];

export const COMPETITORS: CompetitorEntry[] = [
  ...DIRECT_COMPETITORS,
  ...AUGMENTING_COMPETITORS,
];

export const COMPETITORS_BY_TYPE: Record<CompetitorType, CompetitorEntry[]> = {
  direct: DIRECT_COMPETITORS,
  augmenting: AUGMENTING_COMPETITORS,
};

/** All keywords for BM25/term matching (deduplicated) */
export function getCompetitorKeywords(): string[] {
  const set = new Set<string>();
  for (const c of COMPETITORS) {
    for (const k of c.keywords) set.add(k);
  }
  return Array.from(set);
}

/** Keywords for direct competitors only (Augment, Moderne, OpenGrok, GitHub MCP). Used to weight competitor_intel ranking. */
export function getDirectCompetitorKeywords(): string[] {
  const set = new Set<string>();
  for (const c of DIRECT_COMPETITORS) {
    for (const k of c.keywords) set.add(k);
  }
  return Array.from(set);
}

/** All domains for web search site restriction */
export function getCompetitorDomains(): string[] {
  const set = new Set<string>();
  for (const c of COMPETITORS) {
    for (const d of c.domains) if (d) set.add(d);
  }
  return Array.from(set);
}

export function getCompetitorByName(name: string): CompetitorEntry | undefined {
  return COMPETITORS.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
}
