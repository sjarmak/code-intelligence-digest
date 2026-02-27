/**
 * Competitor and ecosystem configuration derived from competitor-intel YAML.
 * Used by ranking/retrieval and product-news relevance enrichment.
 */

import {
  getCompetitorIntelEntries,
  type CompetitorIntelEntry,
} from "./competitor-intel";

export type CompetitorType = "direct" | "augmenting";

export interface CompetitorEntry {
  name: string;
  type: CompetitorType;
  domains: string[];
  keywords: string[];
  capabilities: string;
  productCategory: string;
}

function fromIntel(entry: CompetitorIntelEntry): CompetitorEntry {
  return {
    name: entry.display_name,
    // Tier-1 are treated as direct competitors for ranking emphasis.
    type: entry.tier <= 1 ? "direct" : "augmenting",
    domains: entry.domains,
    keywords: Array.from(
      new Set([
        entry.display_name,
        entry.company,
        ...entry.aliases,
        ...entry.products,
        ...entry.overlap_terms,
      ]),
    ),
    capabilities: entry.overlap_terms.slice(0, 4).join(", "),
    productCategory: entry.categories.join(" / "),
  };
}

const ALL_FROM_CONFIG = getCompetitorIntelEntries().map(fromIntel);

const DIRECT_COMPETITORS = ALL_FROM_CONFIG.filter((c) => c.type === "direct");
const AUGMENTING_COMPETITORS = ALL_FROM_CONFIG.filter((c) => c.type === "augmenting");

export const COMPETITORS: CompetitorEntry[] = [...DIRECT_COMPETITORS, ...AUGMENTING_COMPETITORS];

export const COMPETITORS_BY_TYPE: Record<CompetitorType, CompetitorEntry[]> = {
  direct: DIRECT_COMPETITORS,
  augmenting: AUGMENTING_COMPETITORS,
};

export function getCompetitorKeywords(): string[] {
  const set = new Set<string>();
  for (const c of COMPETITORS) {
    for (const k of c.keywords) set.add(k);
  }
  return Array.from(set);
}

export function getDirectCompetitorKeywords(): string[] {
  const set = new Set<string>();
  for (const c of DIRECT_COMPETITORS) {
    for (const k of c.keywords) set.add(k);
  }
  return Array.from(set);
}

export function getCompetitorDomains(): string[] {
  const set = new Set<string>();
  for (const c of COMPETITORS) {
    for (const d of c.domains) if (d) set.add(d);
  }
  return Array.from(set);
}

export function getCompetitorByName(name: string): CompetitorEntry | undefined {
  const lower = name.toLowerCase();
  return COMPETITORS.find(
    (c) => c.name.toLowerCase() === lower || c.keywords.some((k) => k.toLowerCase() === lower),
  );
}
