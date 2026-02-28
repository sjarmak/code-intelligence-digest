import fs from "fs";
import path from "path";
import { parse } from "yaml";

export type IntelSourceType = "primary" | "secondary" | "community" | "internal_curated";

export interface SourcegraphContextConfig {
  tracked_surfaces: string[];
  problem_language: string[];
}

export interface CompetitorIntelEntry {
  id: string;
  company: string;
  display_name: string;
  tier: number;
  categories: string[];
  domains: string[];
  aliases: string[];
  products: string[];
  overlap_terms: string[];
  watch_terms: string[];
}

export interface CompetitorIntelConfig {
  sourcegraph_context: SourcegraphContextConfig;
  competitors: CompetitorIntelEntry[];
  query_families: Record<string, string[]>;
  problem_language_queries: string[];
}

let cachedConfig: CompetitorIntelConfig | null = null;

const COMMUNITY_DOMAINS = new Set([
  "reddit.com",
  "news.ycombinator.com",
  "dev.to",
  "medium.com",
  "linkedin.com",
]);

const OVERLAP_SURFACE_MAP: Record<string, string[]> = {
  deep_search: ["deep search", "natural language code search"],
  code_search: ["code search", "semantic search", "exact code search", "type-aware code search"],
  code_navigation: ["code navigation", "cross-reference", "symbol navigation", "jump to definition"],
  mcp: ["mcp", "model context protocol"],
  agent_context: ["context engine", "repo-aware", "full codebase context", "entire codebase", "tool calling"],
  batch_changes: ["codemod", "migration", "refactor", "bulk change", "modernization", "remediation"],
  insights: ["insights", "analytics", "reporting"],
  monitoring: ["monitoring", "observability"],
  governance: ["governance", "policy", "guardrails", "audit"],
  enterprise_control: ["enterprise", "sso", "rbac", "self-hosted", "on-prem", "permissions", "compliance"],
  large_codebase_understanding: ["large codebase", "complex codebase", "legacy modernization"],
  monorepo_multi_repo: ["monorepo", "multi-repo", "multi repo"],
};

function resolveConfigPath(): string {
  return path.resolve(process.cwd(), "src", "config", "competitor-intel.yaml");
}

export function getCompetitorIntelConfig(): CompetitorIntelConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const file = fs.readFileSync(resolveConfigPath(), "utf-8");
  const parsed = parse(file) as CompetitorIntelConfig;

  if (!parsed?.competitors?.length) {
    throw new Error("Invalid competitor-intel config: missing competitors");
  }

  cachedConfig = parsed;
  return parsed;
}

export function getCompetitorIntelEntries(): CompetitorIntelEntry[] {
  return getCompetitorIntelConfig().competitors;
}

export function classifySourceTypeByDomain(domain: string | null | undefined): IntelSourceType {
  const d = (domain ?? "").toLowerCase();
  if (!d) return "secondary";

  const cfg = getCompetitorIntelConfig();
  const primary = new Set<string>(cfg.competitors.flatMap((c) => c.domains.map((x) => x.toLowerCase())));

  if (primary.has(d)) return "primary";
  if (Array.from(primary).some((p) => d.endsWith(`.${p}`))) return "primary";
  if (COMMUNITY_DOMAINS.has(d) || Array.from(COMMUNITY_DOMAINS).some((p) => d.endsWith(`.${p}`))) {
    return "community";
  }
  return "secondary";
}

export function getDomainFromUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function buildCompetitorQueries(
  competitor: CompetitorIntelEntry,
  maxQueries = 24,
): string[] {
  const cfg = getCompetitorIntelConfig();
  const names = Array.from(
    new Set([competitor.display_name, competitor.company, ...competitor.aliases, ...competitor.products]),
  );

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (query: string): void => {
    const q = query.trim();
    if (!q || seen.has(q)) return;
    seen.add(q);
    out.push(q);
  };

  // Priority-first queries to avoid truncating high-signal terms (benchmark, pricing, GA, etc.).
  for (const term of competitor.watch_terms) {
    add(`${competitor.display_name} ${term}`);
    add(`${competitor.company} ${term}`);
  }
  for (const term of competitor.overlap_terms) {
    add(`${competitor.display_name} ${term}`);
  }
  for (const product of competitor.products) {
    add(`${product} release notes`);
    add(`${product} docs`);
    add(`${product} benchmark`);
  }
  for (const q of cfg.problem_language_queries) {
    add(q);
  }

  // Then fill with broad family coverage.
  for (const name of names) {
    for (const templates of Object.values(cfg.query_families)) {
      for (const template of templates) {
        add(template.replace("{name}", name));
      }
    }
  }

  return out.slice(0, maxQueries);
}

export function classifyOverlapWithSourcegraph(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const [surface, terms] of Object.entries(OVERLAP_SURFACE_MAP)) {
    if (terms.some((term) => lower.includes(term))) {
      matched.push(surface);
    }
  }

  return matched;
}

export interface CompetitorSignalMatch {
  competitorIds: string[];
  surfaces: string[];
  matchedTerms: string[];
}

export function detectCompetitorSignals(text: string): CompetitorSignalMatch {
  const lower = text.toLowerCase();
  const cfg = getCompetitorIntelConfig();

  const competitorIds: string[] = [];
  const matchedTerms = new Set<string>();

  for (const competitor of cfg.competitors) {
    const terms = [
      competitor.display_name,
      competitor.company,
      ...competitor.aliases,
      ...competitor.products,
      ...competitor.overlap_terms,
      ...competitor.watch_terms,
    ];
    const hasMatch = terms.some((t) => {
      const normalized = t.toLowerCase();
      const found = lower.includes(normalized);
      if (found) matchedTerms.add(normalized);
      return found;
    });
    if (hasMatch) competitorIds.push(competitor.id);
  }

  return {
    competitorIds,
    surfaces: classifyOverlapWithSourcegraph(text),
    matchedTerms: Array.from(matchedTerms),
  };
}
