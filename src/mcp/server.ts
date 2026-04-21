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

import { createMirrorCopilotDbContext } from '../lib/copilot';
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

const db = createMirrorCopilotDbContext();

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

// ---- mirror_status ------------------------------------------------------

server.registerTool(
  'mirror_status',
  {
    description:
      'Report freshness of the local mirror. ALWAYS call this before generating ' +
      'answers that claim to cover "today" or "this week" — warn the user if ' +
      'staleMinutes is unexpectedly large (> 90 usually means the hourly sync ' +
      'failed).',
    inputSchema: {},
  },
  async () => {
    const status = await db.getMirrorStatus();
    const lines = [
      `lastSyncedAt: ${status.lastSyncedAt ?? 'never'}`,
      `staleMinutes: ${status.staleMinutes ?? 'n/a'}`,
      `tablesTracked: ${status.tablesTracked}`,
      `totalRowsSynced: ${status.totalRowsSynced}`,
    ];
    if (status.staleMinutes != null && status.staleMinutes > 90) {
      lines.push('', 'WARNING: mirror is unusually stale — hourly sync may have failed.');
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
