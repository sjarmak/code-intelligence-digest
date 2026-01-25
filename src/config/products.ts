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
    description: "IDE-integrated coding assistants with full editor integration",
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
    aliases: ["sourcegraph", "src", "sourcegraph search"],
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

  // ============================================
  // IDE EXTENSIONS (Competitors)
  // ============================================
  {
    id: "cursor",
    name: "Cursor",
    aliases: ["cursor", "cursor ai", "cursor editor", "cursor ide"],
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
    aliases: ["continue", "continue.dev", "continue ai"],
    category: "ide_extension",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Continue",
  },
  {
    id: "void",
    name: "Void",
    aliases: ["void", "void editor", "voideditor"],
    category: "ide_extension",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Void",
  },
  {
    id: "pearai",
    name: "PearAI",
    aliases: ["pearai", "pear ai", "pear"],
    category: "ide_extension",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "PearAI",
  },
  {
    id: "jetbrains-ai",
    name: "JetBrains AI Assistant",
    aliases: [
      "jetbrains ai",
      "jetbrains ai assistant",
      "intellij ai",
      "junie",
    ],
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
    aliases: ["codex cli", "codex", "openai codex", "codex agent"],
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
    aliases: ["mentat", "mentat ai"],
    category: "cli_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "AbanteAI",
  },
  {
    id: "goose",
    name: "Goose",
    aliases: ["goose", "goose ai", "block goose"],
    category: "cli_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Block",
  },
  {
    id: "amp",
    name: "Amp",
    aliases: ["amp", "amp code", "ampcode"],
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
    aliases: ["devin", "devin ai", "cognition devin", "cognition labs"],
    category: "autonomous_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Cognition",
  },
  {
    id: "augment-code",
    name: "Augment Code",
    aliases: ["augment code", "augment", "augmentcode", "augment ai"],
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
    id: "factory",
    name: "Factory",
    aliases: ["factory", "factory ai", "factory.ai"],
    category: "autonomous_agent",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Factory",
  },
  {
    id: "poolside",
    name: "Poolside",
    aliases: ["poolside", "poolside ai"],
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
    aliases: ["kilo", "kilo code"],
    category: "code_search",
    isOwnProduct: false,
    isCompetitor: true,
    vendor: "Kilo",
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
    aliases: ["graphite", "graphite.dev"],
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
      // Use word boundary matching for short aliases to avoid false positives
      if (alias.length < 5) {
        // For short aliases, require word boundaries
        const regex = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
        if (regex.test(lowerText)) {
          found.add(product.id);
          break;
        }
      } else {
        // For longer aliases, simple includes is fine
        if (lowerText.includes(alias)) {
          found.add(product.id);
          break;
        }
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
export function getProductsByCategory(category: ProductCategory): readonly Product[] {
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
