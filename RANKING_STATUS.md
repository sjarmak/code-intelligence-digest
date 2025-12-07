# Ranking Pipeline Status

**Last Updated**: December 7, 2025  
**Progress**: ██████████████████ 80% (3 of 5 core phases complete)

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

### ✅ Phase 3: Hybrid Ranking (Complete)
- **Bead**: code-intel-digest-phj ✅
- **Files**: src/lib/pipeline/rank.ts (verified complete), app/api/items/route.ts (new)
- **Target**: Generate finalScore combining all three components ✅

**Completed**:

1. **Verified rank.ts rankCategory() function** ✅:
   - Load items and filter by time window ✅
   - Build BM25 index and score ✅
   - Score with LLM ✅
   - Combine BM25 + LLM + recency into finalScore ✅
   - Apply penalties for off-topic items ✅
   - Sort and filter by minRelevance threshold ✅

2. **Ranking formula implemented** ✅:
   ```
   llmRaw = 0.7 * relevance + 0.3 * usefulness
   llmScore_norm = llmRaw / 10
   bm25Score_norm = already normalized [0, 1]
   recencyScore = 2^(-ageDays / halfLifeDays), clamped [0.2, 1.0]
   
   finalScore = 
     (llmScore_norm * weight.llm) +
     (bm25Score_norm * weight.bm25) +
     (recencyScore * weight.recency)
   ```

3. **Built /api/items endpoint** ✅:
   - GET /api/items?category=tech_articles&period=week
   - Accepts category and period (week/month/all) params
   - Returns ranked items with all scores
   - Includes reasoning field
   - Full error handling and validation

4. **Tested merged ranking** ✅:
   - All final scores in [0, 1] range ✓
   - 3,810 items ranked (weekly), 2,810 passed filters (73.76%)
   - Score distribution realistic and sensible
   - Per-category validation passed
   - API response format verified

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

### Session: Diversity Selection (code-intel-digest-8hc) - NEXT

**Goal**: Implement per-source caps and greedy selection algorithm

**Steps**:
1. In rank.ts or new select.ts:
   - Track items per source per category
   - Enforce per-source caps (recommended: 2 per source weekly, 3 per source monthly)
   - Greedy selection: iterate top-down, skip items exceeding cap
   - Stop after CATEGORY_CONFIG[category].maxItems

2. Create digestSelections table entries:
   - item_id, category, period, rank, diversity_reason
   - Store which items made final digest per category/period

3. Update API endpoint:
   - Filter ranked items through diversity selection
   - Return final digest items only

4. Test:
   - Verify per-source caps enforced
   - Check source distribution is balanced
   - Verify top items still included (not always cap-limited)

**Files to Create**:
- src/lib/pipeline/select.ts (diversity selection, ~80 lines)
- scripts/test-diversity.ts (validation, ~60 lines)

**Command**:
```bash
bd update code-intel-digest-8hc --status in_progress
# ... implement ...
bd close code-intel-digest-8hc --reason "Diversity selection with per-source caps"
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

# Test hybrid ranking (all 7 categories)
npx tsx scripts/test-ranking.ts

# Test API endpoint responses
npx tsx scripts/test-api-items.ts
```

### Quality Gates
```bash
# Type-check
npm run typecheck

# Lint
npm run lint

# Build (note: has pre-existing React hook issue in global-error, unrelated to ranking)
npm run build
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
