# Next Session: Ranking Pipeline

**Session goal**: Implement hybrid ranking (BM25 + LLM) to curate 8,058 cached items

## Current State

✅ **Operational**:
- Daily sync: `bash scripts/run-sync.sh` (resumable, 5-10 API calls)
- Database: 8,058 items in 30-day window (Nov 10 - Dec 7, 2025)
- Categories: All 7 populated (research 3.4k, community 2.1k, tech_articles 1.5k, etc.)
- Time filtering: Automatic client-side (older items dropped)
- API budget: 100 calls/day (5 remaining today, resets daily)

✅ **Ready to rank**:
- All items in database normalized (title, URL, summary, author, published date)
- Items categorized (FeedItem model)
- No new API calls needed for ranking (use cached data)

## Priority P1: Ranking Pipeline

### 1. BM25 Scoring (`src/lib/pipeline/bm25.ts`)

**Goal**: Score items 0-1 using domain term queries

**Implementation**:
```typescript
// Domain term categories (from AGENTS.md)
const DOMAIN_TERMS = {
  code_search: { weight: 1.6, terms: ['code search', 'symbol search', 'codebase', ...] },
  ir: { weight: 1.5, terms: ['semantic search', 'RAG', 'embeddings', ...] },
  context: { weight: 1.5, terms: ['context window', 'token budget', 'compression', ...] },
  agentic: { weight: 1.4, terms: ['agent', 'tool use', 'planning', ...] },
  // ... etc
};

// Per category, per time window:
// 1. Build BM25 index from cached items
// 2. Create category-specific query from domain terms
// 3. Score each item 0-1
// 4. Store in item_scores table
```

**Test**:
```bash
npm ts-node scripts/test-bm25.ts  # (create this)
# Output: items ranked by BM25 score per category
```

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

1. **Implement BM25** (code-intel-digest-9gx)
   - Create term index structure
   - Implement query builder per category
   - Score all 8,058 items
   - Store scores in item_scores table
   
2. **Implement LLM scoring** (code-intel-digest-06q)
   - Set up Claude API client
   - Batch scoring (100 items per call)
   - Extract tags and store
   
3. **Merge scoring** (code-intel-digest-phj)
   - Implement rank.ts combining logic
   - Build /api/items endpoint
   - Test with real queries
   
4. **Diversity selection** (code-intel-digest-8hc)
   - Cap sources per category (max 2-3 per category)
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
