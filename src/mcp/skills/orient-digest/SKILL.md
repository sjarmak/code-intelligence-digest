---
name: orient-digest
description: "Weekly personal orientation digest for Stephanie over the code-intel-digest mirror. Use when she wants to catch up on the last ~7 days of AI/dev/research news for herself (not to share). Signal-dense, terse, assumes Stephanie-level context. For share-ready output, use distill-digest instead. Requires the code-intel-copilot MCP server."
allowed-tools: mcp__code-intel-copilot__search_items, mcp__code-intel-copilot__semantic_search_items, mcp__code-intel-copilot__get_item, mcp__code-intel-copilot__aggregate_items, mcp__code-intel-copilot__mirror_status, Read, Write, AskUserQuestion
---

# Orient Digest

Personal situational-awareness digest. Audience: **Stephanie only**. She already knows the landscape — this is catch-up, not onboarding. Skip explanations of things she obviously knows (what Cursor is, what MCP is, what SCIP stands for).

## Always do first

1. Call `mirror_status` exactly once and check `dbMode`. In `direct` mode the server reads the **live production database** (real-time) — note "Data: live production (real-time)" at the top. In `mirror` mode, if `staleMinutes > 90` warn and ask before continuing; otherwise note freshness in one line ("Data through <lastSyncedAt>").
2. Ask for a lens/prioritization once via `AskUserQuestion` — offer 3-4 options drawn from the default watchlist (below) plus "let the data pick". Skip this step if she already specified one in her prompt.

## Defaults

- **Time window:** rolling 7 days (`since = today - 7d` as ISO date). Only deviate if she asks.
- **Format:** themed sections. For each theme: 1-2 sentence synthesis, then 2-5 items as a tight bulleted list (`- [title](url) — one clause why-it-matters`). 3-6 themes total.
- **Length:** short. ~300-500 words total. She's orienting, not studying.
- **Output:** inline (no file write unless she asks).

## Watchlist (boost when ranking)

1. Competitive AI-coding-tool market — Cursor, Copilot, Claude Code, Codex, Windsurf, Augment, CodeRabbit, Cognition/Devin, GitLab Duo. Launches, market-share data, pricing, narrative shifts.
2. Enterprise AI rollouts & case studies — named-company posts about internal platforms, adoption numbers, ROI claims (Cloudflare, Meta, Intercom, Atlassian, etc.).
3. Code context / codebase understanding / SCIP / MCP — the core Sourcegraph thesis. Anything about agent context, repo-level tools, long-context code navigation, cross-repo intelligence.

## De-prioritize

- Reddit / community venting posts. Keep only if they show a clear buyer-sentiment shift (e.g., multiple threads on the same pain point, or someone canceling a subscription and explaining why in detail). Skip anecdote-only threads.

## Core principles

- Cite URL inline for every item mentioned. No bare titles.
- Don't overclaim. "3 items discussing X" ≠ "the industry is doing X".
- Respect `avgFinalScore` from `aggregate_items` — higher = more useful-to-Stephanie signal.
- Dates: prefer `since=YYYY-MM-DD` as ISO (7 days before today).
- No enumeration. Summarize, group, synthesize.
- **No hand-holding.** No "what is MCP?" explanations. No "this means Sourcegraph should consider..." framings. Just the signal.

## Recipe

1. `mirror_status`.
2. Ask for lens unless prompt specifies one.
3. Gather candidates:
   - `search_items(since=<7d>, limit=50)` — general sweep.
   - `aggregate_items(group_by='source', since=<7d>, limit=15)` — see who's active.
   - For each watchlist pillar she prioritized, run a targeted `semantic_search_items` query (limit 10-15 each).
4. De-dup by `id`. Drop anything matching the de-prioritize list unless it's flagged as buyer-sentiment shift.
5. Cluster into 3-6 themes by what's actually strong this week (not a forced template).
6. For each theme: 1-sentence synthesis + 2-5 items.
7. End with "**What I'd watch next week**" — 1-3 specific signals to check on.

## Guardrails

- Don't write Sourcegraph-GTM angles here — that's distill-digest's job. This is for Stephanie orienting.
- If a theme only has 1 item, either promote it to a standalone callout or drop it. No themes-of-one.
- Sourcegraph and Amp are separate companies; treat Amp as a competitor, not a Sourcegraph product.
- If 0 items match the lens she picked, say so directly and offer a fallback lens.
