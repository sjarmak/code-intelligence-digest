#!/usr/bin/env tsx
/**
 * MCP server exposing read-only tools over the local production mirror.
 *
 * Transport: stdio. Spawned by Claude Code via `claude mcp add`.
 * Backing store: the hourly-refreshed mirror at LOCAL_DATABASE_URL
 * (see scripts/mirror-from-production.ts).
 *
 * Tools in Phase A:
 *   - search_items       free-text search with category/date filters
 *   - get_item           full details by id (incl. full_text if cached)
 *   - mirror_status      freshness + sync stats (warn users when stale)
 *
 * Phase B will add semantic_search_items + aggregate_items.
 *
 * Run standalone (for debugging):
 *   npx tsx src/mcp/server.ts < /dev/null
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Claude Code spawns the server as a subprocess with its own cwd; we can't
// assume .env.local is discoverable from cwd. Resolve relative to THIS file.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({
  path: path.resolve(__dirname, '../../.env.local'),
  quiet: true,
});

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { resolveCopilotDbContext } from '../lib/copilot';
import { NomicEncoder } from '../lib/embeddings/nomic-encoder';
import { QUERY_PREFIX } from '../lib/embeddings/encoder';
import type { Category } from '../lib/model';

const VALID_CATEGORIES = [
  'newsletters',
  'podcasts',
  'tech_articles',
  'ai_news',
  'ai_dev',
  'product_news',
  'community',
  'research',
  'marketing',
] as const satisfies readonly Category[];

const { db, mode: dbMode } = resolveCopilotDbContext();

// Local nomic encoder for semantic queries (dv0.5 curation path). Lazy-loads the
// ONNX model once on first semantic_search_items call; shared for the process.
const queryEncoder = new NomicEncoder();

const server = new McpServer(
  { name: 'code-intel-copilot', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// ---- search_items -------------------------------------------------------

server.registerTool(
  'search_items',
  {
    description:
      'Search the code-intel-digest items table by free-text query. ' +
      'Uses Postgres full-text search (title/summary/snippet/full_text). ' +
      'Returns up to `limit` matching items, ranked by relevance then recency. ' +
      'Use this for keyword queries like "anthropic funding" or "rust async". ' +
      'For conceptual queries like "how are people thinking about X", prefer ' +
      'semantic_search_items (Phase B).',
    inputSchema: {
      query: z
        .string()
        .optional()
        .describe('Free-text search query. Omit to get most recent items.'),
      category: z
        .enum(VALID_CATEGORIES)
        .optional()
        .describe('Restrict to one category.'),
      since: z
        .string()
        .optional()
        .describe('ISO date (YYYY-MM-DD) — only items created on/after this date.'),
      until: z
        .string()
        .optional()
        .describe('ISO date (YYYY-MM-DD) — only items created strictly before this date.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(20)
        .describe('Max items to return. Default 20, max 200.'),
    },
  },
  async ({ query, category, since, until, limit }) => {
    const items = await db.searchItems({
      query,
      category,
      since: since ? Math.floor(new Date(since).getTime() / 1000) : undefined,
      until: until ? Math.floor(new Date(until).getTime() / 1000) : undefined,
      limit,
    });

    const summary = items.map((it) => ({
      id: it.id,
      title: it.title,
      url: it.url,
      source: it.sourceTitle,
      author: it.author,
      category: it.category,
      published_at: it.publishedAt.toISOString(),
      summary: it.summary?.slice(0, 400),
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { count: summary.length, items: summary },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---- get_item -----------------------------------------------------------

server.registerTool(
  'get_item',
  {
    description:
      'Fetch full details of a single item by id, including cached full_text ' +
      'if available. Use after search_items when you need to quote or deeply ' +
      'analyse a specific item.',
    inputSchema: {
      id: z.string().describe('The item id (primary key) from search_items.'),
    },
  },
  async ({ id }) => {
    const item = await db.getItemById(id);
    if (!item) {
      return {
        content: [{ type: 'text', text: `No item found with id=${id}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              id: item.id,
              title: item.title,
              url: item.url,
              source: item.sourceTitle,
              author: item.author,
              category: item.category,
              published_at: item.publishedAt.toISOString(),
              created_at: item.createdAt?.toISOString(),
              summary: item.summary,
              content_snippet: item.contentSnippet,
              full_text: item.fullText,
              categories: item.categories,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---- semantic_search_items ---------------------------------------------

server.registerTool(
  'semantic_search_items',
  {
    description:
      'Semantic search for items using vector similarity (pgvector). ' +
      'The query string is embedded locally with the open-weight ' +
      'nomic-embed-text-v1.5 model (768d); results are items whose embedding is ' +
      'closest by cosine distance. Use this for conceptual queries where keyword ' +
      'matching underperforms — e.g. "how are people thinking about codebase ' +
      'understanding and agent context". Only items that have been embedded with ' +
      'nomic are returned (item_model_embeddings; ads_papers/paper_sections are ' +
      'NOT currently embedded).',
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe('Natural-language query. Works best with full sentences or topic descriptions.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe('Max items to return. Default 10, max 50.'),
    },
  },
  async ({ query, limit }) => {
    let vec: number[];
    try {
      // Embed the query locally with nomic + the 'search_query:' task prefix
      // (must match the 'search_document:' prefix used when documents were
      // embedded). The encoder asserts unit-norm/768d at the source.
      const [queryVec] = await queryEncoder.embedDocuments([QUERY_PREFIX + query]);
      if (!queryVec) {
        throw new Error("encoder returned no vector for the query");
      }
      vec = queryVec;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              'Semantic search unavailable: could not generate a query embedding ' +
              `(${message}). Use keyword search (search_items) instead.`,
          },
        ],
      };
    }
    const items = await db.semanticSearchByVector(vec, limit);

    const summary = items.map((it) => ({
      id: it.id,
      title: it.title,
      url: it.url,
      source: it.sourceTitle,
      author: it.author,
      category: it.category,
      published_at: it.publishedAt.toISOString(),
      summary: it.summary?.slice(0, 400),
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { count: summary.length, items: summary },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---- aggregate_items ---------------------------------------------------

server.registerTool(
  'aggregate_items',
  {
    description:
      'Group items by source, author, or category, with counts and average ' +
      'LLM relevance score per group. Useful for "who is publishing most on X" ' +
      'or "top sources in ai_dev this month". Results sorted by count desc.',
    inputSchema: {
      group_by: z
        .enum(['source', 'author', 'category'])
        .describe('Dimension to group by.'),
      category: z
        .enum(VALID_CATEGORIES)
        .optional()
        .describe('Restrict to one category. Ignored if group_by === "category".'),
      since: z
        .string()
        .optional()
        .describe('ISO date (YYYY-MM-DD) — only items created on/after this date.'),
      until: z
        .string()
        .optional()
        .describe('ISO date (YYYY-MM-DD) — only items created strictly before this date.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(20)
        .describe('Max groups to return. Default 20, max 200.'),
    },
  },
  async ({ group_by, category, since, until, limit }) => {
    const buckets = await db.aggregateItems({
      groupBy: group_by,
      category,
      since: since ? Math.floor(new Date(since).getTime() / 1000) : undefined,
      until: until ? Math.floor(new Date(until).getTime() / 1000) : undefined,
      limit,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { count: buckets.length, groupBy: group_by, buckets },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---- mirror_status ------------------------------------------------------

server.registerTool(
  'mirror_status',
  {
    description:
      'Report which backing store the copilot is using and, in mirror mode, its ' +
      'freshness. ALWAYS call this before generating answers that claim to cover ' +
      '"today" or "this week". In mirror mode, warn the user if staleMinutes is ' +
      'unexpectedly large (> 90 usually means the hourly sync failed). In direct ' +
      'mode the data is live production, so freshness fields are not applicable.',
    inputSchema: {},
  },
  async () => {
    const status = await db.getMirrorStatus();
    const lines = [`dbMode: ${dbMode}`];
    if (dbMode === 'direct') {
      lines.push(
        'source: live production database (direct, read-only) — data is real-time; mirror freshness fields are N/A.'
      );
    } else {
      lines.push(
        `lastSyncedAt: ${status.lastSyncedAt ?? 'never'}`,
        `staleMinutes: ${status.staleMinutes ?? 'n/a'}`,
        `tablesTracked: ${status.tablesTracked}`,
        `totalRowsSynced: ${status.totalRowsSynced}`
      );
      if (status.staleMinutes != null && status.staleMinutes > 90) {
        lines.push('', 'WARNING: mirror is unusually stale — hourly sync may have failed.');
      }
    }
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  }
);

// ---- lifecycle ----------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  process.stderr.write(`[mcp] shutting down on ${signal}\n`);
  try {
    await db.close();
  } catch {
    // Pool may already be closed; ignore.
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  process.stderr.write('[mcp] code-intel-copilot server ready on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[mcp] fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
