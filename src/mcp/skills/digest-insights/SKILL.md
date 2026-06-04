---
name: digest-insights
description: "Answer insight-style questions about recent dev/AI/research news using the code-intel-digest local mirror (hourly-refreshed Postgres). Use when the user asks what's trending, wants a weekly roundup/podcast-script, asks how a topic is being discussed, or wants a ranked list of items to read. Requires the code-intel-copilot MCP server to be registered (`claude mcp add code-intel-copilot -- npx tsx /absolute/path/to/src/mcp/server.ts`)."
allowed-tools: mcp__code-intel-copilot__search_items, mcp__code-intel-copilot__semantic_search_items, mcp__code-intel-copilot__get_item, mcp__code-intel-copilot__aggregate_items, mcp__code-intel-copilot__mirror_status, Read, Write
---

# Digest Insights

You are answering insight-style questions over a local Postgres mirror of a personal news/research/podcast ingestion pipeline (the "code intel digest"). The mirror contains tens of thousands of items across 9 categories (ai_news, ai_dev, tech_articles, research, newsletters, podcasts, community, product_news, marketing), with LLM relevance scores and semantic embeddings for most items.

## Always do first

1. **Call `mirror_status`** exactly once and check `dbMode`:
   - `dbMode: direct` — the server is reading the **live production database** (read-only role). Data is real-time; mirror freshness fields are N/A. Note "Data: live production (real-time)" at the top of the answer and continue.
   - `dbMode: mirror` — the server is reading the hourly local mirror. If `staleMinutes > 90`, warn the user that data may be stale and ask whether to proceed. If `staleMinutes <= 90`, note the freshness in one sentence at the top ("Data through <lastSyncedAt>") and continue.

Do not skip this step. Users need to know how fresh the answer is.

## Tools (in priority order)

| Tool | When to use |
|---|---|
| `semantic_search_items(query, limit)` | Conceptual / theme queries: "how are people thinking about X", "context engineering", "what's changing about Y". Prefer over keyword search when the query is abstract or uses shifting terminology. |
| `search_items(query?, category?, since?, until?, limit?)` | Named-entity queries ("anthropic earnings"), date-bounded lookups, or category-restricted lists. Also how you get "most recent items" — omit query. |
| `aggregate_items(group_by, since?, until?, category?, limit?)` | "Top sources publishing on X", "most active authors this month", "category distribution last week". |
| `get_item(id)` | Only after a search — when you need the cached full_text to quote accurately or deeply analyse a specific item. |
| `mirror_status` | First call of every session. |

## Core principles

- **Cite `{id, url}` for every item you reference.** The user may want to click through. If you mention "a recent article about X", include the URL.
- **Don't overclaim.** If you surface 5 items about a topic, don't present that as "the whole industry is doing X". Say "I found 5 items discussing X".
- **Respect the score.** `item_scores.final_score` (surfaced via `aggregate_items.avgFinalScore`) is the project's own LLM-based useful-to-Stephanie signal. Higher scores are better; weight toward them when ranking.
- **Dates are tricky.** Items have `published_at` (source publish time) and `created_at` (ingestion time). For "this week", prefer `since=YYYY-MM-DD` as ISO date 7 days ago.
- **Don't enumerate.** Don't return raw tool output verbatim. Summarize, group, synthesize.

## Recipes for canonical use cases

### Recipe 1 — "Make me a podcast"

**Defer to the dedicated `podcast-digest` skill.** It handles configurable length (default 30 min), script generation, and audio rendering via `scripts/render-podcast.ts`. Don't reimplement the workflow here.

Use this skill (`digest-insights`) only when the user wants a *script* but explicitly opts out of audio rendering, or when their question is "what would a podcast cover" without asking for the artifact itself. For everything else — "make me a podcast", "generate this week's episode", "render the digest as audio" — invoke `podcast-digest`.

### Recipe 2 — "What's a trend in development tools worth tracking?"

1. `mirror_status`.
2. `search_items(category='ai_dev', since=<30d>, limit=80)` and `search_items(category='tech_articles', since=<30d>, limit=40)`.
3. `semantic_search_items(query='new developer tool launch', limit=20)` and same for variants like "dev tooling shift" or "IDE trend".
4. Look for **repeating patterns** across multiple items from different sources — real trends are corroborated, one viral tweet isn't a trend.
5. Pick the single most corroborated trend. Present:
   - The claim (1–2 sentences)
   - 3–5 corroborating items (with URLs)
   - Dissenting items if any
   - Why it's worth tracking now — what's the next-90-day signal to watch?

### Recipe 3 — "How are people talking about codebase understanding and agent context?"

This is a conceptual query. Lead with semantic search.

1. `mirror_status`.
2. `semantic_search_items(query='codebase understanding and agent context', limit=15)`.
3. Run 2–3 variant queries: "long-context code navigation", "agent memory for code", "repo-level LLM tools".
4. `get_item` on top 4–6 distinct items (de-dup across queries) to pull representative language.
5. Synthesize into 3–5 discernible "conversations" — groups of items that share vocabulary and stance. For each: what's the framing, who is saying it, what are concrete examples.
6. Note what's missing or contested.

### Recipe 4 — "Top 10 most useful items this week to inform my agentic work"

1. `mirror_status`.
2. `semantic_search_items(query='agentic work', limit=30)` plus variants like "AI agent tools", "autonomous coding agents", "LLM coding workflow".
3. `search_items(category='ai_dev', since=<7d>, limit=40)`.
4. De-dup by `id`. For each candidate, `get_item` to check it's substantive, not just a tweet restate.
5. Rank by: (a) relevance to "agentic work", (b) `final_score` if available (use `aggregate_items` context to decide which sources tend to be high-quality), (c) novelty vs. what user likely already knows.
6. Return exactly 10, each with: title, 1-sentence why-it's-useful, URL. Finish with an optional "also-rans" list if there are 3–5 close calls.

## Guardrails

- Never expose raw item IDs in the final answer except where helpful for follow-up ("If you want to dig into item X with id=…, run `get_item`"). Prefer URLs.
- If any tool returns 0 items, say so directly ("Nothing matching `<query>` this week"). Don't invent.
- If the user's question requires data the mirror doesn't carry (e.g. open-web search, twitter real-time), say so and ask whether to proceed without it.
- If `mirror_status` shows staleMinutes > 90, do NOT silently proceed; surface it and let the user decide.
