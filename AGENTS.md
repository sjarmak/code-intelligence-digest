# Code Intelligence Digest Agent Workflow Guide

Quick reference for agent-specific patterns, workflows, and best practices. Detailed guides in `history/docs/`.

---

## Critical Rules

### No Development Servers
Never run `npm run dev` as an agent. Do not open ports or run background daemons.

### Root Directory is Sacred

**What belongs in root (ONLY):**
- `README.md`, `AGENTS.md`, `LICENSE`
- Essential config: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`
- Essential directories: `src/`, `app/`, `public/`, `scripts/`, `.beads/`

**What NEVER goes in root:**
- Guides & docs (TESTING.md, QUICK_REFERENCE.txt) → `history/`
- Status/progress files (STATUS.md, PROGRESS.md, LANDING_PLANE.md) → `history/`
- Planning docs (PLAN.md, DESIGN.md) → `history/`
- Session notes, fix summaries → `history/`
- JSON outputs/artifacts → `.data/` or `.cache/`

**Check before committing:**
```bash
ls -1 | grep -E "\.(md|txt)$" | grep -v -E "^(README|AGENTS|LICENSE)\.md$"
# Should return nothing
```

---

## Build & Test Commands

This is a Next.js TypeScript app.

```bash
npm install              # Install dependencies
npm run typecheck        # Type-check
npm run lint             # Lint
npm test -- --run        # Tests (use --run flag!)
npm run build            # Production build
```

**Critical:** Always use `npm test -- --run` to avoid Vitest watch mode hanging.

---

## Project Architecture

### High-Level Overview
1. **Input**: Fetch items from Inoreader (streams, feeds)
2. **Normalize**: Raw items → `FeedItem` model
3. **Categorize**: Assign to 7 categories (newsletters, podcasts, tech_articles, ai_news, product_news, community, research)
4. **Score**: Hybrid system (LLM + BM25 + recency + diversity)
5. **Rank**: Apply thresholds, per-source caps, select top-K
6. **Deliver**: JSON API + shadcn React UI

### Core Files
- `src/config/feeds.ts` - Inoreader stream → category mapping
- `src/lib/pipeline/` - Normalize, categorize, score, rank, select
- `app/api/items/route.ts` - Main `/api/items` endpoint
- `src/components/` - React UI components

**See:** `history/docs/` for detailed architecture and implementation guides.

---

## Scoring System (Hybrid: LLM + BM25 + Recency)

### Overview
Every item receives a `finalScore` combining:
- **LLM** (45%): Relevance & usefulness to devs (0-10 scale)
- **BM25** (35%): Term matching against domain vocabulary (0-1 normalized)
- **Recency** (15%): Exponential time decay (weekly half-life ≈ 3 days)
- **Engagement** (5%): Community-only (Reddit upvotes/comments)

### Default Formula
```
finalScore = (LLM_norm * 0.45) + (BM25_norm * 0.35) + (Recency * 0.15) + (Engagement * 0.05)
```

### Domain Terms (for BM25 queries)
- Code Search (1.6x)
- Information Retrieval (1.5x)
- Context Management (1.5x)
- Agentic Workflows (1.4x)
- Enterprise Codebases (1.3x)
- Developer Tools (1.2x)
- LLM Code Architecture (1.2x)
- SDLC Processes (1.0x)

**See:** `history/docs/hybrid-scoring-system.md` for full design & experiments.

---

## Issue Tracking with bd (beads)

**Use bd for ALL issue tracking. No markdown TODOs.**

### Quick Commands
```bash
bd ready                                    # Find unblocked work
bd update <id> --status in_progress         # Claim
bd close <id> --reason "Completed: ..."     # Close
bd create "Title" -t task -p 2              # Create new
```

### Priorities
- P0: Critical (security, data loss)
- P1: High (major features)
- P2: Medium (default)
- P3: Low (polish)
- P4: Backlog

### Workflow
1. `bd ready` → pick work
2. `bd update <id> --status in_progress`
3. Read requirement
4. Write test proving requirement
5. Implement to pass test
6. `npm test -- --run` to verify
7. `git commit -m "bd-<id>: ..."` with bead ID
8. `bd close` only when tests prove completion

### Key Principles
- Create specific tests for bead requirements
- Use real implementations, not mocks
- Only close when tests prove it works
- Keep `in_progress` if work remains

---

## Landing the Plane

When ending a session:

### 1. Check In-Progress Beads
```bash
bd list --json | jq '.[] | select(.status == "in_progress") | {id, title}'
```

For each: verify test exists, runs, no regressions. Close only if ALL criteria met.

### 2. File Remaining Work
```bash
bd create "Remaining task" -t task -p 2
```

### 3. Run Quality Gates
```bash
npm test -- --run
npm run lint
npm run build
```

### 4. Clean Root Directory
```bash
ls -1 | grep -E "\.(md|txt|json|sh)$" | grep -v -E "^(README|AGENTS|LICENSE|package|tsconfig|next|eslint|postcss)"
# Move any results to history/
```

### 5. Commit & Sync
```bash
git add .
git commit -m "Session close: <summary>"
git pull --rebase
```

### 6. Clean Git State
```bash
git stash clear
git remote prune origin
git status
```

### 7. Report to User
- Closed/open beads with status
- New issues filed
- Test/lint/build results
- Recommended next work prompt

---

## Key Features & Quick Start

### Daily Sync
```bash
bash scripts/run-sync.sh
# or: curl -X POST http://localhost:3002/api/admin/sync-daily
```

### ADS Libraries Integration
Requires: `ADS_API_TOKEN` in `.env.local`
```bash
npx tsx scripts/test-ads-api.ts
# Access via: http://localhost:3000/research
```

### Relevance Tuning
```bash
# Sync starred items from Inoreader
curl -X POST http://localhost:3002/api/admin/sync-starred \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"

# Get source relevance ratings
curl http://localhost:3002/api/admin/source-relevance

# Set source relevance (0-3 scale)
curl -X POST http://localhost:3002/api/admin/source-relevance \
  -H "Content-Type: application/json" \
  -d '{"streamId": "feed/https://...", "relevance": 2}'
```

---

## ACE Framework Integration

If `.ace.json` or `logs/` indicate ACE is present:

### Before Work
```bash
ace get bullets --sort-by helpful --limit 10
ace status
```

### On Failure (build/test/lint)
Capture trace with execution details.

### After Completing Task
```bash
ace learn --beads <id> --min-confidence 0.8   # MANDATORY
```

### Apply Deltas
```bash
ace apply
```

---

## Advanced Topics

**See `history/docs/` for:**
- `DAILY_SYNC_USAGE.md` - Sync API details
- `ADS_LIBRARIES_GUIDE.md` - ADS integration
- `hybrid-scoring-system.md` - Scoring design & experiments
- `NEWSLETTER_DECOMPOSITION.md` - Newsletter extraction
- `IMPLEMENTATION_GUIDE.md` - Full architecture walkthrough

---

## Code Style

- TypeScript strict mode
- Functional, pure utilities in pipeline modules
- No implicit `any`, no `// @ts-ignore` without explanation
- Small, composable functions (one responsibility per module)
- ESLint + Prettier

---

## Error Handling & Logging

### HTTP Calls
- Centralize in `src/lib/inoreader/client.ts` or `src/lib/http.ts`
- Exponential backoff for transient errors (5xx, 429, network)
- Max 3–5 retries with logging

### Structured Logging
Use `src/lib/logger.ts`:
```ts
logger.info("Event description", { metadata })
logger.warn("Retry or degraded mode", { reason })
logger.error("Hard failure", { error })
```

Never surface raw stack traces to user-facing APIs.

---

## Design Principles

1. **Minimal, focused changes** - One feature/fix per commit
2. **Adversarial review** - What could break? Test failure cases
3. **Tests per commit** - Every commit must have specific tests
4. **Clear naming** - Functions describe what they do
5. **Modular design** - Single responsibility, loose coupling
6. **Code speaks** - Avoid over-explaining in comments; name things clearly

---

## Deep Search CLI (ds)

Optional external tool for Sourcegraph Deep Search access.

Requires: `SRC_ACCESS_TOKEN` environment variable

```bash
ds start --question "Question about codebase" | jq -r '.id'
ds ask --id <id> --question "Follow-up"
ds list --first 5

# Use --async for complex, large codebase queries
ds start --question "Complex question" --async | jq -r '.id'
```

---

## Session Checklist

- [ ] Checked learned patterns: `ace get bullets --limit 10`
- [ ] Started work: `bd update <id> --status in_progress`
- [ ] Never ran `npm run dev`
- [ ] Ran tests before finishing: `npm test -- --run`
- [ ] All changes committed with bead ID
- [ ] Completed learning: `ace learn --beads <id>` (if applicable)
- [ ] Cleaned root directory (only README, AGENTS, LICENSE.md)
- [ ] Ran quality gates (build, lint, test)
- [ ] Filed remaining work in beads
- [ ] Git state clean
