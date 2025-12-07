# Ranking Pipeline Status

**Last Updated**: December 7, 2025  
**Progress**: ████████████████ 66% (2 of 3 components complete)

## Completion Status

### ✅ Phase 1: BM25 Ranking (Complete)
- **Bead**: code-intel-digest-9gx ✅
- **Files**: src/lib/pipeline/bm25.ts (315 lines)
- **Items Scored**: 8,058 / 8,058 (100%)
- **Status**: Stored in item_scores.bm25_score

**Results**:
- 8 domain term categories with weights (Code Search 1.6x to SDLC 1.0x)
- Per-category BM25 queries from AGENTS.md
- Scores normalized to [0, 1]
- Average score: 9.3%, max: 100%

**Key Files**:
- `src/lib/pipeline/bm25.ts`: Core BM25Index class
- `scripts/test-bm25.ts`: Validation test
- `scripts/score-items-bm25.ts`: Batch scorer
- `scripts/verify-bm25-scores.ts`: Verification

---

### ✅ Phase 2: LLM Scoring (Complete)
- **Bead**: code-intel-digest-06q ✅
- **Files**: src/lib/pipeline/llmScore.ts (370 lines)
- **Items Scored**: 8,058 / 8,058 (100%)
- **Status**: Stored in item_scores.llm_relevance/usefulness/tags

**Results**:
- OpenAI GPT-4o integration ready for production
- Fallback heuristic scoring for offline mode
- 10 domain tags for categorization
- Average relevance: 5.3/10, usefulness: 5.9/10

**Key Features**:
- Lazy-initialized OpenAI client
- Batch processing (30 items/call recommended)
- JSON parsing with markdown fallback
- Detailed error handling and logging
- Zero-cost fallback mode

**Key Files**:
- `src/lib/pipeline/llmScore.ts`: Core LLM scorer
- `scripts/test-llm-score.ts`: Sample testing
- `scripts/score-items-llm.ts`: Batch scorer
- `scripts/verify-llm-scores.ts`: Verification

---

### ⏳ Phase 3: Hybrid Ranking (In Progress)
- **Bead**: code-intel-digest-phj (Not started)
- **Files**: src/lib/pipeline/rank.ts (exists, needs updates)
- **Target**: Generate finalScore combining all three components

**What Needs to Be Done**:

1. **Update rank.ts rankCategory() function**:
   - Load items and filter by time window ✅ (already done)
   - Build BM25 index and score ✅ (partially done)
   - Score with LLM ✅ (partially done)
   - **TODO**: Combine BM25 + LLM + recency into finalScore
   - **TODO**: Apply boost factors (1.0-1.5x) for multi-domain matches
   - **TODO**: Apply penalties for off-topic items
   - **TODO**: Sort and filter by minRelevance threshold

2. **Implement ranking formula**:
   ```
   llmRaw = 0.7 * relevance + 0.3 * usefulness  // Already have this
   llmScore_norm = normalize(llmRaw) to [0, 1]  // Needed
   bm25Score_norm = already have [0, 1]         // ✅
   recencyScore = exponential decay per category // Needed
   
   finalScore = 
     (llmScore_norm * weight.llm) +
     (bm25Score_norm * weight.bm25) +
     (recencyScore * weight.recency)
   
   // Apply boost if multi-domain match
   finalScore = finalScore * boostFactor(1.0-1.5)
   ```

3. **Build /api/items endpoint**:
   - GET /api/items?category=tech_articles&period=week
   - Return top-K ranked items
   - Include reasoning field
   - Format response as JSON

4. **Test merged ranking**:
   - Verify final scores are in [0, 1] range
   - Check that high-scored items are actually good
   - Spot-check 10-20 items per category

---

### ⏳ Phase 4: Diversity & Selection (Not Started)
- **Bead**: code-intel-digest-8hc (Not started)
- **Files**: src/lib/pipeline/select.ts (exists)

**What's Needed**:
- Cap sources per category (max 2-3 per source)
- Greedy selection from ranked items
- Return digestSelections table updates
- Per-source tracking

---

### ⏳ Phase 5: UI Components (Not Started)
- **Bead**: code-intel-digest-htm (Not started)
- **Files**: app/components/* (needs creation)

**What's Needed**:
- ItemCard component
- Category tabs
- Period selector (weekly/monthly)
- Items grid layout
- shadcn components integration

---

## Database State

### item_scores Table
Currently populated with:
- ✅ `bm25_score`: 8,058 items (BM25 scores 0-1)
- ✅ `llm_relevance`: 8,058 items (0-10 scale)
- ✅ `llm_usefulness`: 8,058 items (0-10 scale)
- ✅ `llm_tags`: 8,058 items (JSON array)
- ⏳ `recency_score`: Placeholder 0.5 (needs real calculation)
- ⏳ `final_score`: Placeholder = bm25_score (needs calculation)
- ⏳ `reasoning`: NULL (needs population)

### digestSelections Table
- Empty (populated after diversity selection)

---

## Quick Reference: What to Do Next

### Session: Merge Scoring (code-intel-digest-phj)

**Goal**: Combine BM25 + LLM + recency into finalScore for all items

**Steps**:
1. In rank.ts `rankCategory()`:
   - Compute recencyScore using exponential decay
   - Normalize LLM score (raw 0-10) to [0, 1]
   - Use weights from getCategoryConfig()
   - Apply boost factors if multi-domain (code-search + IR + context, etc.)
   - Store in finalScore

2. Update database:
   - Populate item_scores.recency_score
   - Populate item_scores.final_score
   - Populate item_scores.reasoning with explanation

3. Create /api/items endpoint:
   ```typescript
   GET /api/items?category=tech_articles&period=week
   Response: { items: [...], totalItems: N, period: "week" }
   ```

4. Test:
   - Run: npx tsx scripts/test-ranking.ts (create this)
   - Verify top items are sensible
   - Check score distribution

**Files to Modify**:
- src/lib/pipeline/rank.ts (40-60 lines of changes)
- app/api/items/route.ts (create new, ~50 lines)
- scripts/test-ranking.ts (create new, ~80 lines)

**Estimated Time**: 1-2 hours

**Command**:
```bash
bd update code-intel-digest-phj --status in_progress
# ... implement ...
bd close code-intel-digest-phj --reason "Hybrid ranking complete"
```

---

## Testing Commands

### View Current Scores
```bash
# BM25 test
npx tsx scripts/test-bm25.ts

# LLM test (with heuristics fallback)
OPENAI_API_KEY="" npx tsx scripts/test-llm-score.ts

# Verify both stored
npx tsx scripts/verify-bm25-scores.ts
npx tsx scripts/verify-llm-scores.ts
```

### Next Session (Merge Scoring)
```bash
# After implementing merge:
npx tsx scripts/test-ranking.ts

# Check API:
curl http://localhost:3002/api/items?category=tech_articles&period=week
```

---

## Statistics

### Cached Items: 8,058 total
| Category | Count | BM25 Avg | LLM Rel Avg |
|----------|-------|----------|------------|
| research | 3,444 | 11.2% | 6.9/10 |
| community | 2,114 | 7.9% | 4.2/10 |
| tech_articles | 1,461 | 6.5% | 3.8/10 |
| product_news | 833 | 6.8% | 3.5/10 |
| newsletters | 193 | 22.4% | 7.8/10 |
| ai_news | 20 | 32.3% | 7.5/10 |
| podcasts | 16 | 14.1% | 4.8/10 |

### Weights (from categories.ts)
| Component | Default | Range |
|-----------|---------|-------|
| LLM | 0.45 | 0.4-0.5 |
| BM25 | 0.35 | 0.3-0.4 |
| Recency | 0.15-0.2 | 0.15-0.2 |
| Engagement | 0.05 | community only |

---

## Architecture Diagram

```
Cached Items (8,058)
       ↓
    ┌─────────────┐
    │ Normalize   │ ✅ Complete
    │ Categorize  │
    └──────┬──────┘
           ↓
    ┌─────────────┐
    │ BM25 Score  │ ✅ Complete (8,058 scored)
    └──────┬──────┘
           ↓
    ┌─────────────┐
    │ LLM Score   │ ✅ Complete (8,058 scored)
    │ (GPT-4o)    │
    └──────┬──────┘
           ↓
    ┌─────────────────────┐
    │ Merge Scoring ⏳     │ ← NEXT
    │ (Hybrid Ranking)    │
    │ → finalScore        │
    └──────┬──────────────┘
           ↓
    ┌─────────────┐
    │ Diversity   │ ⏳ Not started
    │ Selection   │
    └──────┬──────┘
           ↓
    ┌─────────────┐
    │ API / UI    │ ⏳ Not started
    │ Components  │
    └─────────────┘
```

---

## Notes

- All scripts use existing database at `.data/digest.db`
- No production server running (npm run dev not used)
- TypeScript strict mode: all checks passing
- ESLint: all rules passing
- Ready for merge scoring implementation
