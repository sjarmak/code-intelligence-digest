# Architecture orientation — code-intelligence-digest

_Mechanically derived from the LikeC4 model (`likec4 export json`). High-altitude map only — names every subsystem, its purpose, delivery state, and exact source path so you targeted-read instead of grep-walking. For symbol-level depth, hand a source link below to an Explore/CodeGraph agent._

## Subsystems (75 elements)

- **NASA ADS** (externalSystem)
  Astrophysics Data System — source of academic research papers for the research category
- **Anthropic API** (externalSystem)
  Claude models — the default quality model for LLM scoring and agent report writing
- **Coding agent (MCP client)** (actor)
  Claude Code or another MCP client that queries the digest corpus through the copilot server
- **Code Intelligence Digest** (system)
  Fetch → normalize → categorize → score → rank → package code-intelligence content into digests, reports, news…
  ↳ `../README.md, ../AGENTS.md`
  - **GTM agent layer** (container)
    src/lib/agents + src/lib/retrieval — retrieve from corpus + live web, rank for a goal, and write competitive-…
    ↳ `../src/lib/agents, ../docs/conventions/gtm-agents.md`
    - **goal-aware ranker** (component) #built
      Re-ranks retrieved items by goal-specific features (competitor match, ICP fit, recency, format) before they e…
      ↳ `../src/lib/pipeline/agentRank.ts, ../src/lib/pipeline/goalFeatures.ts`
    - **report writers** (component) #built
      Goal-specific writers — competitive intel, market brief, content ideas — that turn ranked context into struct…
      ↳ `../src/lib/agents/competitor-intel.ts, ../src/lib/agents/market-brief.ts, ../src/lib/agents/content-ideas.ts`
    - **agent retrieval (corpus + web)** (component) #built
      Multi-source retrieval that merges Postgres items with live web-search results, deduped and domain-filtered,…
      ↳ `../src/lib/pipeline/agentRetrieval.ts, ../src/lib/retrieval/webSearch.ts`
    - **agent job runner** (component) #built
      runAgentJob: load scope → retrieve → rank → assemble context → call the LLM → persist the run; wrapped for La…
      ↳ `../src/lib/agents/run-job.ts, ../src/config/agent-jobs.ts, ../src/config/agents.ts`
    - **Sourcegraph integration scorer** (component) #evolving
      Heuristic detector that flags items as integration opportunities (workflow fit, failure modes, integration su…
      ↳ `../src/lib/agents/sourcegraph-integration-opportunity.ts`
    - **curator trace (audit)** (component) #built #risk
      Versioned snapshot of config + retrieval + ranking that powers /reports/[id] and ?trace=1.
      ↳ `../src/lib/retrieval/curator-trace.ts`
  - **Integrations** (container)
    src/lib/integrations + src/lib/ar5iv + src/lib/search — outbound Slack report delivery, inbound ar5iv/arXiv H…
    ↳ `../src/lib/integrations`
    - **ar5iv paper parser** (component) #built
      Fetches and parses ar5iv.org HTML renderings of arXiv papers into structured, readable content for the resear…
      ↳ `../src/lib/ar5iv`
    - **Slack delivery** (component) #built
      Posts agent reports to Slack and cleans up prior messages, behind /api/agents/reports/send-slack
      ↳ `../src/lib/integrations/slack.ts`
    - **URL discovery** (component) #built
      Search-based discovery of canonical article URLs for newsletter links
      ↳ `../src/lib/search/url-finder.ts`
  - **LLM provider gateway** (container)
    src/lib/llm — routes completions to Anthropic or OpenAI by model id, with timeouts, usage accounting, and a q…
    ↳ `../src/lib/llm`
    - **completion router** (component) #built #risk
      Routes claude-* → Anthropic, else → OpenAI, enforcing per-provider timeouts.
      ↳ `../src/lib/llm/completion.ts, ../src/lib/observability/degradation.ts`
    - **quality-model resolver** (component) #built
      Picks the model from DIGEST_QUALITY_MODEL, else claude-sonnet (Anthropic key) or gpt-4o-mini (OpenAI key)
      ↳ `../src/lib/llm/config.ts`
    - **usage accounting** (component) #built
      Per-call token + estimated-cost accounting, surfaced into agent-run metadata and token-budget checks
      ↳ `../src/lib/llm/usage-accounting.ts, ../src/lib/llm/pricing.ts`
  - **MCP copilot server** (container)
    src/mcp/server.ts — read-only MCP tools over the local production mirror, so a coding agent can query the dig…
    ↳ `../src/mcp/server.ts`
    - **mirror_status** (component) #built
      Reports backing-store mode and mirror freshness so the agent warns when the hourly sync is stale
      ↳ `../src/lib/copilot/mirror-context.ts`
    - **search_items / get_item** (component) #built
      Phase A: full-text keyword search over items and full single-item detail (incl.
      ↳ `../src/mcp/server.ts`
    - **semantic_search_items / aggregate_items** (component) #evolving
      Phase B: pgvector semantic search and group-by-source/author/category aggregation — registered and live, but…
      ↳ `../src/mcp/server.ts`
  - **Media renderers** (container)
    src/lib/audio + pipeline media stages + src/lib/pdf — turn a digest into newsletters, podcasts/audio, and PDF…
    ↳ `../src/lib/audio`
    - **audio renderer (TTS)** (component) #built
      Sanitizes a transcript, chunks it, renders speech via a TTS provider, and caches by transcript hash
      ↳ `../src/lib/audio/render.ts, ../src/lib/audio/sanitize.ts`
    - **newsletter builder** (component) #evolving
      Composes and review-passes a Markdown/HTML newsletter from selected items
      ↳ `../src/lib/pipeline/newsletter.ts, ../src/lib/pipeline/reviewNewsletter.ts`
    - **PDF export** (component) #built
      Renders a report/digest to a downloadable PDF
      ↳ `../src/lib/pdf/simple-report-pdf.ts`
    - **podcast script + rundown** (component) #evolving
      Builds a podcast script and rundown from a digest, then verifies it before audio rendering
      ↳ `../src/lib/pipeline/podcastScript.ts, ../src/lib/pipeline/podcastRundown.ts, ../src/lib/pipeline/podcastVerify.ts`
    - **TTS provider adapters** (component) #evolving
      OpenAI TTS (primary) plus ElevenLabs and NeMo behind one interface; the alternates are wired but lightly exer…
      ↳ `../src/lib/audio/providers/openaiTts.ts, ../src/lib/audio/providers/elevenlabsTts.ts, ../src/lib/audio/providers/nemoTts.ts`
  - **Scoring & ranking pipeline** (container)
    src/lib/pipeline — the hybrid LLM + BM25 + recency scorer and the diversity-aware ranker that produce a digest
    ↳ `../src/lib/pipeline, ../docs/conventions/scoring.md`
    - **BM25 index** (component) #built
      From-scratch Okapi BM25 scoring of each item against the category-specific domain-term query
      ↳ `../src/lib/pipeline/bm25.ts, ../src/config/domain-terms.ts`
    - **compute-scores (combiner)** (component) #built
      finalScore = w_llm * llm + w_bm25 * bm25, multiplied by product/watchlist/competitor boosts; persisted to ite…
      ↳ `../src/lib/pipeline/compute-scores.ts, ../src/config/categories.ts`
    - **engagement and citations scoring** (component) #planned
      PLANNED.
      ↳ `../src/config/categories.ts`
    - **fulltext fetch** (component) #built
      JSDOM + Mozilla Readability extraction of full article text, batched small (8/run) to fit the Render heap
      ↳ `../src/lib/pipeline/fulltext.ts`
    - **LLM scorer** (component) #built
      Per-item relevance + usefulness + tags from a quality LLM (Claude by default), with conservative scoring for…
      ↳ `../src/lib/pipeline/llmScore.ts`
    - **normalize + categorize + decompose** (component) #built
      Raw Inoreader payloads → typed FeedItems, assigned to one of 9 categories, with HTML decomposed to clean summ…
      ↳ `../src/lib/pipeline/normalize.ts, ../src/lib/pipeline/categorize.ts, ../src/lib/pipeline/decompose.ts`
    - **rank + select** (component) #built
      Loads precomputed scores, applies recency (subtle, all-time only), filters by min-relevance, then diversity-s…
      ↳ `../src/lib/pipeline/rank.ts, ../src/lib/pipeline/select.ts`
  - **Research deep-dives** (container) #research
    research/ — literature reviews and brainstorms on agentic memory, enterprise code retrieval, and multi-agent…
    ↳ `../research`
  - **Postgres store** (datastore) #built
    src/lib/db — items, item_scores, item_embeddings (pgvector), agent_runs, generated media, sync_state, oauth_t…
    ↳ `../src/lib/db, ../src/lib/db/schema-postgres.ts`
    - **agent runs + generated media** (component) #built
      Persists each agent report (output + llmUsage + degradation metadata), generated newsletters, and cached podc…
      ↳ `../src/lib/db/agent-runs.ts, ../src/lib/db/generated-newsletters.ts, ../src/lib/db/podcast-audio.ts`
    - **DB driver / pool** (component) #built
      Postgres connection pool with local-vs-production selection (USE_LOCAL_DB / LOCAL_DATABASE_URL / DATABASE_URL)
      ↳ `../src/lib/db/driver.ts`
    - **embeddings (pgvector)** (component) #built
      Stores and batch-reads OpenAI text-embedding-3-small vectors for semantic search
      ↳ `../src/lib/db/embeddings.ts, ../src/lib/embeddings/generate.ts`
    - **items + scores repos** (component) #built
      Read/write access to items and their precomputed item_scores, plus full-text (tsvector) search
      ↳ `../src/lib/db/items.ts, ../src/lib/db/scores.ts, ../src/lib/db/search.ts`
    - **oauth tokens + budget** (component) #built
      Persisted Inoreader refresh token plus daily API-budget accounting shared across runs
      ↳ `../src/lib/db/oauth-tokens.ts, ../src/lib/db/api-budget.ts`
    - **paper sections + annotations** (component) #built
      Structured research-paper extracts (sections, embeddings) and user annotations backing the papers surface
      ↳ `../src/lib/db/paper-sections.ts, ../src/lib/db/paper-annotations.ts`
    - **source / item relevance** (component) #built
      Operator-supplied per-feed and per-item relevance ratings that bias scoring and ranking
      ↳ `../src/lib/db/sourceRelevance.ts, ../src/lib/db/item-relevance.ts`
    - **user library (saved / digest / podcast)** (component) #built
      Per-user persistence: saved items, the personal digest library, and the saved podcast-audio list — the multi-…
      ↳ `../src/lib/db/savedItems.ts, ../src/lib/db/digestItems.ts, ../src/lib/db/user-podcast-audio.ts`
  - **Ingestion & sync** (container)
    src/lib/sync + src/lib/inoreader — pulls feed items and research papers in, with quota + resumability guards
    ↳ `../src/lib/sync`
    - **ADS research sync** (component) #evolving
      Parallel pull of academic papers from NASA ADS into the research category, with section extraction
      ↳ `../src/lib/sync/ads-research-sync.ts, ../src/lib/ads/client.ts`
    - **API budget guard** (component) #built
      Caps daily external API spend across sync runs so a single day cannot exhaust the Inoreader quota
      ↳ `../src/lib/sync/budget-guard.ts`
    - **Daily sync orchestrator** (component) #built
      Rolling-window pull → normalize → categorize → decompose → persist, resumable via the sync_state row when the…
      ↳ `../src/lib/sync/daily-sync.ts`
    - **Inoreader client** (component) #built #risk
      OAuth2 token refresh, rate-limit header parsing, and backoff against the Inoreader API.
      ↳ `../src/lib/inoreader/client.ts, ../docs/ops/inoreader-reauth.md`
    - **Sync state & circuit breaker** (component) #built
      Continuation token + calls-used tracking and a 429 circuit breaker so a throttled run pauses instead of faili…
      ↳ `../src/lib/sync/sync-state.ts, ../src/lib/sync/sync-backoff.ts`
  - **Next.js web + API** (container)
    app/ — the React reader/admin UI plus the REST API; auth via next-auth + middleware, with admin/debug routes…
    ↳ `../app`
    - **admin / debug API** (component) #built
      Sync triggers, fulltext/embedding population, ranking debug, analytics, cache, and relevance tuning across ~2…
      ↳ `../app/api/admin, ../src/lib/auth/guards.ts`
    - **agents / reports API** (component) #built
      Report CRUD, per-goal report endpoints, manual generation, and email send (via Resend)
      ↳ `../app/api/reports, ../app/api/agents`
    - **auth + middleware** (component) #built
      next-auth session enforcement plus an admin bearer token for cron, applied in middleware across all non-publi…
      ↳ `../middleware.ts, ../src/lib/auth/admin-token.ts`
    - **health endpoint** (component) #built
      GET /api/health — the Render health-check that confirms the DB is reachable
      ↳ `../app/api/health/route.ts`
    - **items / digest / search API** (component) #built
      GET /api/items, /api/digest, /api/search, /api/ask — the read surface that ranks and serves items on demand
      ↳ `../app/api/items/route.ts, ../app/api/search/route.ts`
    - **user library API** (component) #built
      Per-user library surface: GET/POST/DELETE /api/saved-items, /api/digest-items, /api/libraries, /api/tags, /ap…
      ↳ `../app/api/saved-items, ../app/api/digest-items, ../app/api/libraries`
    - **newsletter / podcast / audio API** (component) #evolving
      Generates and serves newsletters, podcast scripts, and rendered audio for the synthesis surface
      ↳ `../app/api/podcast, ../app/api/newsletter, ../app/api/audio-digest`
    - **papers / research API** (component) #built
      GET /api/papers, /api/papers/[bibcode]/content (ar5iv), and POST /api/papers/ask — list, fetch, and Q&A over…
      ↳ `../app/api/papers`
    - **publish / handoff API** (component) #built
      POST /api/publish-digest and /api/send-to-website — hand a digest/items off to the personal website pipeline…
      ↳ `../app/api/publish-digest, ../app/api/send-to-website`
    - **session / config API** (component) #built
      GET /api/me (current user + LLM config) and /api/auth-config (configured sign-in methods)
      ↳ `../app/api/me, ../app/api/auth-config`
    - **React UI** (component) #built
      Reader pages (home, digest, libraries), the synthesis builder, the reports viewer, and the admin dashboard
      ↳ `../app/page.tsx, ../app/reports/page.tsx, ../app/synthesis, ../src/components`
- **Inoreader** (externalSystem)
  RSS aggregator and source of truth for feed items; OAuth2 API with a ~1000 calls/day quota
  ↳ `https://www.inoreader.com/reader/api/`
- **LangSmith** (externalSystem)
  Trace capture and offline eval datasets/scorers for the content-ideas and market-brief agents
- **OpenAI API** (externalSystem)
  GPT models (scoring fallback), text-embedding-3-small for semantic search, and OpenAI TTS for audio
- **Operator / GTM owner** (actor)
  Tunes source relevance, triggers agent reports, and runs syncs from the admin surface
- **Reader** (actor)
  Consumes the curated digest, library, newsletters, and podcasts through the web UI
- **Render** (externalSystem)
  PaaS hosting the web service, the managed Postgres database, and the scheduled cron jobs
  ↳ `../render.yaml`
- **Resend** (externalSystem)
  Transactional email delivery used to send agent reports and digests
- **Slack** (externalSystem)
  Workspace channel where agent reports are posted and cleaned up
- **TTS (ElevenLabs / NeMo)** (externalSystem)
  Alternate text-to-speech back-ends for podcast audio, behind a common provider interface
- **Web search (Parallel / Tavily)** (externalSystem)
  Live web search that enriches GTM agent context beyond the stored corpus

## Connections (68 edges)

- `digest.sync.inoreaderClient` → `inoreader`: OAuth2 fetch of stream items (quota-bounded)
- `digest.sync.adsSync` → `ads`: fetches research papers
- `digest.sync.dailySync` → `digest.sync.inoreaderClient`: rolling-window pull
- `digest.sync.dailySync` → `digest.sync.syncState`: continuation token + circuit breaker
- `digest.sync.dailySync` → `digest.sync.budgetGuard`: checks daily API budget
- `digest.sync.budgetGuard` → `digest.store.oauthRepo`: reads / increments API budget
- `digest.sync.inoreaderClient` → `digest.store.oauthRepo`: reads refresh token
- `digest.sync.dailySync` → `digest.pipeline.normalize`: raw items → typed FeedItems
- `digest.sync.dailySync` → `digest.store.itemsRepo`: upserts items (dedup on id)
- `digest.pipeline.normalize` → `digest.pipeline.fulltext`: enrich with full article text
- `digest.pipeline.computeScores` → `digest.pipeline.bm25`: BM25 vs domain-term query
- `digest.pipeline.computeScores` → `digest.pipeline.llmScore`: relevance + usefulness
- `digest.pipeline.llmScore` → `digest.llm`: quality-model completion
- `digest.pipeline.computeScores` → `digest.store.itemsRepo`: persists item_scores
- `digest.pipeline.fulltext` → `digest.store.embeddingsRepo`: embed full text
- `digest.store.embeddingsRepo` → `openai`: text-embedding-3-small
- `digest.pipeline.ranker` → `digest.store.itemsRepo`: loads items + precomputed scores
- `digest.pipeline.engagement` → `digest.store.itemsRepo`: planned engagement / citation signals
- `digest.llm.completion` → `digest.llm.llmConfig`: resolve quality model
- `digest.llm.completion` → `anthropic`: claude-* completions
- `digest.llm.completion` → `openai`: gpt-* completions (fallback)
- `digest.llm.completion` → `digest.llm.usage`: records tokens + cost
- `digest.agents.runJob` → `digest.agents.retrieval`: retrieve for goal
- `digest.agents.retrieval` → `digest.store.itemsRepo`: corpus items
- `digest.agents.retrieval` → `webSearchProviders`: live web search
- `digest.agents.runJob` → `digest.agents.agentRank`: rank for goal
- `digest.agents.runJob` → `digest.agents.reportWriters`: write structured report
- `digest.agents.reportWriters` → `digest.llm`: report-writing completion
- `digest.agents.runJob` → `digest.agents.trace`: captures config + ranking trace
- `digest.agents.runJob` → `digest.store.agentRunsRepo`: persists run + usage + degradation
- `digest.agents.runJob` → `langsmith`: traces the run (when enabled)
- `digest.agents.reportWriters` → `digest.agents.sourcegraphPlay`: integration-opportunity signal
- `digest.media.newsletter` → `digest.pipeline.ranker`: selected items → newsletter
- `digest.media.podcastScript` → `digest.pipeline.ranker`: selected items → script
- `digest.media.podcastScript` → `digest.llm`: script generation
- `digest.media.audioRender` → `digest.media.ttsProviderAdapters`: render speech
- `digest.media.ttsProviderAdapters` → `openai`: OpenAI TTS (primary)
- `digest.media.ttsProviderAdapters` → `ttsProviders`: ElevenLabs / NeMo
- `digest.media.audioRender` → `digest.store.agentRunsRepo`: caches audio by transcript hash
- `reader` → `digest.web`: browses digests, library, newsletters, podcasts
- `operator` → `digest.web`: tunes relevance, runs syncs, triggers reports
- `digest.web.itemsApi` → `digest.pipeline.ranker`: rank items on demand
- `digest.web.itemsApi` → `digest.store.itemsRepo`: reads items + scores
- `digest.web.agentsApi` → `digest.store.agentRunsRepo`: reads / writes reports
- `digest.web.agentsApi` → `digest.agents.runJob`: generates a report (dev / operator)
- `digest.web.agentsApi` → `resend`: emails reports
- `digest.web.mediaApi` → `digest.media.newsletter`: build newsletter
- `digest.web.mediaApi` → `digest.media.audioRender`: render podcast audio
- `digest.web.adminApi` → `digest.sync.dailySync`: triggers sync (dev / operator)
- `digest.web.adminApi` → `digest.store.tuningRepo`: updates source / item relevance
- `digest.web.health` → `digest.store.driver`: confirms DB reachable
- `digest.web.ui` → `digest.web.itemsApi`: fetches ranked items
- `digest.web.auth` → `digest.web.ui`: session / admin-token guard
- `digest.web.libraryApi` → `digest.store.userLibraryRepo`: reads / writes per-user library
- `digest.web.papersApi` → `digest.store.paperRepo`: reads paper sections + annotations
- `digest.web.papersApi` → `digest.integrations.ar5iv`: fetches paper HTML content
- `digest.web.sessionApi` → `digest.web.auth`: resolves current session / config
- `digest.web.agentsApi` → `digest.integrations.slack`: posts reports to Slack
- `digest.integrations.ar5iv` → `ads`: fetches ar5iv / arXiv paper HTML
- `digest.integrations.slack` → `slackExt`: posts / cleans up report messages
- `digest.media.newsletter` → `digest.integrations.urlFinder`: resolves article URLs
- `copilotAgent` → `digest.mcp`: MCP tool calls over stdio
- `digest.mcp.searchTools` → `digest.store.itemsRepo`: full-text search / fetch
- `digest.mcp.semanticTools` → `digest.store.embeddingsRepo`: pgvector similarity
- `digest.mcp.semanticTools` → `openai`: embeds the query
- `digest.mcp.mirrorStatus` → `digest.store.driver`: reports mirror freshness
- `digest.researchTrack` → `digest.pipeline.bm25`: informs domain terms
- `digest` → `render`: web service + Postgres + cron
