import type { Category } from "../lib/model";

/**
 * Product and competitor configuration
 *
 * This module provides a comprehensive taxonomy of coding agent products,
 * code search tools, and developer productivity tools for tracking and filtering.
 *
 * Categories:
 * - ide_extension: IDE-integrated coding assistants (Cursor, Windsurf, etc.)
 * - cli_agent: Command-line coding agents (Claude Code, Aider, etc.)
 * - autonomous_agent: Fully autonomous coding agents (Devin, etc.)
 * - code_completion: Code completion/autocomplete tools (Copilot, Tabnine, etc.)
 * - code_search: Code search and navigation tools (Sourcegraph, Greptile, etc.)
 * - code_review: Automated code review tools (CodeRabbit, etc.)
 * - agent_framework: Agent orchestration frameworks (LangGraph, etc.)
 */

/**
 * Product category for filtering and grouping
 */
export type ProductCategory =
  | "ide_extension"
  | "cli_agent"
  | "autonomous_agent"
  | "code_completion"
  | "code_search"
  | "code_review"
  | "agent_framework";

/**
 * Product definition with aliases for matching
 */
export interface Product {
  /** Unique identifier (lowercase, hyphenated) */
  id: string;
  /** Display name */
  name: string;
  /** Alternative names/spellings for matching (all lowercase) */
  aliases: string[];
  /** Product category */
  category: ProductCategory;
  /** Is this our own product (Sourcegraph/Cody)? */
  isOwnProduct: boolean;
  /** Is this a direct competitor? */
  isCompetitor: boolean;
  /** Company/vendor name */
  vendor?: string;
}

/**
 * Category metadata
 */
export interface ProductCategoryConfig {
  id: ProductCategory;
  name: string;
  description: string;
}

/**
 * Product category configurations
 */
export const PRODUCT_CATEGORIES: readonly ProductCategoryConfig[] = [
  {
    id: "ide_extension",
    name: "IDE Extensions",
    description:
      "IDE-integrated coding assistants with full editor integration",
  },
  {
    id: "cli_agent",
    name: "CLI Agents",
    description: "Command-line coding agents for terminal workflows",
  },
  {
    id: "autonomous_agent",
    name: "Autonomous Agents",
    description: "Fully autonomous coding agents that work independently",
  },
  {
    id: "code_completion",
    name: "Code Completion",
    description: "Code completion and autocomplete tools",
  },
  {
    id: "code_search",
    name: "Code Search",
    description: "Code search, navigation, and intelligence tools",
  },
  {
    id: "code_review",
    name: "Code Review",
    description: "Automated code review and analysis tools",
  },
  {
    id: "agent_framework",
    name: "Agent Frameworks",
    description: "Frameworks for building and orchestrating AI agents",
  },
] as const;

/**
 * Comprehensive product list
 *
 * Products are ordered by category, then by relevance/market presence.
 * Aliases should be lowercase and include common variations.
 */
export const PRODUCTS: readonly Product[] = [
  // ============================================
  // OWN PRODUCTS (Sourcegraph)
  // ============================================
  {
    id: "sourcegraph",
    name: "Sourcegraph",
    // Removed "src" - too many false positives (src= in HTML, src/ paths)
    aliases: ["sourcegraph", "sourcegraph search", "sourcegraph code search"],
    category: "code_search",
    isOwnProduct: true,
    isCompetitor: false,
    vendor: "Sourcegraph",
  },
  {
    id: "cody",
    name: "Cody",
    aliases: ["cody", "sourcegraph cody", "cody ai"],
    category: "ide_extension",
    isOwnProduct: true,
    isCompetitor: false,
    vendor: "Sourcegraph",
  },

  {
    id: "sourcebot",
    name: "Sourcebot",
    // Treat Sourcebot as our own coding agent product
    aliases: ["sourcebot", "sourcebot ai", "sourcebot agent"],
    category: "cli_agent",
    isOwnProduct: true,
    isCompetitor: false,
    vendor: "Sourcegraph",
  },

  {
    id: "sourcebot",
    name: "Sourcebot",
    // Treat Sourcebot as our own coding agent product
    aliases: ["sourcebot", "sourcebot ai", "sourcebot agent"],
    category: "cli_agent",
    isOwnProduct: true,
    isCompetitor: false,
    vendor: "Sourcegraph",
  },

  // ============================================
  // IDE EXTENSIONS (Competitors)
  // ============================================
  {
    id: "cursor",
    name: "Cursor",
    // Removed "cursor" alone - too common a word (mouse cursor, database cursor)
    aliases: [
      "cursor ai",
      "cursor editor",
      "cursor ide",
      "cursor tab",
      "anysphere cursor",
      "anysphere",
    ],
    category: "ide_extension",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Anysphere",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    aliases: ["windsurf", "windsurf ai", "windsurf editor", "codeium windsurf"],
    category: "ide_extension",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Codeium",
  },
  {
    id: "continue",
    name: "Continue",
    // Removed "continue" alone - too common a word, many false positives
    aliases: [
      "continue.dev",
      "continue ai",
      "continue extension",
      "continue ide",
    ],
    category: "ide_extension",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Continue",
  },
  {
    id: "void",
    name: "Void",
    // Removed "void" alone - too common in programming (void type, void functions)
    aliases: ["void editor", "voideditor", "void ide"],
    category: "ide_extension",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Void",
  },
  {
    id: "pearai",
    name: "PearAI",
    // Removed "pear" alone - common word
    aliases: ["pearai", "pear ai", "pear editor", "pear ide"],
    category: "ide_extension",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "PearAI",
  },
  {
    id: "jetbrains-ai",
    name: "JetBrains AI Assistant",
    aliases: ["jetbrains ai", "jetbrains ai assistant", "intellij ai", "junie"],
    category: "ide_extension",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "JetBrains",
  },
  {
    id: "zed-ai",
    name: "Zed AI",
    aliases: ["zed ai", "zed assistant"],
    category: "ide_extension",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Zed Industries",
  },

  // ============================================
  // CLI AGENTS (Competitors)
  // ============================================
  {
    id: "claude-code",
    name: "Claude Code",
    aliases: ["claude code", "claude-code", "anthropic claude code"],
    category: "cli_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Anthropic",
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    // Removed "codex" alone - used in other contexts (codex alimentarius, historical codex)
    aliases: ["codex cli", "openai codex", "codex agent"],
    category: "cli_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "OpenAI",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    aliases: ["gemini cli", "gemini code", "google gemini cli", "antigravity"],
    category: "cli_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Google",
  },
  {
    id: "aider",
    name: "Aider",
    aliases: ["aider", "aider ai", "aider chat"],
    category: "cli_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Aider",
  },
  {
    id: "mentat",
    name: "Mentat",
    // Removed "mentat" alone - appears inside words like "implementation", "documentation"
    aliases: ["mentat ai", "mentat coding", "mentat agent", "abanteai mentat"],
    category: "cli_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "AbanteAI",
  },
  {
    id: "goose",
    name: "Goose",
    // Removed "goose" alone - could match in other contexts
    aliases: ["goose ai", "block goose", "goose agent", "goose cli"],
    category: "cli_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Block",
  },
  {
    id: "amp",
    name: "Amp",
    // Removed "amp" alone - matches &amp; HTML entities
    // Using longer aliases to avoid false positives
    aliases: ["amp code", "ampcode", "amp agent", "amp cli"],
    category: "cli_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Amp",
  },

  // ============================================
  // AUTONOMOUS AGENTS (Competitors)
  // ============================================
  {
    id: "devin",
    name: "Devin",
    // Removed "devin" alone - common first name
    aliases: ["devin ai", "cognition devin", "cognition labs"],
    category: "autonomous_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Cognition",
  },
  {
    id: "augment-code",
    name: "Augment Code",
    // Removed "augment" alone - too common an English word ("to augment their capabilities")
    aliases: ["augment code", "augmentcode", "augment ai", "augment coding"],
    category: "autonomous_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Augment",
  },
  {
    id: "openhands",
    name: "OpenHands",
    aliases: ["openhands", "open hands", "all-hands-ai"],
    category: "autonomous_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "All Hands AI",
  },
  {
    id: "swe-agent",
    name: "SWE-agent",
    aliases: ["swe-agent", "swe agent", "sweagent"],
    category: "autonomous_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Princeton NLP",
  },
  {
    id: "swe-bench-pro",
    name: "SWE-bench Pro",
    aliases: ["swe-bench pro", "swe-bench", "swebench", "SWE bench pro"],
    category: "autonomous_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Scale AI",
  },
  {
    id: "factory",
    name: "Factory",
    // Removed "factory" alone - too common (factory pattern, factory method)
    aliases: ["factory ai", "factory.ai", "factory agent"],
    category: "autonomous_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Factory",
  },
  {
    id: "poolside",
    name: "Poolside",
    // Removed "poolside" alone - could match casual usage
    aliases: ["poolside ai", "poolside coding"],
    category: "autonomous_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Poolside",
  },

  // ============================================
  // CODE COMPLETION (Competitors)
  // ============================================
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    aliases: [
      "github copilot",
      "copilot",
      "gh copilot",
      "copilot chat",
      "copilot workspace",
    ],
    category: "code_completion",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "GitHub/Microsoft",
  },
  {
    id: "tabnine",
    name: "Tabnine",
    aliases: ["tabnine", "tab nine", "tabnine ai"],
    category: "code_completion",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Tabnine",
  },
  {
    id: "amazon-q",
    name: "Amazon Q Developer",
    aliases: [
      "amazon q",
      "amazon q developer",
      "aws q",
      "codewhisperer",
      "amazon codewhisperer",
    ],
    category: "code_completion",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Amazon",
  },
  {
    id: "supermaven",
    name: "Supermaven",
    aliases: ["supermaven", "super maven"],
    category: "code_completion",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Supermaven",
  },
  {
    id: "codeium",
    name: "Codeium",
    aliases: ["codeium", "codeium ai"],
    category: "code_completion",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Codeium",
  },
  {
    id: "replit-agent",
    name: "Replit Agent",
    aliases: ["replit agent", "replit ai", "ghostwriter", "replit ghostwriter"],
    category: "code_completion",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Replit",
  },

  // ============================================
  // CODE SEARCH (Competitors)
  // ============================================
  {
    id: "greptile",
    name: "Greptile",
    aliases: ["greptile", "greptile ai"],
    category: "code_search",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Greptile",
  },
  {
    id: "bloop",
    name: "Bloop",
    aliases: ["bloop", "bloop ai"],
    category: "code_search",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Bloop",
  },
  {
    id: "kilo",
    name: "Kilo",
    // Removed "kilo" alone - common prefix (kilobyte, kilometer, etc.)
    aliases: ["kilo code", "kilo ai", "kilo search"],
    category: "code_search",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Kilo",
  },
  {
    id: "moderne",
    name: "Moderne",
    aliases: [
      "moderne",
      "moderne ai",
      "moderne platform",
      "openrewrite",
      "open rewrite",
    ],
    category: "code_search",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Moderne",
  },

  // ============================================
  // CODE REVIEW (Competitors)
  // ============================================
  {
    id: "coderabbit",
    name: "CodeRabbit",
    aliases: ["coderabbit", "code rabbit"],
    category: "code_review",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "CodeRabbit",
  },
  {
    id: "codium-pr-agent",
    name: "PR-Agent",
    aliases: ["pr-agent", "pr agent", "codiumai", "codium ai", "qodo"],
    category: "code_review",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Qodo (formerly CodiumAI)",
  },
  {
    id: "graphite",
    name: "Graphite",
    // Removed "graphite" alone - also a mineral/material
    aliases: [
      "graphite.dev",
      "graphite dev",
      "graphite stacking",
      "graphite pr",
    ],
    category: "code_review",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Graphite",
  },
  {
    id: "swimm",
    name: "Swimm",
    aliases: ["swimm", "swimm ai"],
    category: "code_review",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Swimm",
  },
  {
    id: "semgrep",
    name: "Semgrep",
    aliases: ["semgrep", "semgrep ai"],
    category: "code_review",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Semgrep",
  },

  // ============================================
  // AGENT FRAMEWORKS
  // ============================================
  {
    id: "langgraph",
    name: "LangGraph",
    aliases: ["langgraph", "lang graph", "langchain langgraph"],
    category: "agent_framework",
    isOwnProduct: false,
    isCompetitor: false,
    vendor: "LangChain",
  },
  {
    id: "autogen",
    name: "AutoGen",
    aliases: ["autogen", "auto gen", "microsoft autogen"],
    category: "agent_framework",
    isOwnProduct: false,
    isCompetitor: false,
    vendor: "Microsoft",
  },
  {
    id: "crewai",
    name: "CrewAI",
    aliases: ["crewai", "crew ai"],
    category: "agent_framework",
    isOwnProduct: false,
    isCompetitor: false,
    vendor: "CrewAI",
  },
] as const;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Build a map of alias -> product for efficient lookup
 * Keys are lowercase for case-insensitive matching
 */
export function buildProductAliasMap(): Map<string, Product> {
  const map = new Map<string, Product>();
  for (const product of PRODUCTS) {
    for (const alias of product.aliases) {
      map.set(alias.toLowerCase(), product);
    }
  }
  return map;
}

// Pre-built alias map for performance
const PRODUCT_ALIAS_MAP = buildProductAliasMap();

/**
 * Find all products mentioned in text
 * Returns array of product IDs found
 */
export function findProductMentions(text: string): string[] {
  const lowerText = text.toLowerCase();
  const found = new Set<string>();

  for (const product of PRODUCTS) {
    for (const alias of product.aliases) {
      // Always use word boundary matching to avoid false positives
      // e.g. "augment" should not match "to augment their moderation"
      // and "cursor" should not match "database cursor" or "cursor position"
      const regex = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
      if (regex.test(lowerText)) {
        found.add(product.id);
        break;
      }
    }
  }

  return Array.from(found);
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Get product by ID
 */
export function getProductById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

/**
 * Get all products by category
 */
export function getProductsByCategory(
  category: ProductCategory,
): readonly Product[] {
  return PRODUCTS.filter((p) => p.category === category);
}

/**
 * Get all competitor products
 */
export function getCompetitorProducts(): readonly Product[] {
  return PRODUCTS.filter((p) => p.isCompetitor);
}

/**
 * Get own products (Sourcegraph/Cody)
 */
export function getOwnProducts(): readonly Product[] {
  return PRODUCTS.filter((p) => p.isOwnProduct);
}

/**
 * Get all product names for display
 */
export function getAllProductNames(): string[] {
  return PRODUCTS.map((p) => p.name);
}

/**
 * Get all product IDs
 */
export function getAllProductIds(): string[] {
  return PRODUCTS.map((p) => p.id);
}

/**
 * Check if text mentions any competitor products
 */
export function mentionsCompetitor(text: string): boolean {
  const mentions = findProductMentions(text);
  return mentions.some((id) => {
    const product = getProductById(id);
    return product?.isCompetitor === true;
  });
}

/**
 * Check if text mentions own products
 */
export function mentionsOwnProduct(text: string): boolean {
  const mentions = findProductMentions(text);
  return mentions.some((id) => {
    const product = getProductById(id);
    return product?.isOwnProduct === true;
  });
}

/**
 * Get categories for product IDs
 */
export function getProductCategories(productIds: string[]): ProductCategory[] {
  const categories = new Set<ProductCategory>();
  for (const id of productIds) {
    const product = getProductById(id);
    if (product) {
      categories.add(product.category);
    }
  }
  return Array.from(categories);
}

// ============================================
// PRODUCT PRIORITIES & BOOSTING HELPERS
// ============================================

export type ProductPriority = "tier1" | "tier2" | "other";

/**
 * Priority tiers for products when boosting product_news ranking.
 *
 * - tier1: Major competitors / own products we care most about
 * - tier2: Relevant but secondary products
 * - other: Everything else
 */
const PRODUCT_PRIORITY: Record<string, ProductPriority> = {
  // Major competitors / own products in coding workflows & context management
  cursor: "tier1",
  "augment-code": "tier1",
  moderne: "tier1",
  sourcebot: "tier1",
  "claude-code": "tier1",
  "gemini-cli": "tier1",
  cody: "tier1",

  // Other notable agents/tools (can be expanded over time)
  aider: "tier2",
  "github-copilot": "tier2",
  "amazon-q": "tier2",
};

export function getProductPriority(id: string): ProductPriority {
  return PRODUCT_PRIORITY[id] ?? "other";
}

// Tools that provide deep code/context capabilities
const TOOL_PRODUCTS = new Set<string>([
  "cursor",
  "sourcebot",
  "augment-code",
  "moderne",
]);

// Agents/clients that use tools (CLI agents, assistants, etc.)
const AGENT_PRODUCTS = new Set<string>([
  "claude-code",
  "gemini-cli",
  "cody",
  "aider",
]);

// Context-management-related phrases for product updates
const CONTEXT_TERMS = [
  "context window",
  "context management",
  "context caching",
  "codebase context",
  "deep search",
  "code search",
  "repositories context",
  "multi-repo context",
];

export interface ProductBoostResult {
  multiplier: number;
  tags: string[];
}

/**
 * Compute product-specific boost for ranking/scoring, with special handling
 * for product_news category.
 *
 * Rules:
 * - Only applies to product_news
 * - Tier 1 products (Cursor, Sourcebot, Augment Code, Claude Code, Gemini CLI, Cody)
 *   get the strongest boost
 * - Additional boost when combined with context-management terms
 * - Additional boost when a tool product is combined with an agent product
 */
export function computeProductBoost(
  category: Category,
  content: string,
): ProductBoostResult {
  if (category !== "product_news") {
    return { multiplier: 1.0, tags: [] };
  }

  const lower = content.toLowerCase();
  const detectedProductIds = findProductMentions(lower);

  if (detectedProductIds.length === 0) {
    return { multiplier: 1.0, tags: [] };
  }

  let tier1Count = 0;
  let tier2Count = 0;
  let otherCount = 0;

  for (const id of detectedProductIds) {
    const priority = getProductPriority(id);
    if (priority === "tier1") tier1Count++;
    else if (priority === "tier2") tier2Count++;
    else otherCount++;
  }

  // Base product boost by tier composition
  let multiplier = 1.0;
  if (tier1Count > 0) {
    // Strongest boost for major products
    multiplier = tier1Count >= 2 ? 5.0 : 4.0;
  } else if (tier2Count > 0) {
    multiplier = tier2Count >= 2 ? 3.0 : 2.5;
  } else {
    // Long tail of other products still gets a modest boost
    multiplier = 2.0;
  }

  // Extra boost for context-management focused updates from tier1 products
  const hasContextTerm = CONTEXT_TERMS.some(term => lower.includes(term));
  if (hasContextTerm && tier1Count > 0) {
    multiplier *= 1.5;
  }

  // Workflow / integration stories: tool + agent together
  const hasTool = detectedProductIds.some(id => TOOL_PRODUCTS.has(id));
  const hasAgent = detectedProductIds.some(id => AGENT_PRODUCTS.has(id));
  if (hasTool && hasAgent) {
    multiplier *= 1.25;
  }

  return {
    multiplier,
    tags: detectedProductIds,
  };
}
