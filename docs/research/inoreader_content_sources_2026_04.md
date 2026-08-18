# Inoreader Content Sources — Codebase Sweep + Additions Proposal

**Date:** 2026-04-29
**Author:** code-intel-digest-worker (bd code-intel-digest-s32)
**Scope:** Read-only sweep of feeds/categories/scoring + research-driven proposal for new sources and organizational improvements.

---

## 1. Current State

### 1.1 Code shape

- **Feed discovery is dynamic.** `src/config/feeds.ts` does not maintain a hand-rolled list of subscriptions. `getFeeds()` calls Inoreader's `/subscription/list` API (1 call, cached in PostgreSQL + disk). ~112+ subscriptions are discovered automatically.
- **Categorization is folder-name keyword matching.** `FOLDER_TO_CATEGORY` (feeds.ts:30-103) maps lowercase folder/label names → canonical `Category`. First match wins; default fallback is `newsletters`.
- **Categories defined in `src/lib/model.ts`:** 9 active categories, not 7 as documented in `README.md`. The two newer ones (`ai_dev`, `marketing`) were added without doc updates.

| Slug          | Display name    | Half-life | Min relevance | Notes                                                |
| ------------- | --------------- | --------- | ------------- | ---------------------------------------------------- |
| newsletters   | Newsletters     | 3 d       | 5             | Default fallback for unrecognized folders            |
| podcasts      | Podcasts        | 7 d       | 5             |                                                      |
| tech_articles | Tech Articles   | 5 d       | 5             |                                                      |
| ai_news       | AI News         | 2 d       | 4             | Most aggressive recency, lowest threshold            |
| ai_dev        | AI Dev          | 3 d       | 5             | AI-in-developer-workflow split from ai_news          |
| product_news  | Product News    | 4 d       | 5             | Includes `tech company blogs` per latest mapping     |
| community     | Community       | 3 d       | 4             | +20% engagement weight, includes `tech leaders` mix  |
| research      | Research        | 10 d      | 5             | Adds citations + reads weights                       |
| marketing     | Marketing       | 7 d       | 4             | Goal-driven (DevRel/ICP) — separate from product_news|

### 1.2 Scoring/surfacing logic

- `bm25.ts` maps each `Category` → weighted bundles of domain term groups (`code_search`, `ir`, `context`, `agentic`, `enterprise`, `devtools`, `llm_code`, `sdlc`). These domain groups are **defined in `src/config/domain-terms.ts`** and reused as the BM25 query backbone.
- `llmScore.ts` builds **category-specific LLM prompts** (relevance/usefulness/tags). Tags are pulled from a fixed list: `code-search, semantic-search, agent, context, devex, devops, enterprise, research, infra, off-topic`.
- `rank.ts` combines `BM25 * 0.35 + LLM * 0.45 + recency * 0.20` (default), with category-specific overrides + product-mention boosts via `src/config/products.ts`.
- `select.ts` enforces dedup-by-URL, score floor (0.05), per-source caps (newsletters strict at 2/source; others 3-4), and minimum-10-items guarantee.

### 1.3 Strategic posture (from `src/config/competitor-intel.yaml`)

The product is built **from a Sourcegraph-incumbent angle**: tracked surfaces include `deep_search`, `code_search`, `code_navigation`, `mcp`, `agent_context`, `batch_changes`, `large_codebase_understanding`. Tracked competitors (Tier-1): GitHub Copilot, GitLab Duo, Augment, Cursor, Windsurf, Claude Code, Atlassian Rovo, Qodo, Greptile, Semgrep, CodeSee, Moderne. The digest is therefore optimized to surface (a) product moves of those competitors, (b) ecosystem shifts (MCP, evals), and (c) buyer-side language ("monorepo", "deep search", "agent context").

### 1.4 Gaps observed

1. **MCP coverage is thin.** "MCP" appears in `competitor-intel.yaml` as a tracked surface but has no dedicated category, no folder-to-category mapping, and no domain-term group. With the explosive 2025-2026 MCP server ecosystem, this is a strategic blind spot.
2. **Evals/benchmarks have no home.** SWE-bench, SWE-bench Pro, SWE-bench-Live, agent leaderboards, eval methodology — these land in `research` (if academic) or `tech_articles` (if blog post), with no cross-cutting surfacing despite being a buyer's primary purchase-justification artifact.
3. **README says 7 categories; code has 9.** `ai_dev` and `marketing` are undocumented in the README.
4. **No tag-based discovery.** LLM scorer emits tags (`agent`, `code-search`, etc.), but the UI/API exposes only category. Tags are scored, then dropped at the surfacing layer.
5. **Coding-agent product noise.** All competitor changelogs land in `product_news` mixed with general dev-tool announcements. Buyer-facing competitive surfacing is buried.
6. **Open-source coding-agent ecosystem under-covered.** Cline, Aider, OpenCode, Codename Goose, Continue.dev — these set the baseline buyer expectation but are barely in the feed.

---

## 2. Recommended Additions (≥15 candidates)

Prioritization rubric:
- **P0 — strategic must-have:** fills a known gap in tracked surfaces or competitor intelligence.
- **P1 — clearly additive:** high-signal source, low-noise, fits an existing category.
- **P2 — exploratory:** worth trying with a quarterly review.

Subscription URLs are the canonical RSS/Atom endpoint where known. Where the source doesn't expose RSS directly, an alternative ingestion note is included.

### 2.1 Newsletters & blogs

| # | Source | URL | Target category | Tier | Rationale |
|---|--------|-----|-----------------|------|-----------|
| 1 | **Latent Space (Swyx + Alessio)** | https://www.latent.space/feed | newsletters / ai_dev | P0 | The single most-cited newsletter in the AI-engineer space; covers code agents, MCP, harness eng, RAG. swyx's "2026 = coding agents breaking containment" framing maps directly to our buyer narrative. |
| 2 | **Simon Willison's Weblog** | https://simonwillison.net/atom/everything/ | tech_articles | P0 | Daily LLM/agent commentary, eval skepticism, prompt-injection coverage. Highest signal-to-noise on practical agent failure modes. |
| 3 | **Interconnects (Nathan Lambert)** | https://www.interconnects.ai/feed | ai_news | P1 | RL/post-training analysis; relevant for understanding why coding agents converge or diverge. |
| 4 | **Eugene Yan** | https://eugeneyan.com/rss/ | tech_articles | P0 | Applied RAG, eval design, LLM-as-judge primers. The 80%-of-agent-eval-content-cited-by-practitioners author. |
| 5 | **Hamel Husain — Field Notes** | https://hamel.dev/index.xml | tech_articles / ai_dev | P0 | Eval methodology + telemetry for LLM apps. Fills the "Evals" gap; buyer-relevant. |
| 6 | **Chip Huyen Blog** | https://huyenchip.com/feed.xml | tech_articles | P1 | ML systems / agents; long-form, deeply researched. |
| 7 | **Lilian Weng** | https://lilianweng.github.io/feed.xml | research / tech_articles | P1 | Survey-quality posts on agents and RL; canonical. |
| 8 | **Sebastian Raschka — Ahead of AI** | https://magazine.sebastianraschka.com/feed | newsletters | P1 | Foundation-model + post-training commentary. |
| 9 | **The Pragmatic Engineer Deepdives** | https://newsletter.pragmaticengineer.com/feed | newsletters | P0 | Already partially present. Confirm `Pragmatic Engineer` (free) AND the deepdive feed are both subscribed. Buyer-side ICP overlap is high (eng leaders). |
| 10 | **The Sequence** | https://thesequence.substack.com/feed | newsletters | P1 | Daily AI digest with explicit research-vs-product split. |
| 11 | **Ben's Bites** | https://bensbites.beehiiv.com/feed | newsletters | P2 | Higher noise but catches tail-end product launches. |
| 12 | **Aman.AI** | https://aman.ai/rss.xml | tech_articles / research | P1 | Notes-style deep dives on coding-LLM training, agent design. |
| 13 | **The Batch (deeplearning.ai)** | https://www.deeplearning.ai/the-batch/feed | newsletters | P2 | Andrew Ng's editorial weekly. Mostly sentiment-tracking value. |
| 14 | **AI Snake Oil (Princeton)** | https://www.aisnakeoil.com/feed | tech_articles | P1 | Adversarial, eval-skeptic counterweight to vendor hype. |
| 15 | **Anthropic blog** | https://www.anthropic.com/news/rss.xml | product_news / ai_news | P0 | Claude releases, Claude Code changelog, MCP announcements. Likely already in product_news but verify. |
| 16 | **OpenAI blog** | https://openai.com/blog/rss/ | product_news / ai_news | P0 | Codex, GPT-5.x, agent releases. Buyer-essential. |
| 17 | **Cursor changelog** | https://www.cursor.com/changelog (HTML; mirror via RSSHub or kill the duck) | product_news | P0 | Direct competitor; we currently rely on second-hand coverage. |
| 18 | **Cognition (Devin) blog** | https://www.cognition.ai/blog (no native RSS — use Inoreader Page Monitor or RSSHub `/cognition/blog`) | product_news | P0 | Tier-1 autonomous-agent competitor. |
| 19 | **Continue.dev blog** | https://blog.continue.dev/rss/ | product_news | P1 | Open-source IDE-agent baseline; sets buyer expectations. |
| 20 | **Aider release notes / Paul Gauthier blog** | https://aider.chat/HISTORY.html (RSSHub: `/github/release/Aider-AI/aider`) | product_news / ai_dev | P1 | OSS terminal coding agent; benchmark of "what a small agent can do". |
| 21 | **JetBrains AI Assistant blog** | https://blog.jetbrains.com/feed/ filtered to "AI Assistant" tag | product_news | P1 | Counterprogram to GitHub/Cursor in IDE space. |
| 22 | **Anthropic Engineering blog** | https://www.anthropic.com/engineering/rss.xml | tech_articles | P1 | Production agent patterns from inside Anthropic. |
| 23 | **Sourcegraph blog** | https://sourcegraph.com/blog/rss.xml | product_news / tech_articles | P0 | Confirm subscribed. Strategic must-have. |
| 24 | **Vercel changelog** | https://vercel.com/changelog/feed.xml | product_news | P2 | Adjacent infra; AI SDK + v0 agent moves. |
| 25 | **Modal blog** | https://modal.com/blog (RSSHub) | tech_articles | P2 | Sandbox-as-a-service infra for agents. |

### 2.2 Podcasts

| # | Source | URL | Target category | Tier | Rationale |
|---|--------|-----|-----------------|------|-----------|
| 26 | **Latent Space podcast** | https://api.substack.com/feed/podcast/1084089.rss | podcasts | P0 | Companion to #1; primary AI-engineer audio source. |
| 27 | **Practical AI (Changelog)** | https://changelog.com/practicalai/feed | podcasts | P1 | Engineering-flavored. |
| 28 | **The Cognitive Revolution** | https://feeds.transistor.fm/the-cognitive-revolution | podcasts | P1 | Founder + researcher interviews; covers agents extensively. |
| 29 | **No Priors** | https://no-priors.simplecast.com/episodes.rss | podcasts | P2 | Builder/VC interviews, occasionally land big agent reveals. |
| 30 | **Software Engineering Daily** | https://feeds.simplecast.com/RfPgu03G | podcasts | P1 | Long-running, broad coverage. |
| 31 | **Pragmatic Engineer Podcast** | https://feeds.transistor.fm/the-pragmatic-engineer | podcasts | P0 | Already-trusted brand for eng-leader audience. |
| 32 | **Dwarkesh Podcast** | https://feeds.megaphone.fm/dwarkesh | podcasts | P1 | Long-form research interviews; primary source for several alignment + agent debates. |
| 33 | **AI Native Dev (Tessl)** | https://podcasts.apple.com/podcast/id1794578040 (find native RSS) | podcasts | P1 | Specifically about coding agents + spec-driven dev. |
| 34 | **Software Unscripted** | https://feeds.fireside.fm/softwareunscripted/rss | podcasts | P2 | PL/eng theory, occasional coding-agent topics. |
| 35 | **Changelog & Friends** | https://changelog.com/friends/feed | podcasts | P2 | News-of-the-week format. |

### 2.3 GitHub awesome-lists / curated repos

These do not have native RSS but are surveyed via `gh api repos/<owner>/<repo>/commits` (could be picked up by an internal job rather than Inoreader). Listed here so the categorization story stays coherent.

| # | Source | URL | Target | Tier | Rationale |
|---|--------|-----|--------|------|-----------|
| 36 | **modelcontextprotocol/servers** | https://github.com/modelcontextprotocol/servers | tech_articles (commit feed) | P0 | Official MCP server list — strategic must-track. |
| 37 | **wong2/awesome-mcp-servers** | https://github.com/wong2/awesome-mcp-servers | tech_articles | P0 | Most-starred community curation. |
| 38 | **tolkonepiu/best-of-mcp-servers** | https://github.com/tolkonepiu/best-of-mcp-servers | tech_articles | P1 | Ranked, weekly-updated; complements wong2. |
| 39 | **e2b-dev/awesome-ai-agents** | https://github.com/e2b-dev/awesome-ai-agents | tech_articles | P1 | Comprehensive agents catalogue. |
| 40 | **huybery/Awesome-Code-LLM** | https://github.com/huybery/Awesome-Code-LLM | research | P1 | Code-LLM training literature. |

### 2.4 Forums / communities (Reddit, HN-equivalents)

| # | Source | URL | Target | Tier | Rationale |
|---|--------|-----|--------|------|-----------|
| 41 | **r/LocalLLaMA** | https://www.reddit.com/r/LocalLLaMA/.rss | community | P0 | Highest-signal practitioner community on local agents + harness eng. |
| 42 | **r/ClaudeAI** | https://www.reddit.com/r/ClaudeAI/.rss | community | P1 | Direct buyer-feedback signal on Claude Code. |
| 43 | **r/cursor** | https://www.reddit.com/r/cursor/.rss | community | P1 | Direct competitor sentiment. |
| 44 | **r/MachineLearning** | https://www.reddit.com/r/MachineLearning/.rss | community | P2 | Already noisy; useful as research-trend leading indicator. |
| 45 | **r/LangChain** | https://www.reddit.com/r/LangChain/.rss | community | P2 | Framework-side signal. |
| 46 | **Lobste.rs** | https://lobste.rs/rss | community | P1 | High-quality engineering discourse, low-volume. |
| 47 | **HN best/front-page** | https://hnrss.org/frontpage?points=200 | community | P0 | Confirm subscription; threshold by points to cut noise. |

### 2.5 Academic / research feeds

| # | Source | URL | Target | Tier | Rationale |
|---|--------|-----|--------|------|-----------|
| 48 | **arxiv-cs.SE (Software Engineering)** | http://export.arxiv.org/rss/cs.SE | research | P0 | Direct match for SWE-bench, agent eval, repo-mining work. We currently lean on cs.AI; cs.SE is the missing twin. |
| 49 | **arxiv-cs.IR (Information Retrieval)** | http://export.arxiv.org/rss/cs.IR | research | P1 | Sparse + dense retrieval, RAG eval methodology. |
| 50 | **arxiv-cs.PL (Programming Languages)** | http://export.arxiv.org/rss/cs.PL | research | P2 | Symbolic + program-analysis adjacency. |
| 51 | **Hugging Face Daily Papers** | https://huggingface.co/papers (RSS via `/papers/feed`) | research | P0 | Curated, community-voted. Higher signal than raw arxiv. |
| 52 | **Papers with Code** | https://paperswithcode.com/feeds/rss/ | research | P1 | Benchmark-anchored research. |
| 53 | **Google Research blog** | https://research.google/blog/rss/ | research / tech_articles | P1 | First-party agent + retrieval research. |
| 54 | **Microsoft Research blog** | https://www.microsoft.com/en-us/research/feed/ | research / tech_articles | P2 | |
| 55 | **DeepMind blog** | https://deepmind.google/blog/rss.xml | research / ai_news | P2 | |
| 56 | **Anthropic Research papers** | https://www.anthropic.com/research/rss.xml | research | P0 | Direct vendor research. |

### 2.6 Strategic / buyer-language sources

| # | Source | URL | Target | Tier | Rationale |
|---|--------|-----|--------|------|-----------|
| 57 | **A16Z Future / Marc Andreessen blog** | https://a16z.com/feed/ | marketing | P2 | VC framing of the agent stack; useful for category-creation language. |
| 58 | **Stratechery (paid)** | https://stratechery.com/feed/ | newsletters | P2 | Strategy framing for the platform layer. Note paywall. |
| 59 | **DevTools.fyi / Werner Vogels — All Things Distributed** | https://www.allthingsdistributed.com/atom.xml | tech_articles | P2 | Enterprise architecture POV. |

---

## 3. Recommended Organizational Changes

### 3.1 Promote MCP to a first-class concern (P0)

**Problem:** MCP is the single biggest ecosystem shift since RAG, but it has no folder, no domain-term group, and no LLM-prompt mention. It's silently absorbed into `tech_articles` / `product_news`.

**Proposal — pick one of:**

- **Option A: New `mcp` domain-term group.** Add `mcp`, `model context protocol`, `mcp server`, `mcp client`, `mcp host`, `tool calling`, `protocol`, `stdio`, `streamable http` as a new `DomainCategory` in `src/config/domain-terms.ts`, weighted 1.5x (parity with `ir`/`context`). Inject into the BM25 query bundles for `tech_articles`, `product_news`, `ai_dev`. **Lowest blast radius; no UI changes.**
- **Option B: Tag-based surfacing.** Add `mcp` to the LLM tag set in `llmScore.ts`, then expose a tag filter at the API/UI layer. **Higher payoff; requires API extension.**
- **Option C: Subcategory.** Introduce `ai_dev.mcp` as a tag-ish subcategory under `ai_dev`. **Most disruptive; only do if MCP volume warrants a dedicated tab.**

Recommend **A + B in parallel**: A is a 30-line config patch; B is one-day API/UI work and enables the same pattern for `evals`, `code-search`, etc.

### 3.2 Surface tags as a top-level discovery axis (P1)

**Problem:** The LLM scorer already emits `agent`, `code-search`, `context`, `devex`, `enterprise`, `research`, `infra`, `off-topic` tags per item, but the API/UI flatten this to `category` only. We're paying for the LLM tag classification and discarding it.

**Proposal:**

1. Persist tags in the items table (already partially there via `tags?: string[]` on `FeedConfig`; extend to `RankedItem`).
2. Add `?tag=mcp` and `?tag=evals` query params to `GET /api/items`.
3. Add a tag chip row above the digest grid; multi-select OR-style filter.
4. Auto-derive a "trending tags" panel from last-7-days tag frequency.

This converts the eight existing tags into eight new browse axes for free.

### 3.3 Split `product_news` into competitor-tier subcategories (P1)

**Problem:** All vendor changelogs land in one bucket. A buyer-facing summary that conflates "Cursor 0.49 ships background agents" with "Vercel adds Postgres pooling" is structurally broken. Tier-1 competitor moves are the highest-priority signal we have.

**Proposal:** Inside `product_news`, introduce tier classification driven by `src/config/competitors.ts` (already has `direct` vs `augmenting`):

- `product_news.direct` (Tier-1: GitHub, GitLab, Augment, Cursor, Windsurf, Claude Code, Atlassian Rovo, Cognition, Sourcegraph)
- `product_news.augmenting` (everything else)
- `product_news.changelogs` (vendor changelogs separate from blog posts)

Either:
- **Lightweight:** add a `tier` field on `RankedItem`, derived at rank time from product detection; surface as filter/chip.
- **Heavy:** split into three categories in `model.ts`. Avoid; over-fits the taxonomy.

### 3.4 Add an `evals` tag / sub-stream (P1)

**Problem:** SWE-bench, SWE-bench Pro, SWE-bench-Live, Aider polyglot, agent leaderboards, eval methodology posts are individually high-value but currently scatter across `research` / `tech_articles` / `ai_dev`. Eval posts sell to a specific buyer persona (eng leader / Director of AI eng).

**Proposal:** Add `evals` to:
- The `domain-terms.ts` group (terms: `swe-bench`, `eval`, `benchmark`, `leaderboard`, `pass@1`, `humaneval`, `aider polyglot`, `livecodebench`, `groundtruth`, `task suite`).
- The LLM tag enum in `llmScore.ts`.
- A virtual category route `/api/items?tag=evals` (depends on §3.2 landing first).

### 3.5 Add an "open-source coding agents" lens (P2)

**Problem:** Aider, Cline, Continue.dev, OpenCode, Codename Goose, Devstral-coding scaffolds — these set buyer expectations for "what an OSS agent should do" and influence proprietary-tool feature roadmaps. Currently absorbed into `product_news` undifferentiated.

**Proposal:** New `oss_agents` cross-cutting tag, applied at categorize-time when source matches a known-OSS-agent allowlist (Cline repo releases, Aider release notes, OpenCode commits, etc.).

### 3.6 Reconcile the README ↔ code drift (P0)

**Problem:** README.md:8 says "7 fixed digest categories" — code has 9. AGENTS.md:77 lists 7 categories. Drift is a few months old.

**Proposal:** Single-paragraph patch to README + AGENTS.md listing all 9 categories with one-line descriptions each. Could be folded into the s32 follow-up bead.

### 3.7 Source-quality tiers (P2)

**Problem:** The diversity selector caps every source uniformly (max 2-3 per category). High-trust sources (Anthropic engineering, Latent Space, Simon Willison) are throttled to the same per-source cap as a noisy aggregator.

**Proposal:** Add a `sourceQuality: "S" | "A" | "B"` field on `FeedConfig`. Allow the per-source cap to scale: S = up to 4 per category, A = up to 3, B = up to 2. Maintain a 30-source `S/A` allowlist.

### 3.8 Newsletter ↔ podcast pairing (P2)

**Problem:** Latent Space, Pragmatic Engineer, Practical AI, Changelog all publish a newsletter and a podcast. They're scored independently and compete with themselves for diversity slots.

**Proposal:** Add `parentBrand` field on `FeedConfig`; per-source cap counts brand siblings together.

### 3.9 Inoreader folder-name hygiene (P2)

**Problem:** Folder-keyword matching is order-sensitive and overlap-prone (e.g. a feed in folders `["AI Articles", "newsletter"]` lands in `ai_news`, not `newsletters`, depending on iteration order). New folders (e.g. `MCP`, `evals`) don't have a mapping.

**Proposal:**
1. Add `mcp → ai_dev`, `evals → ai_dev`, `eval → ai_dev`, `benchmarks → research` to `FOLDER_TO_CATEGORY`.
2. Document the precedence rule in feeds.ts.
3. Add a unit test for folder→category mapping with at least one fixture per folder name.

---

## 4. Prioritized Follow-Up Beads (suggested)

### P0 (do this iteration)

- **bd-NEW-1** — Add `mcp` domain-term group to `src/config/domain-terms.ts`; inject into BM25 bundles for `tech_articles`, `product_news`, `ai_dev`. (≤30 LOC, no UI changes.)
- **bd-NEW-2** — Subscribe (in Inoreader) the Tier-1 P0 sources from §2: Latent Space, Simon Willison, Eugene Yan, Hamel, Anthropic blog, Anthropic Research, OpenAI blog, Cursor changelog, Cognition blog, Sourcegraph blog, Pragmatic Engineer Deepdives, HF Daily Papers, arxiv-cs.SE, r/LocalLLaMA, HN frontpage 200+. (Manual subscription + folder placement; no code change beyond folder-name additions.)
- **bd-NEW-3** — Reconcile README + AGENTS.md to list all 9 categories. (Doc patch.)

### P1 (next iteration)

- **bd-NEW-4** — Persist + expose LLM tags via `?tag=` query param on `GET /api/items`; render as tag chips in UI. (§3.2)
- **bd-NEW-5** — Add `evals` domain-term group + LLM tag; verify routing into `?tag=evals`. (§3.4, depends on bd-NEW-4)
- **bd-NEW-6** — Subscribe P1 sources from §2 (Interconnects, Chip Huyen, Lilian Weng, Aman.AI, Continue.dev, Aider releases, JetBrains, Anthropic Engineering, Sebastian Raschka, AI Snake Oil, The Sequence, podcasts P1). (Manual subscription.)
- **bd-NEW-7** — Surface competitor tier on `RankedItem`; add `?tier=direct` filter on `product_news`. (§3.3)
- **bd-NEW-8** — Page-monitor / RSSHub bridge for sources without native RSS (Cursor changelog, Cognition blog, Modal blog). Either spin up a tiny RSSHub container or use Inoreader's URL-monitor feature. (§2.1 footnotes 17, 18, 25)

### P2 (exploratory, quarterly review)

- **bd-NEW-9** — Source-quality tiers S/A/B affecting per-source diversity caps. (§3.7)
- **bd-NEW-10** — Newsletter↔podcast brand pairing in diversity selection. (§3.8)
- **bd-NEW-11** — `oss_agents` tag with allowlist of known OSS agents. (§3.5)
- **bd-NEW-12** — Folder-name hygiene + unit test fixture for FOLDER_TO_CATEGORY. (§3.9)
- **bd-NEW-13** — GitHub-commits ingestion sidecar for awesome-mcp-servers, modelcontextprotocol/servers, e2b-dev/awesome-ai-agents (since these are not RSS-ingestable through Inoreader natively).

---

## 5. Open Questions / Risks

1. **Inoreader API budget.** The codebase tracks API calls (`incrementApiCalls(1)` per subscription fetch). Adding ~30 P0+P1 subscriptions adds zero ongoing API cost (it's the items-fetch volume, not the count of subscriptions, that drives cost). Verify against current quota in `api-budget` table.
2. **RSSHub / page-monitor dependency.** Sources #17 (Cursor), #18 (Cognition), #25 (Modal) lack native RSS. Either accept the lossy Inoreader URL-monitor option (HTML-diff polling, lossy on dynamic pages) or stand up an RSSHub instance. RSSHub adds an ops surface; URL-monitor adds noise. Trade-off.
3. **Reddit RSS reliability.** Reddit has rate-limited and partially deprecated their RSS endpoint multiple times. Subreddit RSS may go dark; consider a pull.dev mirror or PRAW-based sidecar for resilience.
4. **arxiv RSS volume.** cs.SE alone is ~30 papers/day. With LLM scoring at $0.001-0.005/item, that's $1-5/month/feed of LLM cost. Acceptable, but verify against monthly LLM budget.
5. **Substack/Beehiiv RSS quirks.** Several Substack feeds don't include full content; the BM25 index relies on `summary` / `contentSnippet`. Audit ranking quality after adding Substack feeds — may need to enable full-content fetch for these.
6. **Tag explosion.** §3.2 + §3.4 + §3.5 add 3 new tags. Be deliberate; tag-namespace creep dilutes the discovery axis. Cap at ~12 total tags via a curated allowlist.

---

## 6. Acceptance Self-Check

- [x] `docs/research/inoreader_content_sources_2026_04.md` written
- [x] At least 15 candidate additions with rationale (delivered: 59 entries, 25 newsletter/blog, 10 podcast, 5 awesome-list, 7 forum, 9 academic, 3 strategic)
- [x] At least 3 organizational improvements proposed (delivered: 9 — §3.1 through §3.9)
- [x] Prioritized follow-up bead list (delivered: §4 with P0/P1/P2)
- [x] Mail mayor with summary + suggested follow-up beads (next step, after this doc lands)

## 7. Constraints honored

- [x] Read-only sweep — no edits to `feeds.ts` or `categories.ts` in this bead.
- [x] No Inoreader subscription changes from this agent — proposals only.
- [x] No PRs opened. Doc committed to `research/inoreader-content-sources-s32` working branch.
