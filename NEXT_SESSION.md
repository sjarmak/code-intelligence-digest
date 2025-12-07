# Next Session: LLM Ranking Pipeline

**Session goal**: Implement LLM scoring (Claude) to complete hybrid ranking

## Current State

✅ **BM25 Complete** (Dec 7):
- All 8,058 items scored with BM25 ✅
- Scores stored in item_scores table ✅
- Files: src/lib/pipeline/bm25.ts (315 lines)
- Test scripts: test-bm25.ts, score-items-bm25.ts, verify-bm25-scores.ts ✅

✅ **LLM Scoring Complete** (Dec 7):
- All 8,058 items scored with OpenAI GPT-4o ✅
- Fallback heuristics for offline mode ✅
- Scores stored: llm_relevance, llm_usefulness, llm_tags ✅
- Files: src/lib/pipeline/llmScore.ts (370 lines)
- Test scripts: test-llm-score.ts, score-items-llm.ts, verify-llm-scores.ts ✅
- Statistics: avg relevance 5.3/10, avg usefulness 5.9/10

✅ **Operational**:
- Daily sync: `bash scripts/run-sync.sh` (resumable, 5-10 API calls)
- Database: 8,058 items in 30-day window (Nov 10 - Dec 7, 2025)
- Categories: All 7 populated (research 3.4k, community 2.1k, tech_articles 1.5k, etc.)
- All items have both BM25 and LLM scores ✅

✅ **Ready for hybrid ranking**:
- BM25 scores: 8,058 items ✅
- LLM scores: 8,058 items ✅
- Next: Merge both with recency into final ranking

### 2. LLM Scoring (`src/lib/pipeline/llmScore.ts`)

**Goal**: Rate relevance (0-10) and usefulness (0-10) using Claude

**Implementation**:
```typescript
// Batch Claude API calls (~30-50 per batch, ~$0.20 per 100 items)
// For each item:
//   - Prompt: Rate relevance/usefulness for senior dev audience
//   - Extract tags: ["code-search", "agent", "devex", "context", ...]
//   - Store in item_scores table

// Cost: ~$10-20 to score all 8,058 items
```

**Test**:
```bash
npm ts-node scripts/test-llm-score.ts  # (create this)
# Output: sample scored items with tags
```

### 3. Combined Ranking (`src/lib/pipeline/rank.ts`)

**Goal**: Merge BM25 + LLM + recency into final score

**Formula** (from AGENTS.md):
```
finalScore = 
  (LLM_norm * 0.45) +
  (BM25_norm * 0.35) +
  (Recency * 0.15)

// Optional boost for multi-domain matches
finalScore *= BoostFactor (1.0-1.5)

// Penalty if LLM tags include "off-topic"
```

### 4. API Endpoint (`app/api/items/route.ts`)

**Goal**: Expose ranked items

**Request**:
```
GET /api/items?category=tech_articles&period=week
```

**Response**:
```json
{
  "items": [
    {
      "id": "...",
      "title": "...",
      "url": "...",
      "source": "...",
      "finalScore": 0.87,
      "llmRelevance": 9,
      "llmTags": ["code-search", "context"],
      "reasoning": "Code search (1.6x) + context (1.5x); LLM 9/10; recency 3 days"
    }
  ],
  "totalItems": 1455,
  "period": "week"
}
```

## Next Steps (In Order)

1. ✅ **BM25 Complete** (code-intel-digest-9gx)
   - Term index structure ✅
   - Query builder per category ✅
   - All 8,058 items scored ✅
   - Scores stored in item_scores table ✅
   
2. ✅ **LLM Scoring Complete** (code-intel-digest-06q)
   - OpenAI GPT-4o integration ✅
   - Batch scoring (30 items per call) ✅
   - Fallback heuristics for offline mode ✅
   - All 8,058 items scored with relevance/usefulness/tags ✅
   - Ready for production API calls (cost: ~$10-20 for all items)
   
3. **Merge Scoring** (code-intel-digest-phj) ← NEXT
   - Implement rank.ts combining logic
   - Formula: (LLM_norm * 0.45) + (BM25_norm * 0.35) + (Recency * 0.15)
   - Apply boost factors (1.0-1.5x) for multi-domain matches
   - Build /api/items endpoint
   - Test with real queries
   
4. **Diversity selection** (code-intel-digest-8hc)
   - Cap sources per category (max 2-3 per source per category)
   - Greedy selection algorithm
   
5. **UI components** (code-intel-digest-htm)
   - shadcn tabs, cards, badges
   - Weekly/monthly digest view

## Important Notes

- **No production server**: Do NOT run `npm run dev` unless developing UI
- **API calls**: Only 5 left today; next batch available tomorrow
- **Scoring calls**: Will use ~20-30 of 100 daily calls (test locally first)
- **Database grows**: Each sync adds new items; older than 30 days auto-filtered
- **Resumable**: Sync pauses at 95 calls, resumes next day automatically

## Commands Reference

```bash
# Check current state
bash scripts/run-sync.sh           # Sync status
node -e "const db = require('better-sqlite3')('.data/digest.db'); console.log(db.prepare('SELECT COUNT(*) as count FROM items').get());"

# TypeCheck/Lint
npm run typecheck
npm run lint

# Start next work
bd update code-intel-digest-9gx --status in_progress
# ... implement BM25 ...
bd close code-intel-digest-9gx --reason "BM25 ranking implemented and tested"
```

## Success Criteria

When done with ranking pipeline:

- [ ] All 8,058 items scored (BM25 + LLM)
- [ ] `/api/items?category=tech_articles&period=week` returns ranked items
- [ ] Top items are genuinely relevant (spot-check 5-10)
- [ ] Reasoning field explains each score
- [ ] Diversity applied (no source dominance)
- [ ] Ready for UI component work

---

**Estimated effort**: 4-6 sessions (BM25: 1-2, LLM: 1-2, Merge: 1, Endpoint: 1)

**Go!**
