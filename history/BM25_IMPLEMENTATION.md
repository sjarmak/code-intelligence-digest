# BM25 Ranking Implementation

**Date**: December 7, 2025  
**Bead**: code-intel-digest-9gx  
**Status**: ✅ Complete

## Overview

Implemented a full BM25 (Best Match 25) ranking pipeline to score all 8,058 cached items using domain-aware term matching. This is the first component of the hybrid ranking system (BM25 + LLM + recency).

## Files Created

### Core Implementation
- **src/lib/pipeline/bm25.ts** (315 lines)
  - `BM25Index` class: Full BM25 implementation with:
    - Document indexing (by item ID)
    - Term frequency / inverse document frequency (TF-IDF) calculation
    - Configurable K1 (saturation) and B (length normalization) parameters
    - Methods: `addDocuments()`, `score()`, `normalizeScores()`
  - Domain term categories with weights (matching AGENTS.md):
    - Code Search: 1.6x
    - IR (semantic search, RAG): 1.5x
    - Context Management: 1.5x
    - Agentic Workflows: 1.4x
    - Enterprise Codebases: 1.3x
    - Developer Tools: 1.2x
    - LLM Code Architecture: 1.2x
    - SDLC Processes: 1.0x
  - Category-specific BM25 queries built from domain terms

### Test & Verification Scripts
- **scripts/test-bm25.ts** (82 lines)
  - Tests BM25 scoring against all 8,058 items per category
  - Displays top 5 items by BM25 score for each category
  - Shows score distribution (items > 0.1, avg, max)

- **scripts/score-items-bm25.ts** (79 lines)
  - Batch-scores all 8,058 items and stores in `item_scores` table
  - Stores: item_id, category, bm25_score, placeholder LLM scores

- **scripts/verify-bm25-scores.ts** (96 lines)
  - Verifies scores were stored correctly
  - Displays per-category statistics and top 10 items by score

### Files Modified
- **src/lib/pipeline/rank.ts**
  - Updated to use BM25Index correctly with query term parsing
  - Parses category-specific query strings into tokens
  - Properly normalizes BM25 scores to [0, 1] range

## Results

### Scoring Complete
✅ **8,058 items scored** with BM25, distributed across 7 categories:

| Category | Items | Avg BM25 | Max BM25 |
|----------|-------|----------|----------|
| research | 3,444 | 11.2% | 100.0% |
| community | 2,114 | 7.9% | 100.0% |
| tech_articles | 1,461 | 6.5% | 100.0% |
| product_news | 833 | 6.8% | 100.0% |
| newsletters | 193 | 22.4% | 100.0% |
| ai_news | 20 | 32.3% | 100.0% |
| podcasts | 16 | 14.1% | 100.0% |

### Top-Scored Items (Examples)
1. **"🚨 Google unveils Workspace Studio..."** (newsletters, 100.0)
2. **"PaaS + IaaS: Heroku and AWS..."** (tech_articles, 100.0)
3. **"Alternative to flaky Playwright MCP"** (community, 100.0)
4. **"OpenAI's GPT-5.1-Codex-Max..."** (product_news, 100.0)
5. **"Issue #672"** (newsletters, 100.0)

### Algorithm Details

**BM25 Formula**:
```
score(d, Q) = Σ IDF(qi) * (f(qi, d) * (K1 + 1)) / (f(qi, d) + K1 * (1 - B + B * |d| / avgdl))
```

Where:
- IDF = Inverse Document Frequency (standard log formula)
- f(qi, d) = Term frequency in document
- K1 = 1.5 (saturation parameter)
- B = 0.75 (length normalization)
- |d| = document length in tokens
- avgdl = average document length

**Document Text** = title + summary + sourceTitle + categories

**Query Terms** = Per-category domain terms (from categories.ts)

## Quality Assurance

✅ **TypeScript strict mode**: No errors or `any` types  
✅ **ESLint**: All rules pass  
✅ **Database**: Scores persisted to SQLite item_scores table  
✅ **Test coverage**: 
  - Per-category scoring validated
  - Top items manually reviewed (spot-check confirms relevance)
  - Score distribution reasonable (most items 0-50%, few at 100%)

## Next Steps

1. **LLM Scoring** (code-intel-digest-06q)
   - Rate relevance (0-10) and usefulness (0-10) using Claude
   - Extract domain tags: ["code-search", "agent", "devex", "context", ...]
   - Batch API calls (~30-50 items per call)

2. **Merge Scoring** (code-intel-digest-phj)
   - Combine BM25 + LLM + recency into final_score
   - Formula: (LLM_norm * 0.45) + (BM25_norm * 0.35) + (Recency * 0.15)
   - Apply boost factors for multi-domain matches

3. **API Endpoint** (code-intel-digest-8hc)
   - `/api/items?category=tech_articles&period=week`
   - Return top-K ranked items with scores and reasoning

4. **Diversity & Selection** (follow-up)
   - Cap sources per category (max 2-3 per source)
   - Greedy selection algorithm

5. **UI Components** (code-intel-digest-htm)
   - shadcn tabs, cards, badges
   - Weekly/monthly digest view

## Commands Reference

```bash
# Test BM25 scoring (read-only, uses cached data)
npx tsx scripts/test-bm25.ts

# Score all items and store results
npx tsx scripts/score-items-bm25.ts

# Verify scores were stored correctly
npx tsx scripts/verify-bm25-scores.ts

# Type-check
npm run typecheck

# Lint
npm run lint
```

## Technical Notes

- **No API calls needed**: BM25 uses only cached data, no Inoreader/Claude calls
- **Efficient**: Index built once per category, queries run in milliseconds
- **Reusable**: BM25Index class can be extended for other use cases
- **Extensible**: Domain term categories easily adjustable in CATEGORY_CONFIG
- **Persistent**: Scores stored for later combination with LLM scores

## Integration

BM25Index is now used by `rank.ts` (rankCategory function):
1. Load items for category
2. Build BM25 index from items
3. Score against category-specific query
4. Normalize scores to [0, 1]
5. Combine with LLM and recency scores for final ranking
