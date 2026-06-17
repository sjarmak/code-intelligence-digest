# Architecture diagram (LikeC4)

Architecture-as-code model of **Code Intelligence Digest**, rendered with
[LikeC4](https://likec4.dev). The model is the source of truth across
[`spec.c4`](spec.c4) (element kinds, tags, deployment node kinds),
[`model.c4`](model.c4) (the system), and [`views.c4`](views.c4) (structure,
walkthrough, and risk views), with the deployment model in
[`deployment.c4`](deployment.c4). The narrative companion is the repo-root
[`AGENTS.md`](../AGENTS.md) and the [`docs/conventions/`](../docs/conventions)
playbooks.

The system fetches items from Inoreader, normalizes and categorizes them into 9
categories, scores them with a hybrid LLM + BM25 + recency pipeline, ranks and
diversity-samples a digest, and packages the result as a Next.js reader UI, GTM
agent reports, newsletters, and podcasts — plus a read-only MCP copilot over a
production mirror. It runs on Render (web service + managed Postgres + cron).

Every element `link`s to the source path that implements it (`src/…`, `app/…`,
`scripts/…`, `render.yaml`) — so any box in the explorer is one click from the
code behind it.

## Delivery state is tagged, not guessed

Every element carries a tag so **planned and research work renders distinctly
from what is already built and exercised on the `production` branch** (legend in
`spec.c4`):

| Tag | Meaning | Render |
|---|---|---|
| `#built` | code path exists and runs in production | solid |
| `#evolving` | built, but the contract / scope is still moving | solid (amber) |
| `#planned` | designed; not yet implemented (or the slot is a stub) | **dashed, dimmed** |
| `#research` | speculative `research/` track, not wired in | **dashed, indigo** |

Notable tags grounded in the code:

- **`#planned`** — `engagement / citations scoring`: the `community` category
  declares an `engagement` weight and `research` declares `citations`/`reads`
  weights in [`categories.ts`](../src/config/categories.ts), but those signals
  are not computed in [`compute-scores.ts`](../src/lib/pipeline/compute-scores.ts)
  yet — the weight slots exist in config and schema only.
- **`#evolving`** — the MCP Phase B tools (`semantic_search_items`,
  `aggregate_items`), the ADS research sync, the media renderers, and the
  Sourcegraph integration-opportunity scorer.
- **`#research`** — the `research/` deep-dives (agentic memory, enterprise code
  retrieval, multi-agent orchestration) that inform the domain vocabulary but
  are not part of the runtime.

## Views

**Structure** — the static map:

| View | Scope |
|---|---|
| `index` | system landscape — the digest in context of Inoreader, ADS, LLM/embeddings/TTS, web search, Resend, LangSmith, Render |
| `digestSystem` | the system decomposed into containers (sync, pipeline, store, llm, agents, media, web, mcp, research) |
| `syncContainer` | ingestion & sync internals (Inoreader client, daily-sync, sync-state/circuit-breaker, ADS sync, budget guard) |
| `pipelineContainer` | the hybrid scoring & ranking pipeline (normalize, fulltext, BM25, LLM scorer, combiner, ranker, planned engagement) |
| `storeContainer` | the Postgres store repositories (driver/pool, items+scores, embeddings, agent-runs+media, relevance tuning, oauth+budget) |
| `llmContainer` | the LLM provider gateway (completion router, quality-model resolver, usage accounting) |
| `agentsContainer` | the GTM agent layer (job runner, retrieval, goal-aware ranker, curator trace, report writers) |
| `mediaContainer` | the media renderers (newsletter, podcast script, audio/TTS, PDF) |
| `webContainer` | the Next.js web + API surface (items/digest/search, agents/reports, media, admin/debug, health, auth, UI) |
| `mcpContainer` | the MCP copilot tools (search_items/get_item, semantic/aggregate, mirror_status) |
| `planned` | planned + evolving + research work, with built dependencies dimmed |
| `deployment` | where each piece runs — Render web/cron/Postgres, the local mirror + MCP, and the external services |

**Walkthrough flows** (dynamic / numbered-step views) — the narrative spine for
a design-review walkthrough:

| View | Flow |
|---|---|
| `syncFlow` | the daily cron: Inoreader pull → normalize → upsert → fulltext+embeddings → BM25+LLM scoring → persist item_scores |
| `readFlow` | a reader request: GET /api/items → on-demand rank → load precomputed scores → diversity-capped digest |
| `agentFlow` | a GTM report: trigger → retrieve (corpus + web) → goal-aware rank → LLM write → trace + persist → email |
| `mcpFlow` | an MCP coding agent: mirror_status freshness check → keyword/semantic search → get_item |

**Risk lens:**

| View | Scope |
|---|---|
| `risks` | the `#risk`-flagged elements with each open question stated in-box (Inoreader token-refresh fragility, no cross-provider LLM fallback, curator-trace schema-version compat break) |

## Risks surfaced

- **Inoreader token-refresh fragility** (`inoreaderClient`) — refresh depends on a
  stored/env refresh token; an `invalid_grant` requires manual re-auth
  ([runbook](../docs/ops/inoreader-reauth.md)).
- **No cross-provider LLM fallback** (`completion` router) — a primary-provider
  timeout records a degradation and the run continues *without* that LLM output,
  rather than failing over.
- **Curator-trace schema-version compat break** (`trace`) — changing the trace
  shapes without bumping `CURATOR_TRACE_SCHEMA_VERSION` silently breaks the
  `/reports/[id]` viewer.
- **Free-tier Postgres** (`prodDb`, deployment) — a single managed instance with
  no HA and free-plan storage/row limits caps corpus retention.

### Running the walkthrough

For a design review, present in this order: `index` → `digestSystem` (orient on
structure) → the four walkthrough flows in sequence (what actually happens) →
`deployment` (where it runs) → `risks` (what to probe) → `planned` (what's next).
In `npx likec4 start`, the dynamic views animate step-by-step and each view's
notes panel carries the gotchas (the heap-tuned cron limits, the stateless
on-demand ranking, the production-blocked admin routes, the mirror-staleness
warning).

## Viewing & regenerating

```bash
# Interactive, hot-reloading explorer (recommended)
npx likec4 start architecture

# Re-export the static PNGs in exports/ (needs a one-time browser download:
#   npx playwright install chromium-headless-shell)
npx likec4 export png architecture -o architecture/exports

# Validate the model (strict — the source of truth for correctness)
npx likec4 validate architecture
```

### Viewing the interactive explorer over SSH (headless remote)

`likec4 start` serves a Vite dev server on `localhost:5173`. From a headless
remote, forward that port to your laptop and open it locally — three options,
easiest first:

1. **VS Code / Cursor Remote-SSH** — run `npx likec4 start architecture` in the
   integrated terminal; the editor auto-forwards 5173 and offers "Open in
   Browser". Nothing else to configure.
2. **SSH local port-forward** — on your laptop:
   ```bash
   ssh -N -L 5173:localhost:5173 user@remote   # leave running
   ```
   then on the remote `npx likec4 start architecture` and open
   <http://localhost:5173> locally. (Already in an SSH session? Add the tunnel
   without reconnecting: press `~C` then type `-L 5173:localhost:5173`.)
3. **Bind + reach directly** — `npx likec4 start architecture --listen 0.0.0.0`
   and browse to `http://<remote-ip>:5173` (only if that port is reachable /
   firewall-open; the tunnel in option 2 is safer).

No browser at all? Export the PNGs with `npx likec4 export png` (needs no
display) — `scp` them down, or view inline if your terminal supports images.
