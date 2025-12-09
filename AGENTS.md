# Project Guidelines

## Project Mission

Build a “Code Intelligence Digest” service that:

- Pulls items from Inoreader (newsletters, blogs, product changelogs, podcasts, Reddit, arXiv, etc.).
- Normalizes them into a common item model.
- Categorizes items into a fixed set of digest sections.
- Scores and ranks them using a hybrid LLM + term/BM25 + recency + diversity system.
- Exposes a clean API for a shadcn-UI frontend that renders weekly/monthly digests.

Core focus topics:

- Code intelligence, code search, semantic search over codebases.
- AI coding agents and agentic workflows (code review, refactors, docs, tests).
- Context management (retrieval, windows, compression) for LLMs over code.
- Developer productivity and devtools across the SDLC.
- Managing large, complex, enterprise-scale codebases.

## Content Categories

All content must be normalized into one of these categories:

1. `newsletters`
2. `podcasts`
3. `tech_articles` (blogs, essays, thought leadership)
4. `ai_news` (models, infra, AI-wide updates relevant to devs)
5. `product_news` (changelogs, releases, feature announcements)
6. `community` (Reddit, forums, community posts)
7. `research` (arXiv, academic, empirical SE/IR/PL/ML papers)

Category is determined by a combination of:

- Inoreader stream ID / folder.
- Static `FeedConfig` mapping.
- Optional LLM classification for ambiguous feeds.

## Curation & Scoring System

### Overview

Every item in the system is scored to determine whether it appears in the digest and in what order.

Scoring pipeline:

1. Normalize raw Inoreader item → `FeedItem`.
2. Assign `category` based on `FeedConfig` and folders/tags.
3. Compute:
   - BM25 term relevance score (per-category query).
   - LLM relevance/usefulness score based on metadata.
   - Recency score based on publication time.
   - Optional engagement score (e.g., Reddit upvotes/comments) for `community`.
4. Combine scores into a single `finalScore`.
5. Apply thresholds and diversity constraints (per-source caps) to select top K per category.

### Hybrid Scoring (LLM + Terms/BM25 + Recency)

LLM and terms are peers, not a fallback. Both must be implemented.

- **LLM evaluation (primary)**:

  - Claude (or configured model) rates each item 0–10 for:
    - Relevance to: code tooling, agents, code search, IR, context, complex codebases.
    - Usefulness / depth for a senior dev / eng-lead audience.
  - Output JSON per item:
    ```json
    {
      "id": "item-id",
      "relevance": 0-10,
      "usefulness": 0-10,
      "tags": [
        "code-search" | "agent" | "devex" | "context" |
        "research" | "infra" | "org-process" | "off-topic" | ...
      ]
    }
    ```

- **Term/BM25 evaluation (supporting but mandatory)**:

  - Build a small BM25 index per category + time window.
  - Document text = `title + summary + sourceTitle + categories/tags`.
  - Query strings are per-category and built from weighted domain term sets (below).
  - BM25 encodes domain expertise via term choices and weights.

- **Recency scoring**:

  - Exponential time decay per category.
  - Weekly digest: half-life ≈ 3 days.
  - Monthly digest: half-life ≈ 10 days.
  - Clamp to `[0.2, 1.0]` so older but important items can still surface.

- **Optional engagement score** (community only):
  - Use Reddit upvotes/comments if available.
  - Normalize to [0,1] and give low weight.

### Domain Term Categories and Weights

Term categories are used to design BM25 queries and to interpret heuristic term matches. Keep the same conceptual hierarchy, but think of them as query/intention clusters:

1. **Information Retrieval (1.5x)**
   Semantic search, embeddings, RAG, vector databases, indexes.

2. **Context Management (1.5x)**
   Context windows, token budgets, compression, summarization for LLMs.

3. **Code Search (1.6x)**
   Code indexing, navigation, symbols, cross-references, codebase search.

4. **Agentic Workflows (1.4x)**
   Agents, planning, tool use, orchestration, multi-step coding workflows.

5. **Enterprise Codebases (1.3x)**
   Monorepo, dependency management, modularization, scale, legacy systems.

6. **Developer Tools (1.2x)**
   IDEs, debugging, refactoring, dev productivity dashboards, CI/CD UX.

7. **LLM Code Architecture (1.2x)**
   Transformers, fine-tuning, function calling, toolformer-style designs, reasoning patterns.

8. **SDLC Processes (1.0x)**
   CI/CD, testing, code review, change management, deployment pipelines.

These categories should be expressed as:

- BM25 query expansions per category.
- Explanatory notes in the item’s reasoning field, e.g.:

  `[Term match: Code Search (1.6x), IR (1.5x); BM25=0.83]`

### Scoring Formula

For each item:

- `llmRaw = 0.7 * relevance + 0.3 * usefulness` (0–10 scale)
- Normalize BM25 and LLM scores to [0,1] per category/time-window.

Base formula:

```text
finalScore =
  (LLM_norm * w_llm) +
  (BM25_norm * w_bm25) +
  (Recency * w_recency) +
  (Engagement * w_engagement)   // community only
```

Default weights (tune per category in `CATEGORY_CONFIG`):

- `w_llm = 0.45`
- `w_bm25 = 0.35`
- `w_recency = 0.15`
- `w_engagement = 0.05` (community only, otherwise 0)

**BoostFactor (1.0–1.5)**:

- Multi-category term matches (e.g., Code Search + IR + Context).
- Strong concentration of domain terms despite modest LLM scores.
- Apply multiplicative factor:

```text
finalScore = finalScore * BoostFactor
```

**Penalties**:

- If LLM tags include `"off-topic"`, drop the item regardless of term score.
- If an item is generic company/market/HR news with weak domain terms, apply a down-weight even when LLM score is high.

### Selection, Thresholds, and Diversity

After computing `finalScore`:

1. Remove items:
   - `llmRaw < minRelevance` (per-category threshold).
   - Tagged `"off-topic"` by LLM.
2. Sort by `finalScore` descending.
3. Enforce diversity:
   - Hard cap per source per digest:
     - Weekly: recommended `max 2` per source per category.
     - Monthly: recommended `max 3` per source per category.
   - Greedy selection:
     - Iterate from highest score down.
     - Skip items that exceed per-source cap.
4. Stop after `CATEGORY_CONFIG[category].maxItems`.

### Reasoning Field Expectations

When the model (or agent) explains why an item was selected, reasoning must include:

- LLM scores: `relevance`, `usefulness`.
- Term/BM25 comment: which categories triggered, and approximate strength.
- Recency: age in days, reference to half-life effect.
- Any diversity decision (e.g., “Pragmatic Engineer already has 2 items, this is ranked lower and excluded”).

Link to deeper design doc if present:

- `history/hybrid-scoring-system.md` for scoring details and experiments.

## Build/Lint/Test Commands

This project is a Next.js TypeScript app. Use these commands (or update this section if you change package scripts):

```bash
# Install dependencies
npm install

# Dev server (humans only; agents must NOT run this)
npm run dev

# Type-check
npm run typecheck  # or `npm run ts:check` if defined

# Lint
npm run lint

# Tests
npm test           # or `npm run test` if configured

# Production build
npm run build
```

If scripts differ, update `package.json` and this section in lockstep.

Agents must NOT invent commands. Commands must match `package.json`.

## Daily Sync Command

**Easy way** (shell script with pretty output):
```bash
bash scripts/run-sync.sh
```

**Raw API call**:
```bash
curl -X POST http://localhost:3002/api/admin/sync-daily
```

**Check sync status**:
```bash
curl http://localhost:3002/api/admin/sync-daily
```

**Details**: See `DAILY_SYNC_USAGE.md`

## Relevance Tuning Commands

### Sync Starred Items from Inoreader
Pulls all starred/important items from your Inoreader account for manual curation and relevance ranking:

```bash
curl -X POST http://localhost:3002/api/admin/sync-starred \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

Returns:
```json
{
  "success": true,
  "message": "Synced N starred items",
  "stats": {
    "fetched": N,
    "saved": N,
    "starred": N
  }
}
```

### Get Source Relevance Ratings
View all sources with their current relevance scores (0-3 scale):

```bash
curl http://localhost:3002/api/admin/source-relevance
```

Returns list of all sources with `sourceRelevance` field:
- `0`: Ignore (filtered out)
- `1`: Neutral (default, no adjustment)
- `2`: Relevant (1.3x boost)
- `3`: Highly Relevant (1.6x boost)

### Set Source Relevance
Tune how much a source contributes to scoring:

```bash
curl -X POST http://localhost:3002/api/admin/source-relevance \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "streamId": "feed/https://...",
    "relevance": 2
  }'
```

### Get Starred Items for Rating
Fetch starred items ready for relevance assignment:

```bash
curl "http://localhost:3002/api/admin/starred?onlyUnrated=true&limit=20"
```

Query params:
- `onlyUnrated=true`: Only unrated items
- `limit=50`: Max items to return
- `offset=0`: Pagination offset

Returns items with `relevanceRating` field (null = unrated).

### Rate a Starred Item
Assign relevance ranking to a starred item (0-3):

```bash
curl -X PATCH http://localhost:3002/api/admin/starred/:inoreaderItemId \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 2,
    "notes": "Great explanation of semantic search"
  }'
```

Rating scale:
- `0`: Not Relevant
- `1`: Somewhat Relevant
- `2`: Relevant
- `3`: Highly Relevant
- `null`: Clear rating

## Architecture and Structure

Target directory structure for the combined project:

```text
code-intel-digest/
  app/
    layout.tsx
    page.tsx
    api/
      items/route.ts        # GET /api/items?category=&period=
  src/
    config/
      feeds.ts              # FeedConfig[] mapping Inoreader streamId → category, tags
      categories.ts         # CATEGORY_CONFIG per category
    lib/
      inoreader/
        client.ts           # Inoreader API client (fetch streams)
        types.ts            # Raw Inoreader types
      model.ts              # Category, FeedItem, RankedItem types
      pipeline/
        normalize.ts        # raw → FeedItem
        categorize.ts       # adjust categories based on folders/tags
        bm25.ts             # BM25 index and scoring
        llmScore.ts         # LLM batch scoring glue
        rank.ts             # combine BM25+LLM+recency+diversity
        select.ts           # source caps, top-K selection
      logger.ts             # structured logging (see below)
    components/
      layout/
        top-nav.tsx
      feeds/
        category-tabs.tsx
        items-grid.tsx
        item-card.tsx
  history/
    hybrid-scoring-system.md   # scoring design, experiments, notes
  AGENTS.md
  .beads/
    issues.jsonl               # bd issue tracker
```

If these modules do not yet exist, agents should create them following this structure.

### Backend Responsibilities

- `src/lib/inoreader/client.ts`:

  - Wraps Inoreader endpoints used in `/Users/sjarmak/research-agent`.
  - Provides `fetchStream({ streamId, n, continuation }, accessToken)` with retry and logging.
  - Uses env vars for auth:
    - `INOREADER_ACCESS_TOKEN` (or equivalent, kept consistent with the original project).

- `app/api/items/route.ts`:
  - Accepts `category` and `period` query parameters.
  - Fetches all relevant streams for that category via `FEEDS`.
  - Normalizes and categorizes items.
  - Filters by time window (e.g., 7 or 30 days).
  - Calls ranking pipeline.
  - Returns JSON array of `RankedItem`.

### Frontend Responsibilities

- `app/page.tsx`:

  - Main dashboard with:
    - Title, subtitle.
    - Tabs for each category.
    - Period selector (weekly/monthly).
  - Uses shadcn Tabs, Buttons, etc., following patterns from `/Users/sjarmak/agent-vibes`.

- `ItemsGrid`:

  - Fetches `/api/items?category=&period=`.
  - Renders `item-card`s.

- `ItemCard`:
  - Shows:
    - Source name.
    - Title (link).
    - Published date.
    - Category badge.
    - Short snippet.
  - Optionally shows small tag chips derived from LLM tags.

## Code Style

- TypeScript everywhere under `src/` and `app/`.
- Enable `strict` mode in `tsconfig.json`.
- Prefer functional, pure utilities in pipeline modules.
- No implicit `any`. No `// @ts-ignore` without an explicit explanation comment.
- Keep functions small and composable. One responsibility per module.

Formatting and linting:

- Use Prettier for formatting (if not configured, configure it).
- Use ESLint with a baseline Next.js/TypeScript config; extend as needed.
- Do not bypass lint/type errors in CI; fix them or open beads issues.

## Error Handling & Logging

### HTTP / API Calls

- Centralize network logic for Inoreader and any other HTTP calls.

- Use a `makeRequest`-style helper (create in `src/lib/inoreader/client.ts` or `src/lib/http.ts`) with:

  - Exponential backoff on transient errors:
    - HTTP 5xx
    - HTTP 429
    - Network-level failures
  - Max retry count (e.g., 3–5 attempts).
  - Logging on each retry with reason and delay.

### Structured Logging

Use `src/lib/logger.ts` for all logging.

Expected surface:

```ts
export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => { ... },
  warn: (msg: string, meta?: Record<string, unknown>) => { ... },
  error: (msg: string, meta?: Record<string, unknown>) => { ... },
};
```

Conventions:

- `logger.info`:
  - High-level events: fetch started/finished, pipeline stages, counts of items processed.
- `logger.warn`:
  - Retries, degraded modes, partial results, missing optional data.
- `logger.error`:
  - Hard failures: auth problems, invalid responses, pipeline exceptions.

Tool errors must:

- Return descriptive, human-readable messages to the model or UI, e.g., `"Inoreader authentication failed"` or `"LLM scoring API returned 429 (rate-limited)"`.
- Never surface raw stack traces or full HTTP responses in the user-facing API.

## Deep Search CLI (ds)

The `ds` CLI tool provides programmatic access to Sourcegraph Deep Search for AI-powered codebase analysis.

### Setup

Requires `SRC_ACCESS_TOKEN` environment variable. Optional: `SOURCEGRAPH_URL` (defaults to https://sourcegraph.sourcegraph.com)

### Common Usage Patterns

```bash
# Start a new conversation
ds start --question "Does the repo have authentication middleware?" | jq -r '.id'

# Continue existing conversation
ds ask --id fb1f21bb-07e5-48ff-a4cf-77bd2502c8a8 --question "How does it handle JWT tokens?"

# Get conversation by ID or UUID
ds get --id 332
ds get --id fb1f21bb-07e5-48ff-a4cf-77bd2502c8a8

# List recent conversations
ds list --first 5 --sort -created_at

# Async mode for long-running queries
ds start --question "Complex question" --async | jq -r '.id'
ds get --id <id>
```

Best practices:

- Use `--async` for complex, broad queries.
- Parse JSON output with `jq`.
- Save conversation IDs and reuse rather than spawning new ones.

## Issue Tracking with bd (beads)

Use **bd (beads)** for all issue tracking. No markdown TODOs, no other trackers.

Commands:

```bash
# Ready work
bd ready --json

# Create
bd create "Issue title" -t bug|feature|task|epic|chore -p 0-4 --json

# Link discovered work
bd create "Issue title" -p 1 --deps discovered-from:bd-123 --json

# Update / claim
bd update bd-42 --status in_progress --json
bd update bd-42 --priority 1 --json

# Close
bd close bd-42 --reason "Completed" --json
```

Priorities:

- 0 – Critical
- 1 – High
- 2 – Medium (default)
- 3 – Low
- 4 – Backlog

Workflow:

1. `bd ready` to pick work.
2. `bd update <id> --status in_progress` when starting.
3. Implement, test, document.
4. For discovered work, `bd create` with `discovered-from:<parent-id>`.
5. `bd close <id> --reason "Done"` when complete.
6. Always commit `.beads/issues.jsonl` with code changes.

Auto-sync behavior:

- Exports to `.beads/issues.jsonl` after changes.
- Imports from JSONL when newer (e.g., after `git pull`).

Rules:

- One agent per module at a time.
- No duplicate tracking systems.
- No markdown TODO lists.

## Managing AI-Generated Planning Documents

All AI-generated planning and design docs go into `history/`:

- `PLAN.md`, `IMPLEMENTATION.md`, `ARCHITECTURE.md`, `DESIGN.md`, `CODEBASE_SUMMARY.md`, `INTEGRATION_PLAN.md`, `TESTING_GUIDE.md`, `TECHNICAL_DESIGN.md`, etc.

Optional `.gitignore`:

```gitignore
history/
```

Keep repository root focused on durable artifacts. Planning docs are ephemeral and can be safely ignored unless explicitly requested.

## Landing the Plane

When instructed to “land the plane”:

1. File beads issues for any remaining work.
2. Run quality gates (if code changed):
   - `npm test`
   - `npm run lint`
   - `npm run build`
   - File P0 beads for any failures.
3. Update bead statuses:
   - Close finished.
   - Ensure in-progress work reflects reality.
4. Sync issue tracker with git:
   - `git pull --rebase`
   - Resolve `.beads/issues.jsonl` conflicts carefully.
   - Run any `bd` sync commands if configured.
5. Clean git state:
   ```bash
   git stash clear
   git remote prune origin
   git status
   ```
6. Choose and record one follow-up bead as recommended next work, with a succinct next-session prompt.

Output to the user:

- Completed work summary.
- New issues filed.
- Status of tests/lint/build.
- Prompt for next session.

## Agent Best Practices

### General Rules

- Never start development servers (`npm run dev`) as an agent.
- Do not open ports or run background daemons.
- Keep changes small and localized; open beads for follow-up work rather than over-expanding scope.

### ACE Framework Integration

If `.ace.json`, `AGENTS.md`, or `logs/` indicate ACE is present:

- Before work:
  - `ace get bullets --sort-by helpful --limit 10`
  - `ace status`
- On failure (build/test/lint):
  - Capture traces with `ace capture --bead <id> --exec <errors.json> --outcome failure`.
- After completing a task:
  - `ace learn --beads <id> --min-confidence 0.8` is mandatory before closing beads.
- Apply deltas when prompted:
  - `ace apply`

Execution trace JSON format:

```json
[
  {
    "runner": "tsc|vitest|eslint",
    "command": "npm run build",
    "status": "fail",
    "errors": [
      {
        "tool": "tsc",
        "severity": "error",
        "message": "Error message",
        "file": "path/to/file.ts",
        "line": 123
      }
    ]
  }
]
```

Principles:

- Capture failures.
- Learn from completed work.
- Consult learned patterns early.
- Keep the feedback loop tight.
