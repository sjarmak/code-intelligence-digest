import { describe, it, expect } from "vitest";
import {
  buildCompetitorQueries,
  classifyOverlapWithSourcegraph,
  classifySourceTypeByDomain,
  detectCompetitorSignals,
  getCompetitorIntelEntries,
} from "../../src/config/competitor-intel";

describe("competitor-intel config", () => {
  it("loads competitors from yaml", () => {
    const entries = getCompetitorIntelEntries();
    expect(entries.length).toBeGreaterThan(8);
    expect(entries.some((e) => e.id === "augment")).toBe(true);
    expect(entries.some((e) => e.id === "github")).toBe(true);
  });

  it("builds 20-30 style query families with cap", () => {
    const augment = getCompetitorIntelEntries().find((e) => e.id === "augment");
    expect(augment).toBeDefined();
    const queries = buildCompetitorQueries(augment!, 24);
    expect(queries.length).toBeGreaterThanOrEqual(20);
    expect(queries.length).toBeLessThanOrEqual(24);
    const topQueries = queries.slice(0, 8).join(" ").toLowerCase();
    expect(topQueries).toContain("benchmark");
  });

  it("classifies source domains", () => {
    expect(classifySourceTypeByDomain("docs.github.com")).toBe("primary");
    expect(classifySourceTypeByDomain("news.ycombinator.com")).toBe("community");
    expect(classifySourceTypeByDomain("example.com")).toBe("secondary");
  });

  it("detects overlap surfaces and competitor signals", () => {
    const text = "New MCP context engine for large codebase semantic code search and enterprise RBAC";
    const overlap = classifyOverlapWithSourcegraph(text);
    expect(overlap).toContain("mcp");
    expect(overlap).toContain("agent_context");
    expect(overlap).toContain("code_search");
    expect(overlap).toContain("enterprise_control");

    const signal = detectCompetitorSignals("Augment Code launched context engine MCP docs");
    expect(signal.competitorIds).toContain("augment");
    expect(signal.surfaces).toContain("mcp");
  });
});
