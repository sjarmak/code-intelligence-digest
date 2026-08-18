# Code Intelligence Digest

Fetches items from Inoreader (plus NASA ADS for research papers) → normalizes → categorizes into 9 categories → scores with a hybrid LLM + BM25 + recency + engagement pipeline → ranks → serves via a JSON API and a Next.js/shadcn UI. GTM agents retrieve, rank, and write structured reports (competitive intel, market briefs, content ideas) over the same corpus plus live web search. A read-only MCP server exposes the corpus to coding agents. Deployed on Render.

See `architecture/exports/orient.md` for a mechanically-derived, subsystem-by-subsystem map of the codebase (containers, components, delivery state, source paths).

## Features

- **Inoreader + NASA ADS ingestion**: rolling-window sync with continuation tokens, a daily API-budget guard, and a 429 circuit breaker
- **9 digest categories**: Newsletters, Podcasts, Tech Articles, AI News, AI Dev, Product News, Community, Research, Marketing
- **Hybrid scoring pipeline**: LLM relevance/usefulness + BM25 domain-term matching + recency decay + (community) engagement / (research) citation signals, combined into one `finalScore` per item
- **GTM agent layer**: goal-aware retrieval + ranking + report writers (competitor intel, market brief, content ideas) over corpus + live web search, with a versioned trace for `/reports/[id]`
- **MCP copilot server**: read-only `search_items` / `get_item` / `semantic_search_items` / `aggregate_items` tools over a local production mirror, for querying the digest corpus from a coding agent
- **User library**: saved items, a personal digest library, and saved podcast audio, per authenticated user
- **Research papers surface**: ar5iv/arXiv HTML parsing, section extraction + embeddings, and paper Q&A
- **Media rendering**: Markdown/HTML newsletters, podcast scripts + rundowns, PDF export, and TTS audio (OpenAI primary, ElevenLabs/NeMo alternates), including a durable Temporal-based render path for long-running audio jobs
- **Semantic search**: pgvector embeddings alongside full-text (tsvector) search

## Tech Stack

- **Framework**: Next.js (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS + shadcn-style components
- **Database**: PostgreSQL + pgvector (local via Docker Compose, production via Render)
- **LLM**: Anthropic (Claude, default) or OpenAI, routed by model id
- **Durable execution**: Temporal (audio render workflows)
- **Hosting**: Render (web service, managed Postgres, cron jobs)

## Project Structure

```
app/
  api/
    items/, digest/, search/, ask/     — read surface: rank + serve items on demand
    agents/, reports/                  — GTM agent report CRUD + generation
    saved-items/, digest-items/, libraries/  — per-user library
    papers/                            — research paper list/content/Q&A
    podcast/, newsletter/, audio-digest/     — media generation + audio-renders
    admin/                             — sync triggers, tuning, debug (~25 routes)
  page.tsx, reports/, synthesis/       — reader UI, reports viewer, synthesis builder
src/
  config/
    feeds.ts            — Inoreader stream → category mapping
    categories.ts        — CATEGORY_CONFIG: scoring weights, half-lives, BM25 queries
    agent-jobs.ts         — AGENT_JOBS: scope, schedule, buildPrompt per GTM job
    domain-terms.ts       — BM25 domain-term weighting
  lib/
    inoreader/            — OAuth2 client, rate-limit handling, backoff
    sync/                 — daily sync orchestrator, sync state, budget guard
    ads/                  — NASA ADS client for research papers
    pipeline/              — normalize, categorize, fulltext, bm25, llmScore, compute-scores, rank, select
    agents/                — run-job entrypoint, report writers
    retrieval/             — agentRetrieval (corpus + web), curator-trace
    llm/                   — completion router, quality-model resolver, usage accounting
    db/                    — Postgres repos: items, scores, embeddings, agent-runs, user library, papers
    audio/                 — TTS provider adapters, sanitize/render; durable/ for the Temporal workflow path
    pdf/, ar5iv/, integrations/  — PDF export, arXiv HTML parsing, Slack delivery
    auth/                  — next-auth session guards + admin bearer token
  mcp/server.ts            — MCP copilot server (search_items, get_item, semantic_search_items, aggregate_items)
  components/              — React UI
scripts/
  run-sync.sh, cron-daily-sync.ts   — daily sync entrypoints
  cron-agent-jobs.ts                 — scheduled GTM agent runs
architecture/exports/orient.md       — LikeC4-derived architecture map
docs/conventions/, docs/ops/         — playbooks (build/test, beads workflow, scoring, deploy, GTM agents, LLM config)
docs/research/                       — source catalogs and research write-ups
```

## Setup & Installation

### Prerequisites

- Node.js 18+ and npm
- Docker (for local Postgres)
- Inoreader account with API access
- An Anthropic or OpenAI API key (for LLM scoring and report writing)

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Local PostgreSQL

```bash
npm run db:start                       # Docker Compose, port 5433
npx tsx scripts/init-local-postgres.ts # initialize schema
```

### 3. Configure Environment

Create `.env.local`:

```bash
# Inoreader API credentials
INOREADER_CLIENT_ID=your_client_id
INOREADER_CLIENT_SECRET=your_client_secret
INOREADER_REFRESH_TOKEN=your_refresh_token

# Local PostgreSQL (required for local dev)
LOCAL_DATABASE_URL=postgresql://code_intel_user:local_dev_password@localhost:5433/code_intel

# LLM providers (at least one; Anthropic is the default quality model)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...          # also used for embeddings + TTS

# Optional: web search for GTM agents (Parallel or Tavily), NASA ADS token for research sync,
# Slack webhook for report delivery, Resend key for email delivery
```

See `docs/ops/inoreader-reauth.md` if a sync run reports `invalid_grant`.

### 4. Configure Feeds

Edit `src/config/feeds.ts` with your Inoreader stream IDs (`feed/https://...` for RSS, `user/[id]/label/[name]` for folders). Find stream IDs via the Inoreader API (`GET /reader/api/0/subscription/list`) or `scripts/add-resource-feeds.ts`. See `docs/research/inoreader_content_sources_2026_04.md` for the current source catalog and rationale.

### 5. Run Development Server

Do not run `npm run dev` from an agent session — it opens a port and leaves a daemon. Run it yourself:

```bash
npm run dev
```

Visit http://localhost:3000.

## Build & Deployment

```bash
npm run typecheck
npm run lint
npm test -- --run                # never without --run — Vitest watch mode hangs
unset NODE_ENV && npm run build  # never with NODE_ENV=development set — SSR build failure
```

### Deploy to Render

`render.yaml` defines the web service + managed Postgres + cron jobs.

1. Push to GitHub, connect the repo in Render as a Blueprint
2. Render auto-detects `render.yaml` and provisions the web service and database
3. Set env vars in Render: `INOREADER_CLIENT_ID`, `INOREADER_CLIENT_SECRET`, `INOREADER_REFRESH_TOKEN`, `ADMIN_API_TOKEN` (required in production), `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`

The Render container is tuned for 512MB (heap 460MB, 8 full-text items/run, 1 concurrent fetch, 100 embeddings/run). Raising cron batch sizes without raising `NODE_OPTIONS=--max-old-space-size` and the limits in `scripts/cron-daily-sync.ts` will OOM the container.

See `render.yaml` for the full service/cron definition.

## Daily Sync

```bash
bash scripts/run-sync.sh
# or
curl -X POST http://localhost:3002/api/admin/sync-daily
```

Render's cron uses `npm run cron:daily`. Sync is resumable via a continuation token in `sync_state` and backs off behind a circuit breaker on 429s.

## API Surface (selected)

- `GET /api/items?category=&period=` — ranked items for a category (`week`/`month`)
- `GET /api/digest`, `GET /api/search`, `POST /api/ask` — digest view, full-text search, Q&A
- `GET/POST/DELETE /api/saved-items`, `/api/digest-items`, `/api/libraries` — per-user library
- `GET /api/papers`, `/api/papers/[bibcode]/content`, `POST /api/papers/ask` — research papers
- `GET /api/reports`, `/api/reports/[id]` — GTM agent reports; `?trace=1` for the ranking trace
- `POST /api/admin/run-agent-job` — manual GTM agent run (dev only, disabled in production; use the `/reports` page)
- `GET /api/health` — DB reachability check

`GET /api/items` response shape:

```json
{
  "items": [
    {
      "id": "item-id",
      "title": "Article Title",
      "url": "https://example.com/article",
      "sourceTitle": "Source Feed Name",
      "publishedAt": "2026-08-15T10:30:00Z",
      "summary": "...",
      "category": "newsletters",
      "bm25Score": 0.75,
      "llmScore": { "relevance": 8.5, "usefulness": 7.2, "tags": ["code-search", "agents"] },
      "recencyScore": 0.95,
      "finalScore": 0.82
    }
  ],
  "category": "newsletters",
  "period": "week",
  "count": 5
}
```

## Scoring System

`finalScore = w_llm * llm + w_bm25 * bm25` (plus recency and, per category, engagement/citation terms — weights vary by category in `src/config/categories.ts`), then multiplied by product/watchlist/competitor boosts. Recency uses exponential decay (`2^(-ageDays / halfLifeDays)`, clamped to [0.2, 1.0]) with category-specific half-lives. Items below `minRelevance` are filtered, results are diversity-capped per source, then truncated to `maxItems`.

Domain-term weighting lives in `src/config/domain-terms.ts` (code search, information retrieval, context management, agentic workflows, enterprise codebases, developer tools, LLM architecture, SDLC processes). See `docs/conventions/scoring.md` for the full formula and tuning guide.

## GTM Agents

Scheduled agents retrieve from the corpus + live web search, rank for a specific goal (competitor match, ICP fit, recency, format), and write a structured report. Add a new agent/job by extending `AGENT_JOBS` in `src/config/agent-jobs.ts` (scope, optional `webSearchQueries`, `buildPrompt`) and, if new, `AGENTS` in `src/config/agents.ts`. Every run persists a versioned `ContentIdeasPipelineTrace` / `AgentRankingTrace` (bump `CURATOR_TRACE_SCHEMA_VERSION` in `src/lib/retrieval/curator-trace.ts` on any shape change — it's read by `/reports/[id]` and `?trace=1`). See `docs/conventions/gtm-agents.md`.

## MCP Copilot Server

`src/mcp/server.ts` exposes the digest corpus (full-text + pgvector semantic search, single-item fetch, aggregation, mirror freshness) as read-only MCP tools over a local production mirror, so a coding agent can query the corpus directly. Register it as an MCP server pointed at `npx tsx src/mcp/server.ts`.

## Extending the System

**Add a feed**: find the stream ID, append to `src/config/feeds.ts`.

**Tune scoring for a category**: edit `src/config/categories.ts` (`query`, `weights`, `halfLifeDays`, `maxItems`, `minRelevance`), or use the source/item relevance endpoints:

```bash
curl -X POST http://localhost:3002/api/admin/sync-starred -H "Authorization: Bearer $ADMIN_API_TOKEN"
curl http://localhost:3002/api/admin/source-relevance
curl -X POST http://localhost:3002/api/admin/source-relevance \
  -H "Content-Type: application/json" -d '{"streamId":"feed/https://...","relevance":2}'
```

**Add a GTM agent or job**: see GTM Agents above.

**Change the quality model**: set `DIGEST_QUALITY_MODEL` (defaults to `claude-sonnet-4-6` if `ANTHROPIC_API_KEY` is set, else `gpt-4o-mini`). See `docs/conventions/llm-config.md`.

## Troubleshooting

- **No items returned**: check `.env.local` credentials, confirm feeds in `src/config/feeds.ts`, check server logs (`DEBUG=1 npm run dev`); if sync fails with `invalid_grant`, follow `docs/ops/inoreader-reauth.md`
- **Type errors**: `npm run typecheck`
- **Vitest hangs**: you ran `npm test` without `--run`
- **Build fails with a `/_global-error` SSR error**: `NODE_ENV=development` is set in your shell — `unset NODE_ENV` before building

## Logging

```typescript
import { logger } from "@/lib/logger";
logger.info("Pipeline started", { category: "newsletters" });
logger.error("Failed to fetch", error);
```

`DEBUG=1 npm run dev` for verbose output. Never surface raw stack traces to user-facing API responses — use `logger.error/.warn/.info`.

## Further Reading

- `architecture/exports/orient.md` — architecture map (every container/component, purpose, delivery state, source path)
- `docs/conventions/scoring.md` — hybrid scoring formula and domain terms
- `docs/conventions/gtm-agents.md` — scheduled agent jobs, trace schema
- `docs/conventions/session-close.md` — session close ritual
- `docs/ops/inoreader-reauth.md` — recovering from Inoreader `invalid_grant`
- `docs/research/inoreader_content_sources_2026_04.md` — current + candidate Inoreader sources with rationale
- `history/docs/` — legacy detailed guides (architecture walkthrough, hybrid scoring system, implementation guide)

## License

MIT

## References

- [Inoreader API Documentation](https://www.inoreader.com/reader/api/)
- [NASA ADS API](https://ui.adsabs.harvard.edu/help/api/)
- [Okapi BM25](https://en.wikipedia.org/wiki/Okapi_BM25)
- [Next.js Documentation](https://nextjs.org/docs)
