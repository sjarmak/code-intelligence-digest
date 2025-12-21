# Debug: Relevance Scores Are All 0

## Problem

All items in the digest show `Relevance: 0/100`. This is a **scoring/ranking issue**, not a pipeline issue.

## Root Cause

The ranking pipeline computes `finalScore` as:

```typescript
finalScore = 
  config.weights.llm * llmScore +
  config.weights.bm25 * bm25Score +
  config.weights.recency * recencyScore
```

Then displays as:
```
Relevance: Math.round(finalScore * 100) / 100
```

**If finalScore = 0, then Relevance = 0.**

### Why finalScore is 0

1. **No LLM scores in database** for most items
   - Database has only 23 scores out of 50 items
   - Items without LLM scores fall back to BM25 score
2. **BM25 scores are too low** for items without LLM pre-computed scores
3. **Recency score decays** over time (exponential decay with half-life)
4. When all three components are low (BM25 fallback, no LLM, old items), finalScore → 0

## Solution

### Option 1: Run Daily Sync (Recommended)

The daily sync computes LLM scores using Claude:

```bash
curl -X POST http://localhost:3002/api/admin/sync-daily \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

This will:
- Fetch new items from Inoreader
- Compute LLM relevance/usefulness for each item using Claude
- Save scores to `item_scores` table
- Next digest generation will use these scores

### Option 2: Force LLM Scoring via Endpoint

If there's a scoring endpoint (check AGENTS.md), call it to re-score recent items:

```bash
curl -X POST http://localhost:3002/api/admin/score-items \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "days": 7,
    "overwrite": false
  }'
```

### Option 3: Check if Sync is Running

```bash
# Check sync state
sqlite3 .data/digest.db "SELECT * FROM sync_state ORDER BY last_sync DESC LIMIT 1;"

# Check item_scores table
sqlite3 .data/digest.db "SELECT COUNT(*) FROM item_scores;"

# See coverage by category
sqlite3 .data/digest.db "
  SELECT 
    i.category,
    COUNT(DISTINCT i.id) as total_items,
    COUNT(DISTINCT s.item_id) as scored_items,
    ROUND(100.0 * COUNT(DISTINCT s.item_id) / COUNT(DISTINCT i.id), 1) as coverage_pct
  FROM items i
  LEFT JOIN item_scores s ON i.id = s.item_id
  WHERE i.published_at > datetime('now', '-7 days')
  GROUP BY i.category
  ORDER BY coverage_pct ASC;
"
```

## Expected Behavior After Scoring

Once LLM scores are computed:

```
Tech articles
My LLM coding workflow going into 2026
Elevate | Relevance: 78/100          ← Was 0/100

Aligning Academia with Industry: An Empirical Study
cs.SE updates on arXiv.org | Relevance: 65/100

Benchmarking AI Models in Software Engineering
cs.AI updates on arXiv.org | Relevance: 72/100
```

## Why This Happens

**Design**: LLM scores are **pre-computed once** during daily sync, not regenerated on each digest request. This saves API calls and ensures consistent scoring.

**Current state**: The digest was generated before the daily sync ran (or before LLM scores were added for recent items).

## Fallback Mechanism

Items without LLM scores get **BM25 score as fallback**:

```typescript
const llmScore = llmResult
  ? (0.7 * llmResult.relevance + 0.3 * llmResult.usefulness) / 10
  : bm25Score;  // ← Fallback when no pre-computed LLM score
```

BM25 is based on keyword matching against category queries, which may not capture relevance well for all items (especially new or edge-case items).

## Next Steps

1. **Run daily sync** to populate `item_scores` for all recent items
2. **Regenerate the digest** (POST `/api/newsletter/generate`)
3. **Verify coverage**: Check that most items now have LLM scores
4. **Monitor**: Ensure daily sync runs on schedule

## Relevant Code

- **Ranking**: `src/lib/pipeline/rank.ts` (line 156–159, finalScore computation)
- **Fallback**: `src/lib/pipeline/rank.ts` (line 95–97, BM25 fallback)
- **Display**: `src/lib/pipeline/newsletter.ts` (line 80, 387, 410, 438)
- **Loading scores**: `src/lib/db/items.ts` (line 196–240)
- **Daily sync**: `app/api/admin/sync-daily/route.ts`
