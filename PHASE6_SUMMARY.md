# Phase 6: Task Planning Summary

**Date**: December 7, 2025  
**Status**: ✅ Planning Complete - Ready for Execution  
**Phase**: 6 of 7 (Estimated 60% of project completion)

---

## Overview

Task analysis and planning complete for Phase 6. System now has:

✅ **Phase 1-5**: Complete ranking pipeline + UI integration + cost optimization
🔄 **Phase 6**: Now planned - 5 features, 6 beads, 18-24 hours work
📋 **Phase 7**: Deployment (for next phase)

---

## New Requirements & Beads Created

### 1. Search Ranking Quality Issue (P1 - Bug)
**Bead**: `code-intel-digest-71d`  
**Issue**: 'code search' query returns anthropic/bun story ranked higher than hacker news trigram (exact match)  
**Root Cause**: Likely hybrid score blending weight (0.2) too low, or embedding similarity not strong enough vs. LLM scores

**Solution Path**:
1. Add debug logging to search ranking
2. Verify embedding similarities (should be 0.95+ for exact match)
3. Increase semantic boost weight from 0.2 → 0.5 for search mode
4. Add URL-based deduplication to prevent duplicates
5. Test and verify ranking improved

**Effort**: 4-6 hours

---

### 2. Embeddings-Based Retrieval System (P1 - Infrastructure)
**Bead**: `code-intel-digest-lv2`  
**Goal**: Foundation for LLM-based QA - vector storage and semantic search

**Components**:
- `src/lib/embeddings/generate.ts` - Batch embedding generation
- `src/lib/embeddings/index.ts` - Vector operations (cosine similarity)
- `src/lib/db/embeddings.ts` - SQLite BLOB storage/retrieval
- `src/lib/pipeline/retrieval.ts` - Top-K semantic search

**Database**: Add embeddings table with item_id, embedding (BLOB), model, created_at

**Cost Optimization**:
- Generate embeddings once during daily sync
- Cache all embeddings in database
- Retrieve via cosine similarity (in-memory, instant)
- <$0.0001 per embedding (very cheap)

**Effort**: 6-8 hours

---

### 3. LLM Answer Generation (P1 - Feature)
**Bead**: `code-intel-digest-hj4`  
**Goal**: Generate coherent answers to user questions with proper source attribution

**Architecture**:
```
Question + Period + Category
  ↓
Load items from database (period-filtered)
  ↓
Semantic retrieval (top-5 items via embeddings)
  ↓
Rank retrieved items (hybrid scoring)
  ↓
Generate answer with Claude (context: top items)
  ↓
Return answer + sources + metadata
```

**Endpoint**: `GET /api/ask?question=...&period=...&category=...`

**Cost**: ~$0.001-$0.01 per answer (using Claude Haiku)

**Key**: Answers must cite sources properly and balance retrieval quality with generation

**Effort**: 5-7 hours

---

### 4. Ranked List UI Format (P2 - Feature)
**Bead**: `code-intel-digest-7jb`  
**Change**: Card grid (1-2 columns) → Numbered list (1-10 items)

**Benefits**:
- Better scannability
- Matches user expectations for ranked results
- Shows ranking numbers
- Compact, vertical format

**New Item Format**:
```
1. [8.5] Article Title
   Source · Tags | Relevance: 9/10 | 2 days ago
```

**Components Modified**:
- `src/components/feeds/items-grid.tsx`
- `src/components/feeds/item-card.tsx` → `item-list-row.tsx`
- Responsive design maintained

**Effort**: 3-4 hours

---

### 5. Daily Time Period (P3 - Enhancement)
**Bead**: `code-intel-digest-hv1`  
**Feature**: Add "Daily" (1-day/24-hour) option alongside Week/Month/All-time

**Where It Appears**:
- Main digest tab (buttons)
- Search tab (dropdown)
- QA tab (dropdown)
- All API endpoints

**Configuration Changes**:
```typescript
// Period mapping
const PERIOD_DAYS = { day: 1, week: 7, month: 30, all: 90 };

// Per-source diversity caps
const perSourceCaps = { day: 1, week: 2, month: 3, all: 4 };

// Recency half-life
const halfLifeMultipliers = { day: 0.5, week: 1.0, month: 1.0, all: 1.0 };
```

**Effort**: 2-3 hours

---

### 6. Content Digest Page (P2 - Feature)
**Bead**: `code-intel-digest-byv`  
**New Page**: `/digest` - Shows highlights and AI summary

**Features**:
- AI-generated summary of top content (200-300 words)
- Highlighted articles (top 3-5 per category)
- Identified themes and trends
- Quick links to full category digests

**Data Structure**:
```json
{
  "period": "week",
  "dateRange": { "start": "...", "end": "..." },
  "summary": "AI-generated narrative...",
  "themes": ["semantic search", "agents", "context"],
  "highlights": {
    "newsletters": [...],
    "ai_news": [...],
    ...
  }
}
```

**Effort**: 4-5 hours

---

## Implementation Plan

### Critical Path Analysis

```
Parallel Path 1 (Search + UI):
  ├─ 71d: Search fix (4-6h)
  ├─ hv1: Daily period (2-3h)
  └─ 7jb: List format (3-4h)
      └─ byv: Digest page (4-5h)
  Total: 13-18 hours

Parallel Path 2 (Embeddings + QA):
  ├─ lv2: Embeddings setup (6-8h)
  └─ hj4: Answer generation (5-7h)
  Total: 11-15 hours

Overall: 18-24 hours (can run in parallel)
```

### Recommended Execution (3-Day Sprint)

**Day 1 (6h)**:
- Morning: Start `code-intel-digest-71d` (search fix)
- Morning: Complete `code-intel-digest-hv1` (daily period)
- Afternoon: Start `code-intel-digest-7jb` (UI list format)
- Afternoon: Start `code-intel-digest-lv2` (embeddings) in parallel

**Day 2 (6h)**:
- Morning: Finish `code-intel-digest-7jb` (UI)
- Finish `code-intel-digest-lv2` (embeddings)
- Afternoon: Work on `code-intel-digest-hj4` (QA answers)

**Day 3 (6h)**:
- Morning: Finish `code-intel-digest-hj4` (QA)
- Afternoon: Complete `code-intel-digest-byv` (digest page)
- Testing, bug fixes, quality gates

---

## Quality Gates

All phases must pass:

- [ ] TypeScript strict mode: 0 errors
- [ ] ESLint: 0 errors
- [ ] Search quality test: 'code search' → correct ranking
- [ ] Daily period: works in all tabs
- [ ] List format: responsive on mobile/desktop
- [ ] Embeddings: generating and caching correctly
- [ ] QA answers: coherent, sourced, cost <$0.01
- [ ] Digest page: loads, displays, summarizes
- [ ] No regressions: all Phase 1-5 functionality still works
- [ ] Database: no errors, migration-safe

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Search fix breaks other queries | Medium | Medium | Comprehensive testing, revert strategy |
| Embedding generation too slow | Low | High | Batch during sync only, cache aggressively |
| QA answers too expensive | Low | High | Use cheaper models (Haiku), limit calls |
| List format breaks mobile | Low | Medium | Mobile-first design, test on device |
| Vector similarity not differentiating | Medium | Medium | Debug embeddings quality, tune weights |

---

## Success Criteria

### By End of Phase 6

✅ Search ranking fixed - 'code search' query works correctly  
✅ UI displays as ranked list with 10 items per category  
✅ Daily period available in all tabs  
✅ QA system generates answers with sources  
✅ Digest page provides summary and highlights  
✅ All quality gates passing  
✅ Zero TypeScript/ESLint errors  
✅ Tests comprehensive and passing  

### System Capabilities

- **Search**: Semantic + BM25 hybrid, ranked correctly
- **Browse**: 3+ time periods, ranked list format
- **Ask**: LLM answers with sources, <$0.01 cost
- **Digest**: Summary + highlights, AI-generated
- **Architecture**: Embeddings-based, cost-optimized

---

## Files Created This Session

1. `PHASE6_PLAN.md` - Complete feature breakdown and architecture
2. `SEARCH_QUALITY_ANALYSIS.md` - Root cause analysis of search issue
3. `PHASE6_BEADS.md` - Task registry with dependencies
4. `PHASE6_SUMMARY.md` - This document

## Beads Created

| Bead ID | Title | Priority | Effort | Status |
|---------|-------|----------|--------|--------|
| code-intel-digest-71d | Search ranking fix | P1 | 4-6h | Created ✅ |
| code-intel-digest-lv2 | Embeddings setup | P1 | 6-8h | Created ✅ |
| code-intel-digest-hj4 | QA answer generation | P1 | 5-7h | Created ✅ |
| code-intel-digest-7jb | List format UI | P2 | 3-4h | Created ✅ |
| code-intel-digest-byv | Digest page | P2 | 4-5h | Created ✅ |
| code-intel-digest-hv1 | Daily period | P3 | 2-3h | Created ✅ |

---

## Next Steps

1. ✅ Planning complete - all beads created
2. 🔄 Ready to start Phase 6A (search fix + daily period)
3. 📋 Follow execution plan (3-day sprint)
4. ✅ Quality gates before each merge
5. 📊 Track progress in beads

---

## Related Documentation

- `PHASE6_PLAN.md` - Architecture and feature details
- `SEARCH_QUALITY_ANALYSIS.md` - Search investigation plan
- `PHASE6_BEADS.md` - Full bead registry
- `LANDING_PHASE5.md` - Previous phase summary
- `COST_OPTIMIZATION.md` - Pre-computed scoring approach

---

**Created**: December 7, 2025 19:00 UTC  
**Status**: ✅ READY FOR PHASE 6A  
**Next Action**: Start `code-intel-digest-71d` (search ranking fix)
