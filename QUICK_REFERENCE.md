# Phase 6 Quick Reference

**Status**: Planning Complete ✅  
**Start**: Phase 6A (Search Fix + Daily Period)  
**Timeline**: 3-day sprint (18-24 hours)

---

## Beads at a Glance

```
P1 - CRITICAL
├─ code-intel-digest-71d  : Search ranking fix      [4-6h]  ← START HERE
├─ code-intel-digest-lv2  : Embeddings setup        [6-8h]  (parallel)
└─ code-intel-digest-hj4  : QA answer generation    [5-7h]  (after lv2)

P2 - IMPORTANT
├─ code-intel-digest-7jb  : List format UI          [3-4h]
└─ code-intel-digest-byv  : Digest page             [4-5h]  (after 7jb)

P3 - SUPPORTING
└─ code-intel-digest-hv1  : Daily period            [2-3h]
```

---

## Features Overview

### 1. Search Fix (71d) - The Problem
```
Query: "code search"
WRONG: Anthropic/Bun story ranked #1 ❌
RIGHT: Code Search with Trigrams ranked #1 ✅

Root Cause: Semantic weight too low (0.2)
Solution: Increase to 0.5 + deduplication
```

### 2. Embeddings (lv2) - The Infrastructure
```
When: During daily sync (1x per day)
What: Generate 768-dim vectors for items
Store: SQLite BLOB field
Cost: $0.004/day for 1000 items
Use: Fast semantic search + QA retrieval
```

### 3. QA System (hj4) - The Intelligence
```
User: "How do agents handle context?"
System:
  1. Retrieve top-5 relevant items
  2. Pass to Claude with context
  3. Generate answer with sources
  4. Return answer + links
Cost: $0.003/answer
```

### 4. List Format (7jb) - The UI
```
BEFORE: 2-column card grid
AFTER:  Vertical ranked list (1-10)

Format: 1. [8.5] Title - Source | Tags | Date
Better: Scannable, shows ranking clearly
```

### 5. Daily Period (hv1) - The Option
```
Add: "Daily" button (1-day window)
Where: Digest, Search, QA tabs + APIs
Logic: 24h period, 1/source cap, 12h half-life
Use: Stay current with today's top items
```

### 6. Digest Page (byv) - The Summary
```
New Page: /digest?period=week
Shows:
  - AI summary (200-300 words)
  - Top 3-5 items per category
  - Key themes extracted
Cost: $0.006/digest
```

---

## Implementation Roadmap

### Day 1: Foundation (6 hours)
```
Morning (3h):
  ✅ Start 71d - Search ranking fix
     - Add debug logging
     - Verify embeddings
     - Increase boost weight
  ✅ Complete hv1 - Daily period
     - Add 1 day option
     - Update all APIs
     - Test everywhere

Afternoon (3h):
  ✅ Start 7jb - List format
     - Change grid → list
     - Update components
     - Test responsive
  ✅ Start lv2 - Embeddings
     - Create table
     - Add generate function
```

### Day 2: Features (6 hours)
```
Morning (3h):
  ✅ Finish 7jb - List format
     - Polish styling
     - Add tests
     - Verify mobile
  ✅ Finish lv2 - Embeddings
     - Complete retrieval
     - Test caching
     - Verify performance

Afternoon (3h):
  ✅ Work on hj4 - QA system
     - Answer generation
     - Source attribution
     - Cost verification
```

### Day 3: Integration (6 hours)
```
Morning (3h):
  ✅ Finish hj4 - QA system
     - API endpoint
     - Tests
     - Quality checks
  ✅ Start byv - Digest page
     - Create components
     - API endpoint

Afternoon (3h):
  ✅ Finish byv - Digest page
     - Theme extraction
     - Summary generation
  ✅ Final testing & fixes
     - Quality gates
     - Regression tests
     - Deploy preparation
```

---

## Key Files (By Task)

### Search Fix (71d)
- `src/lib/pipeline/search.ts` - Increase boost weight
- `src/lib/pipeline/select.ts` - Add URL dedup
- Tests: `tests/search-quality.test.ts`

### Daily Period (hv1)
- `app/page.tsx` - Add button
- `src/components/feeds/items-grid.tsx` - Type update
- `src/components/search/search-box.tsx` - Dropdown
- `src/components/qa/ask-box.tsx` - Dropdown
- `app/api/items/route.ts` - PERIOD_DAYS mapping
- `app/api/search/route.ts` - Daily support

### List Format (7jb)
- `src/components/feeds/items-grid.tsx` - Rewrite layout
- `src/components/feeds/item-card.tsx` - New list-item component
- `app/page.tsx` - Layout adjustments
- Tests: `tests/ui-list-format.test.ts`

### Embeddings (lv2)
- `src/lib/embeddings/generate.ts` - NEW
- `src/lib/embeddings/index.ts` - NEW
- `src/lib/db/embeddings.ts` - NEW
- `src/lib/db/index.ts` - Schema update
- Tests: `tests/embeddings.test.ts`

### QA Answers (hj4)
- `src/lib/pipeline/retrieval.ts` - NEW
- `src/lib/pipeline/answer.ts` - NEW
- `app/api/ask/route.ts` - Updated
- Tests: `tests/qa-system.test.ts`

### Digest Page (byv)
- `src/components/digest/digest-page.tsx` - NEW
- `src/components/digest/digest-summary.tsx` - NEW
- `src/components/digest/digest-highlights.tsx` - NEW
- `src/components/digest/digest-trends.tsx` - NEW
- `app/api/digest/route.ts` - NEW
- Tests: `tests/digest-page.test.ts`

---

## Commands to Know

### Build & Test
```bash
npm run build         # Build check
npm run lint          # Lint check
npm run typecheck     # Type check (strict)
npm test              # Run tests
npm run test -- --run # Run tests once (not watch)
```

### Database
```bash
sqlite3 .data/digest.db ".schema"  # View schema
sqlite3 .data/digest.db "SELECT COUNT(*) FROM items;"
```

### Beads
```bash
bd update <id> --status in_progress      # Start work
bd close <id> --reason "Completed"       # Finish
bd create "..." -t feature -p 1 --json    # New bead
```

---

## Common Pitfalls & Fixes

| Issue | Fix |
|-------|-----|
| TypeScript errors | Run `npm run typecheck` before commit |
| Embedding size mismatch | Verify 768 dims, not 1536 |
| Search still ranking wrong | Check boost weight (should be 0.5) |
| List format broken on mobile | Use flex, not grid; test in DevTools |
| Daily period not saving | Verify API endpoint mapping |
| QA too slow | Check embedding caching, use Haiku not 4o |
| Tests failing | Run `npm test -- --run`, check logs |

---

## Quick Wins (Priority Order)

1. ✅ **Daily period** (2-3h) - Quick, unblocks digest
2. ✅ **Search fix** (4-6h) - High impact, fixes UX issue
3. ✅ **List format** (3-4h) - Visual improvement, tests digest design
4. ✅ **Embeddings** (6-8h) - Infrastructure, enables QA
5. ✅ **QA answers** (5-7h) - Feature-complete, uses embeddings
6. ✅ **Digest page** (4-5h) - Recap, uses everything

---

## Testing Checklist

- [ ] Search 'code search' - hacker news first?
- [ ] Daily button appears in UI
- [ ] Daily API works for all endpoints
- [ ] List shows numbered 1-10
- [ ] List responsive on mobile
- [ ] Embedding generation <1s per batch
- [ ] Embedding retrieval <100ms for 1000 items
- [ ] QA generates coherent answer
- [ ] QA sources are relevant
- [ ] Digest page loads
- [ ] Digest summary is insightful
- [ ] No TypeScript errors
- [ ] No ESLint errors
- [ ] All tests passing
- [ ] Phase 1-5 features still work

---

## Success Metrics

```
Search Quality:      'code search' → correct ranking ✓
UI Format:           List shows 1-10 ranking ✓
Daily Period:        Available everywhere ✓
QA System:           Answers + sources working ✓
Digest Page:         Summary + highlights loading ✓
Code Quality:        0 TypeScript errors ✓
Code Quality:        0 ESLint errors ✓
Tests:               All passing ✓
Cost:                <$50/month ✓
Performance:         API <600ms search, <4s QA ✓
```

---

## Cost Summary

| Component | Cost | Frequency |
|-----------|------|-----------|
| Embeddings | $1.50/year | Daily sync |
| QA answers | $5.50/year | Per question |
| Digest summaries | $2.20/year | Daily |
| **Total New** | **$9.20/year** | - |
| Total (Phase 5) | $36/year | - |
| **Grand Total** | **$45/year** | All users |

---

## Documentation Map

```
PHASE6_PLAN.md
  └─ Overview of all features
  
PHASE6_ARCHITECTURE.md
  └─ Technical design + data flows
  
PHASE6_BEADS.md
  └─ Task specs + dependencies
  
SEARCH_QUALITY_ANALYSIS.md
  └─ Root cause + investigation plan
  
PHASE6_SUMMARY.md
  └─ Executive summary
  
SESSION_PHASE6_PLANNING.md
  └─ This session notes
  
QUICK_REFERENCE.md (← you are here)
  └─ Quick lookup for implementation
```

---

## Phase 6A Launch Checklist

- [ ] All beads visible in `bd list`
- [ ] PHASE6_PLAN.md reviewed
- [ ] PHASE6_ARCHITECTURE.md reviewed
- [ ] Search issue understood (71d)
- [ ] Daily period spec clear (hv1)
- [ ] Database prepared for embeddings
- [ ] Tests written for search fix
- [ ] Ready to start 71d

---

**Created**: December 7, 2025  
**Phase**: 6 of 7  
**Status**: ✅ Ready to Go  

**Start**: `code-intel-digest-71d` - Search Ranking Fix
