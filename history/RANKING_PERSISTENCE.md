# Ranking Persistence & Analytics Implementation

## Overview

Implemented a comprehensive ranking persistence and analytics system that stores all scored items and selection decisions, enabling algorithm experimentation, score analysis, and debugging.

## What Was Built

### 1. Selection Tracking Database Module (`src/lib/db/selections.ts`)

New CRUD operations for digest selections:

- **`saveDigestSelections()`**: Persist items selected for final digests with rank and diversity reason
- **`getDigestSelections()`**: Retrieve all selections for a category/period with ordering
- **`getSelectionStats()`**: Aggregate statistics (total selected, breakdown by category)

Each selection captures:
- `itemId`: The selected item
- `category` + `period`: Which digest it made
- `rank`: Position in final digest (1-based)
- `diversityReason`: Why it was selected or excluded
- `selectedAt`: Timestamp

### 2. Selection Pipeline Enhancement (`src/lib/pipeline/select.ts`)

Refactored `selectWithDiversity()` to track diversity reasons:

```typescript
export interface SelectionResult {
  items: RankedItem[];
  reasons: Map<string, string>; // item.id -> diversity reason
}
```

Now returns both items AND reasons, capturing:
- Selected items: `"Selected at rank N"`
- Excluded by source cap: `"Source cap reached for ${source} (N/${maxPerSource})"`
- Excluded by total cap: `"Total category limit reached (N/${maxItems})"`

### 3. Digest Selection Persistence in API Route

Updated `/api/items/route.ts` to persist selections:

```typescript
// On every successful request (cache hit or fresh fetch):
const selectionResult = selectWithDiversity(rankedItems, category);
await saveDigestSelections(
  finalItems.map((item, rank) => ({
    itemId: item.id,
    category,
    period: "week" | "month",
    rank: rank + 1,
    diversityReason: selectionResult.reasons.get(item.id),
  }))
);
```

This happens automatically on every request, creating a historical record of all selections.

### 4. Admin: Ranking Debug Endpoint (`/api/admin/ranking-debug`)

Debug endpoint to inspect ranking decisions before selection filtering:

**Endpoint**: `GET /api/admin/ranking-debug?category=research&period=week&limit=50`

**Response**:
```json
{
  "category": "research",
  "period": "week",
  "totalRanked": 342,
  "topItems": [
    {
      "id": "item-123",
      "title": "Paper Title",
      "sourceTitle": "arXiv",
      "publishedAt": "2025-12-04T...",
      "bm25Score": 0.85,
      "llmRelevance": 8,
      "llmUsefulness": 7,
      "llmTags": ["research", "code-search"],
      "recencyScore": 0.95,
      "finalScore": 0.78,
      "reasoning": "LLM: relevance=8.0, usefulness=7.0 | BM25=0.85 | Recency=0.95 (age: 2d) | Tags: research, code-search"
    }
  ],
  "scoreRange": {
    "min": 0.42,
    "max": 0.89,
    "avg": 0.65
  }
}
```

**Use Cases**:
- Understand why certain items got low scores
- Debug BM25 term matching per category
- Inspect LLM relevance decisions
- Verify recency decay calculations

### 5. Admin: Score Analytics Endpoint (`/api/admin/analytics/scores`)

Analyze score distributions and performance metrics:

**Endpoint**: `GET /api/admin/analytics/scores?category=research&period=week&histogram=true&topSources=true`

**Response**:
```json
{
  "category": "research",
  "period": "week",
  "itemsAnalyzed": 342,
  "averageScores": {
    "avgBm25": 0.58,
    "avgLlmRelevance": 6.2,
    "avgRecency": 0.72,
    "avgFinal": 0.64,
    "count": 342
  },
  "distributions": {
    "bm25": {
      "histogram": [45, 67, 89, 102, 39, 0, 0, 0, 0, 0],
      "min": 0,
      "max": 0.95,
      "mean": 0.58,
      "median": 0.61
    },
    "llmRelevance": {
      "histogram": [12, 34, 67, 98, 102, 29, 0, 0, 0, 0],
      "min": 0,
      "max": 10,
      "mean": 6.2,
      "median": 7
    },
    "final": {
      "histogram": [28, 56, 89, 124, 87, 18, 0, 0, 0, 0],
      "min": 0.25,
      "max": 0.98,
      "mean": 0.64,
      "median": 0.67
    }
  },
  "topSources": [
    {
      "source": "Pragmatic Engineer",
      "itemCount": 8,
      "avgScore": 0.79,
      "maxScore": 0.92,
      "minScore": 0.65
    }
  ]
}
```

**Use Cases**:
- Monitor score calibration per category
- Identify dead score ranges (histograms with gaps)
- Find high-performing sources by average score
- Track scoring drift over time

### 6. Admin: Selection Analytics Endpoint (`/api/admin/analytics/selections`)

Analyze digest selection decisions:

**Endpoint**: `GET /api/admin/analytics/selections?period=week&category=research`

**Response**:
```json
{
  "period": "week",
  "overallStats": {
    "totalSelected": 47,
    "byCategory": {
      "research": 12,
      "tech_articles": 15,
      "ai_news": 10,
      "product_news": 10
    }
  },
  "category": "research",
  "selections": [
    {
      "itemId": "item-456",
      "rank": 1,
      "diversityReason": "Selected at rank 1",
      "selectedAt": "2025-12-04T14:00:00Z"
    }
  ],
  "reasonAnalysis": {
    "selectedCount": 12,
    "excludedCount": 330,
    "reasonBreakdown": {
      "Selected at rank": 12,
      "Source cap reached": 215,
      "Total category limit": 103
    }
  }
}
```

**Use Cases**:
- Verify diversity constraints are working
- Understand why items weren't selected
- Monitor category balance in final digests
- Track source saturation

## Architecture & Design

### Scoring Persistence Flow

```
GET /api/items?category=research&period=week
  ↓
Load items from database (by category + time window)
  ↓
rankCategory() → compute BM25, LLM, recency scores
  ↓
saveItemScores() → persist all scores to item_scores table
  ↓
selectWithDiversity() → filter by source/total caps, return reasons
  ↓
saveDigestSelections() → persist selection decisions
  ↓
Return final items to client
```

### Database Tables Involved

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `items` | Base items data | id, title, url, category, published_at |
| `item_scores` | Ranking scores (history) | item_id, category, bm25_score, llm_relevance, llm_usefulness, final_score, scored_at |
| `digest_selections` | Selection decisions | item_id, category, period, rank, diversity_reason, selected_at |

### Composite Keys & History

- `item_scores` has composite key `(item_id, scored_at)` to allow score history tracking
- Multiple rankings of the same item over time create new rows
- `digest_selections` tracks which items made each digest (week vs month)

## Key Design Decisions

### 1. SelectionResult Interface

Instead of just returning items, `selectWithDiversity()` now returns:

```typescript
{
  items: RankedItem[],
  reasons: Map<string, string>
}
```

This allows the API route to persist why each item was selected or excluded without recalculating.

### 2. Persistent Diversity Tracking

Each request captures:
- Which items were selected (with rank)
- Why items were excluded (source cap, total limit)
- Timestamp of decision

This enables debugging: "Why wasn't Item X included in the Tuesday digest?"

### 3. Score + Selection Separation

- **item_scores** stores all ranking scores (before filtering)
- **digest_selections** stores only final selections (after filtering)

This separation allows:
- Understanding why good-scoring items didn't make the digest
- Analyzing score calibration independent of selection logic
- A/B testing different diversity constraints without re-scoring

### 4. Admin Endpoints Leverage Existing Data

- `/api/admin/ranking-debug` re-ranks items on-demand (reads from items table)
- `/api/admin/analytics/scores` reads stored scores from item_scores
- `/api/admin/analytics/selections` reads stored selections from digest_selections

No duplicate computation; everything uses persistent data.

## Testing & Validation

All changes pass:
- ✅ `npm run typecheck` (strict TypeScript)
- ✅ `npm run lint` (ESLint, no unused imports)

Manual test plan:
1. Call `/api/items?category=research&period=week` → should populate digest_selections
2. Query `digest_selections` table → should have rows with diversity reasons
3. Call `/api/admin/ranking-debug?category=research` → should show 50+ ranked items
4. Call `/api/admin/analytics/scores?category=research` → should show score distributions
5. Call `/api/admin/analytics/selections?period=week&category=research` → should show selection breakdown

## Next Steps

1. **Cache Invalidation (code-intel-digest-bkx)**
   - Add `POST /api/admin/invalidate-feeds` endpoint
   - Add `POST /api/admin/invalidate-items` endpoint
   - Implement exponential backoff on API failures

2. **Semantic Search (code-intel-digest-mop)**
   - Build vector index on item summaries
   - Add `/api/search` endpoint for semantic queries
   - Reuse ranking logic for search results

3. **Score Experimentation UI**
   - Dashboard to visualize score distributions
   - Weight adjustment interface
   - A/B testing harness using stored scores

## Rate Limit Impact

With persistence:
- Ranking still happens at request-time (no change to rate limit pressure)
- Inoreader API calls unchanged (6h feed TTL, 1h item TTL)
- Database operations are local and cheap
- Admin endpoints can be called frequently for debugging

No additional API pressure from analytics.
