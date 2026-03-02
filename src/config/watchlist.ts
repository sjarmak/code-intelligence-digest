/**
 * Keyword watchlist for boosting high-signal content in scoring.
 *
 * Terms are organized by theme and weight tier. During scoring, items matching
 * multiple watchlist terms get a multiplicative boost to their final score.
 *
 * This replaces the hardcoded `coreTerms` array in compute-scores.ts with a
 * configurable, testable module.
 *
 * Weight tiers:
 *  - 2.0x: Directly about our core domain (code understanding, code search, coding agents)
 *  - 1.6x: Strong signal for adjacent high-value themes (AI + codebase workflows)
 *  - 1.3x: Moderate signal for broader relevant themes (complexity, knowledge, debugging)
 */

export interface WatchlistTerm {
  term: string;
  weight: number;
  theme: WatchlistTheme;
}

export type WatchlistTheme =
  | "code_understanding"
  | "code_search_nav"
  | "ai_coding_workflow"
  | "context_and_retrieval"
  | "developer_productivity"
  | "codebase_complexity"
  | "knowledge_transfer"
  | "control_plane";

export interface WatchlistThemeConfig {
  id: WatchlistTheme;
  description: string;
}

export const WATCHLIST_THEMES: readonly WatchlistThemeConfig[] = [
  { id: "code_understanding", description: "Understanding, comprehending, and reasoning about codebases" },
  { id: "code_search_nav", description: "Code search, navigation, and intelligence tooling" },
  { id: "ai_coding_workflow", description: "AI-assisted coding workflows, bottlenecks, and developer experience" },
  { id: "context_and_retrieval", description: "Context management, retrieval, and prompt construction for code" },
  { id: "developer_productivity", description: "Developer productivity measurement, tooling, and workflows" },
  { id: "codebase_complexity", description: "Codebase complexity, technical debt, and maintainability" },
  { id: "knowledge_transfer", description: "Knowledge transfer, onboarding, and institutional knowledge in code" },
  { id: "control_plane", description: "Control plane within software development: code review, vulnerability tracing, batch changes, monitoring" },
] as const;

export const WATCHLIST_TERMS: readonly WatchlistTerm[] = [
  // ── Code Understanding (2.0x) ──
  // Items about understanding, comprehending, navigating, or visualizing codebases
  { term: "code understanding", weight: 2.0, theme: "code_understanding" },
  { term: "codebase understanding", weight: 2.0, theme: "code_understanding" },
  { term: "code comprehension", weight: 2.0, theme: "code_understanding" },
  { term: "understanding codebases", weight: 2.0, theme: "code_understanding" },
  { term: "understanding code", weight: 2.0, theme: "code_understanding" },
  { term: "codebase visualization", weight: 2.0, theme: "code_understanding" },
  { term: "code visualization", weight: 2.0, theme: "code_understanding" },
  { term: "execution flow", weight: 2.0, theme: "code_understanding" },
  { term: "data flow", weight: 1.6, theme: "code_understanding" },
  { term: "call graph", weight: 2.0, theme: "code_understanding" },
  { term: "dependency graph", weight: 1.6, theme: "code_understanding" },
  { term: "mental model", weight: 1.6, theme: "code_understanding" },
  { term: "system understanding", weight: 2.0, theme: "code_understanding" },
  { term: "code readability", weight: 1.3, theme: "code_understanding" },

  // ── Code Search & Navigation (2.0x) ──
  { term: "code search", weight: 2.0, theme: "code_search_nav" },
  { term: "code intelligence", weight: 2.0, theme: "code_search_nav" },
  { term: "code navigation", weight: 2.0, theme: "code_search_nav" },
  { term: "codebase search", weight: 2.0, theme: "code_search_nav" },
  { term: "sourcegraph", weight: 2.0, theme: "code_search_nav" },
  { term: "deep search", weight: 2.0, theme: "code_search_nav" },
  { term: "semantic code search", weight: 2.0, theme: "code_search_nav" },

  // ── AI Coding Workflow (1.6x) ──
  // How AI changes the way developers work with code — bottlenecks, reviews, generated code
  { term: "coding agent", weight: 2.0, theme: "ai_coding_workflow" },
  { term: "ai coding", weight: 1.6, theme: "ai_coding_workflow" },
  { term: "ai-generated code", weight: 1.6, theme: "ai_coding_workflow" },
  { term: "ai-written code", weight: 1.6, theme: "ai_coding_workflow" },
  { term: "ai writes code", weight: 1.6, theme: "ai_coding_workflow" },
  { term: "ai writes most of the code", weight: 2.0, theme: "ai_coding_workflow" },
  { term: "vibe coding", weight: 1.6, theme: "ai_coding_workflow" },
  { term: "ai pair programming", weight: 1.6, theme: "ai_coding_workflow" },
  { term: "developer bottleneck", weight: 1.6, theme: "ai_coding_workflow" },
  { term: "code review bottleneck", weight: 1.6, theme: "ai_coding_workflow" },
  { term: "reconstructing context", weight: 2.0, theme: "ai_coding_workflow" },
  { term: "rebuilding context", weight: 2.0, theme: "ai_coding_workflow" },
  { term: "prompt engineering for code", weight: 1.3, theme: "ai_coding_workflow" },
  { term: "ai slop", weight: 1.6, theme: "ai_coding_workflow" },
  { term: "code quality ai", weight: 1.6, theme: "ai_coding_workflow" },

  // ── Context & Retrieval (1.6x) ──
  { term: "context management", weight: 2.0, theme: "context_and_retrieval" },
  { term: "context window", weight: 1.6, theme: "context_and_retrieval" },
  { term: "codebase context", weight: 2.0, theme: "context_and_retrieval" },
  { term: "code context", weight: 1.6, theme: "context_and_retrieval" },
  { term: "information retrieval", weight: 1.6, theme: "context_and_retrieval" },
  { term: "retrieval augmented", weight: 1.6, theme: "context_and_retrieval" },
  { term: "repository context", weight: 1.6, theme: "context_and_retrieval" },
  { term: "multi-repo", weight: 1.6, theme: "context_and_retrieval" },

  // ── Developer Productivity (1.3x) ──
  { term: "developer productivity", weight: 1.6, theme: "developer_productivity" },
  { term: "developer experience", weight: 1.3, theme: "developer_productivity" },
  { term: "developer workflow", weight: 1.3, theme: "developer_productivity" },
  { term: "developer tools", weight: 1.3, theme: "developer_productivity" },
  { term: "dev productivity", weight: 1.3, theme: "developer_productivity" },
  { term: "ai tooling", weight: 1.3, theme: "developer_productivity" },
  { term: "engineering velocity", weight: 1.6, theme: "developer_productivity" },
  { term: "engineering effectiveness", weight: 1.6, theme: "developer_productivity" },
  { term: "software engineering", weight: 1.3, theme: "developer_productivity" },

  // ── Codebase Complexity (1.3x) ──
  { term: "technical debt", weight: 1.3, theme: "codebase_complexity" },
  { term: "code complexity", weight: 1.3, theme: "codebase_complexity" },
  { term: "software complexity", weight: 1.3, theme: "codebase_complexity" },
  { term: "large codebase", weight: 1.6, theme: "codebase_complexity" },
  { term: "legacy code", weight: 1.3, theme: "codebase_complexity" },
  { term: "monorepo", weight: 1.3, theme: "codebase_complexity" },
  { term: "refactoring at scale", weight: 1.6, theme: "codebase_complexity" },
  { term: "code migration", weight: 1.3, theme: "codebase_complexity" },

  // ── Knowledge Transfer (1.3x) ──
  { term: "onboarding", weight: 1.3, theme: "knowledge_transfer" },
  { term: "ramp-up time", weight: 1.6, theme: "knowledge_transfer" },
  { term: "knowledge transfer", weight: 1.3, theme: "knowledge_transfer" },
  { term: "institutional knowledge", weight: 1.6, theme: "knowledge_transfer" },
  { term: "code familiarity", weight: 1.6, theme: "knowledge_transfer" },
  { term: "tribal knowledge", weight: 1.6, theme: "knowledge_transfer" },
  { term: "code documentation", weight: 1.3, theme: "knowledge_transfer" },

  // ── Control Plane (1.3x) ──
  { term: "vulnerability tracing", weight: 1.6, theme: "control_plane" },
  { term: "vulnerability remediation", weight: 1.6, theme: "control_plane" },
  { term: "batch changes", weight: 1.3, theme: "control_plane" },
  { term: "monitoring", weight: 1.3, theme: "control_plane" },
  { term: "observability", weight: 1.3, theme: "control_plane" },
  { term: "code review", weight: 1.3, theme: "control_plane" },
] as const;

/**
 * Match watchlist terms against content text.
 * Returns matched terms with their weights, sorted by weight descending.
 */
export function matchWatchlistTerms(content: string): WatchlistTerm[] {
  const lower = content.toLowerCase();
  const matched: WatchlistTerm[] = [];
  const seenTerms = new Set<string>();

  for (const entry of WATCHLIST_TERMS) {
    if (seenTerms.has(entry.term)) continue;
    if (lower.includes(entry.term.toLowerCase())) {
      matched.push(entry);
      seenTerms.add(entry.term);
    }
  }

  return matched.sort((a, b) => b.weight - a.weight);
}

/**
 * Compute a boost multiplier from watchlist matches.
 *
 * Rules:
 *  - "sourcegraph" mention → 5.0x (highest priority, unchanged from before)
 *  - 3+ matched terms across 2+ themes → use the top 3 term weights averaged, capped at 4.0x
 *  - 2 matched terms across 2+ themes → average of top 2 weights, capped at 3.0x
 *  - 2 matched terms same theme → average of top 2 weights × 0.9 (slight penalty for narrow match)
 *  - 1 matched term → that term's weight × 0.8, minimum 1.2x
 *  - 0 matched terms → 1.0x (no boost)
 */
export function computeWatchlistBoost(content: string): {
  multiplier: number;
  matchedTerms: string[];
  themes: WatchlistTheme[];
} {
  const matches = matchWatchlistTerms(content);

  if (matches.length === 0) {
    return { multiplier: 1.0, matchedTerms: [], themes: [] };
  }

  const matchedTerms = matches.map((m) => m.term);
  const themes = [...new Set(matches.map((m) => m.theme))];

  // Sourcegraph gets top priority
  if (matchedTerms.includes("sourcegraph")) {
    return { multiplier: 5.0, matchedTerms, themes };
  }

  const uniqueThemeCount = themes.length;

  let multiplier: number;

  if (matches.length >= 3 && uniqueThemeCount >= 2) {
    const topWeights = matches.slice(0, 3).map((m) => m.weight);
    const avg = topWeights.reduce((a, b) => a + b, 0) / topWeights.length;
    multiplier = Math.min(avg * 1.5, 4.0);
  } else if (matches.length >= 2 && uniqueThemeCount >= 2) {
    const topWeights = matches.slice(0, 2).map((m) => m.weight);
    const avg = topWeights.reduce((a, b) => a + b, 0) / topWeights.length;
    multiplier = Math.min(avg * 1.3, 3.0);
  } else if (matches.length >= 2) {
    const topWeights = matches.slice(0, 2).map((m) => m.weight);
    const avg = topWeights.reduce((a, b) => a + b, 0) / topWeights.length;
    multiplier = Math.min(avg * 0.9 * 1.3, 2.5);
  } else {
    multiplier = Math.max(matches[0].weight * 0.8, 1.2);
  }

  return { multiplier, matchedTerms, themes };
}
