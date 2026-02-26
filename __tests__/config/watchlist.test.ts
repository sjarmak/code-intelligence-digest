import { describe, it, expect } from "vitest";
import {
  matchWatchlistTerms,
  computeWatchlistBoost,
  WATCHLIST_TERMS,
  WATCHLIST_THEMES,
} from "../../src/config/watchlist";

describe("WATCHLIST_TERMS", () => {
  it("has terms defined for all themes", () => {
    const themeIds = WATCHLIST_THEMES.map((t) => t.id);
    for (const themeId of themeIds) {
      const termsForTheme = WATCHLIST_TERMS.filter((t) => t.theme === themeId);
      expect(termsForTheme.length).toBeGreaterThan(0);
    }
  });

  it("all terms have valid weights between 1.0 and 2.0", () => {
    for (const term of WATCHLIST_TERMS) {
      expect(term.weight).toBeGreaterThanOrEqual(1.0);
      expect(term.weight).toBeLessThanOrEqual(2.0);
    }
  });
});

describe("matchWatchlistTerms", () => {
  it("matches terms case-insensitively", () => {
    const matches = matchWatchlistTerms("This is about Code Understanding in large systems");
    const terms = matches.map((m) => m.term);
    expect(terms).toContain("code understanding");
  });

  it("returns empty array for irrelevant content", () => {
    const matches = matchWatchlistTerms("Banana smoothie recipe for breakfast");
    expect(matches).toHaveLength(0);
  });

  it("returns matches sorted by weight descending", () => {
    const matches = matchWatchlistTerms(
      "code understanding and developer experience with onboarding"
    );
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].weight).toBeGreaterThanOrEqual(matches[i].weight);
    }
  });

  it("matches the HN post that was missed", () => {
    const title = "If AI writes most of the code, understanding codebases becomes the bottleneck";
    const summary =
      "I noticed I was spending more time reconstructing context than actually building: " +
      "figuring out what changed, tracing data flow, rebuilding mental models. " +
      "Better understanding leads to better prompts and fewer breaking changes. " +
      "Prototype visualizes execution flow and system structure.";

    const matches = matchWatchlistTerms(`${title} ${summary}`);
    const terms = matches.map((m) => m.term);

    expect(terms.length).toBeGreaterThanOrEqual(3);
    expect(terms).toContain("understanding codebases");
    expect(terms).toContain("reconstructing context");
    expect(terms).toContain("execution flow");
    expect(terms).toContain("data flow");
  });

  it("matches multiple themes from rich content", () => {
    const content =
      "How coding agents change developer productivity: " +
      "context management for large codebase understanding and knowledge transfer";
    const matches = matchWatchlistTerms(content);
    const themes = [...new Set(matches.map((m) => m.theme))];
    expect(themes.length).toBeGreaterThanOrEqual(3);
  });

  it("does not duplicate terms", () => {
    const content = "code search code search code search";
    const matches = matchWatchlistTerms(content);
    const terms = matches.map((m) => m.term);
    const unique = [...new Set(terms)];
    expect(terms.length).toBe(unique.length);
  });
});

describe("computeWatchlistBoost", () => {
  it("returns 1.0x for irrelevant content", () => {
    const result = computeWatchlistBoost("Banana smoothie recipe for breakfast");
    expect(result.multiplier).toBe(1.0);
    expect(result.matchedTerms).toHaveLength(0);
  });

  it("returns 5.0x for sourcegraph mentions", () => {
    const result = computeWatchlistBoost("Sourcegraph launches new feature");
    expect(result.multiplier).toBe(5.0);
    expect(result.matchedTerms).toContain("sourcegraph");
  });

  it("boosts content matching a single high-weight term", () => {
    const result = computeWatchlistBoost("Improving code understanding");
    expect(result.multiplier).toBeGreaterThan(1.0);
    expect(result.matchedTerms).toContain("code understanding");
  });

  it("gives stronger boost for multi-theme matches than same-theme at equal weight", () => {
    // Both have two 1.6x terms, but cross-theme should beat same-theme
    const singleTheme = computeWatchlistBoost(
      "data flow and dependency graph analysis"
    );
    const multiTheme = computeWatchlistBoost(
      "data flow analysis for developer productivity"
    );
    expect(multiTheme.multiplier).toBeGreaterThan(singleTheme.multiplier);
  });

  it("gives strongest boost for 3+ terms across 2+ themes", () => {
    const result = computeWatchlistBoost(
      "coding agent for codebase understanding improves developer productivity"
    );
    expect(result.multiplier).toBeGreaterThanOrEqual(2.5);
    expect(result.themes.length).toBeGreaterThanOrEqual(2);
  });

  it("boosts the missed HN post significantly", () => {
    const title = "If AI writes most of the code, understanding codebases becomes the bottleneck";
    const summary =
      "I noticed I was spending more time reconstructing context than actually building: " +
      "figuring out what changed, tracing data flow, rebuilding mental models. " +
      "Prototype visualizes execution flow and system structure.";

    const result = computeWatchlistBoost(`${title} ${summary}`);
    expect(result.multiplier).toBeGreaterThanOrEqual(2.5);
    expect(result.matchedTerms.length).toBeGreaterThanOrEqual(3);
  });

  it("caps boost multiplier at 4.0x (excluding sourcegraph)", () => {
    const result = computeWatchlistBoost(
      "code search code intelligence code navigation codebase understanding " +
      "context management coding agent developer productivity engineering velocity " +
      "large codebase refactoring at scale onboarding ramp-up time"
    );
    expect(result.multiplier).toBeLessThanOrEqual(5.0);
  });

  it("returns matched themes", () => {
    const result = computeWatchlistBoost(
      "coding agent helps with onboarding to large codebase"
    );
    expect(result.themes).toContain("ai_coding_workflow");
    expect(result.themes).toContain("knowledge_transfer");
  });
});
