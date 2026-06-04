---
name: distill-digest
description: "Weekly share-ready digest from the code-intel-digest mirror, formatted for Stephanie to paste/forward to internal team Slack/email or use as sales enablement / competitive intel. Output is polished enough to ship with light editing. For personal catch-up, use orient-digest instead. Requires the code-intel-copilot MCP server."
allowed-tools: mcp__code-intel-copilot__search_items, mcp__code-intel-copilot__semantic_search_items, mcp__code-intel-copilot__get_item, mcp__code-intel-copilot__aggregate_items, mcp__code-intel-copilot__mirror_status, Read, Write, AskUserQuestion
---

# Distill Digest

Share-ready weekly digest. Stephanie will re-package this into internal Slack/email or sales enablement / competitive intel. Output should be polished enough that she can paste-and-send with light editing.

## Always do first

1. Call `mirror_status` exactly once and check `dbMode`. In `direct` mode the server reads the **live production database** (real-time) — note "Data: live production (real-time)" at the top. In `mirror` mode, if `staleMinutes > 90` warn and ask before continuing; otherwise note freshness in one line ("Data through <lastSyncedAt>").
2. Ask via `AskUserQuestion` which mode she wants this week:
   - **Team update** — for internal Slack/email. Casual but substantive. Light analysis, 3-4 themes, "what this means for us" callouts where relevant.
   - **Competitive intel / sales enablement** — for GTM. Buyer signals, competitor moves, objection-handling ammo. Cites third-party data, not internal takes.
   - Let her override with "both" (produce two files) or free-text.
3. Then ask for lens/prioritization — 3-4 options from the watchlist plus "let the data pick". Skip if her prompt already specifies a lens.

## Defaults

- **Time window:** rolling 7 days. Only deviate if she asks.
- **Format:** themed sections with synthesis paragraphs.
  - 3-5 themes, each introduced by a 2-4 sentence synthesis that stands alone (someone reading only the synthesis should get the point).
  - 3-6 items per theme, each with a 1-sentence "why it matters" after the link.
  - End with "**Bets worth making this week**" — 2-3 concrete actions tied to items above.
- **Length:** ~600-900 words. Long enough to be substantive, short enough to skim.
- **Output:** write to `out/distill-YYYY-MM-DD-<mode>.md` and print a summary + file path inline. This lets her grep/version and copy cleanly.

## Watchlist (boost when ranking)

1. Competitive AI-coding-tool market — Cursor, Copilot, Claude Code, Codex, Windsurf, Augment, CodeRabbit, Cognition/Devin, GitLab Duo. Launches, market-share data, pricing, narrative shifts.
2. Enterprise AI rollouts & case studies — named-company posts about internal platforms, adoption numbers, ROI claims.
3. Code context / codebase understanding / SCIP / MCP — Sourcegraph's core thesis. Agent context, repo-level tools, cross-repo intelligence.

## De-prioritize

- Reddit / community venting posts unless they represent a clear buyer-sentiment shift worth flagging to sales.

## Mode-specific tone

### Team update mode
- Voice: colleague sharing what they noticed. First-person-plural OK ("worth watching", "I'd keep an eye on").
- Include at least one "what this means for us" line per theme where there's a clear tie-in to Sourcegraph's products (Deep Search, Code Search, MCP Server, Batch Changes, Code Insights, Code Monitoring). Don't force it when the link is weak.
- Keep it forwardable — no inside-baseball that would confuse someone outside your group.

### Competitive intel / sales enablement mode
- Voice: third-party reporter. Keep internal opinion out of the body; put strategic takes in a clearly marked "**Implications for GTM**" section per theme.
- Each item should map cleanly to one of: buyer signal, competitor move, objection-handling data point, case study to cite.
- End with a short "**Talk tracks**" section — 2-3 one-line hooks sales can use verbatim in calls this week.

## Core principles

- Every claim backed by URLs. Multiple URLs strengthen a claim; one URL = "one item says X" (be honest about it).
- Respect `avgFinalScore` from `aggregate_items` when ranking.
- Prefer named-company primary sources (Cloudflare blog > TLDR roundup of Cloudflare blog).
- Dates: ISO `since=YYYY-MM-DD` for the 7-day window.
- No enumeration of raw tool output.

## Recipe

1. `mirror_status`.
2. Ask for mode (team update vs competitive intel).
3. Ask for lens unless specified.
4. Gather candidates:
   - `search_items(since=<7d>, limit=60)` — general sweep.
   - For each watchlist pillar the user prioritized: 1-2 `semantic_search_items` queries (limit 15 each) with varied phrasing.
   - `aggregate_items(group_by='source', since=<7d>, limit=15)` — see who's driving coverage.
5. For top 3-8 candidate items, call `get_item` to pull real quotes/numbers. Share-ready content needs real substance, not summary-of-summary.
6. Cluster into 3-5 themes. Drop themes with < 3 items; promote singleton outliers into a "**One more thing**" mini-section if worth flagging.
7. Write the digest to `out/distill-YYYY-MM-DD-<mode>.md`. Create the `out/` directory if it doesn't exist.
8. Print inline: a 3-5 bullet summary of the themes, plus the file path.

## Guardrails

- Don't speculate about unreleased Sourcegraph product direction in share-ready output. If you want to flag an opportunity, put it in a separate "**Private notes (don't forward)**" section.
- Sourcegraph and Amp are separate companies. Don't reference Amp as a Sourcegraph product in any share-ready content.
- If the mirror has nothing substantive in a watchlist pillar this week, say so directly rather than padding with weak items.
- The exec-brief audience was explicitly out-of-scope this round. If she asks for one, either add a mode here or point at `digest-insights` with specific instructions.
