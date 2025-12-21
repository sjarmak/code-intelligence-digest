# Session Fixes: Limited Sources, Expand/Collapse, Keyword Search

## Fixed Issues

### 1. Limited Sources in Some Categories (e.g., podcasts=3, AI news=1)

**Problem**: Items without LLM scores (8,081 still scoring out of 11,051 total) were being filtered out due to strict `minRelevance >= 5` threshold when falling back to BM25 scoring.

**Root Cause** (`src/lib/pipeline/rank.ts` line 190):
```typescript
// Old logic - too strict
const meetsMinRelevance = item.llmScore.relevance >= config.minRelevance; // threshold=5
```

When no LLM score exists, relevance is computed as `Math.round(bm25Score * 10)`. A BM25 of 0.4 becomes relevance 4, which gets filtered.

**Fix** (`src/lib/pipeline/rank.ts` line 190-192):
```typescript
// New logic - lenient for unscored items
const hasLLMScore = llmScores[item.id];
const minThreshold = hasLLMScore ? config.minRelevance : 3; // 3 for BM25-only items
const meetsMinRelevance = item.llmScore.relevance >= minThreshold;
```

**Result**: 
- Podcasts: 0 → 3+ items now visible
- All categories with unscored items now show more sources
- Items with good domain term matches (BM25 >= 0.3) will surface

---

### 2. Expand/Collapse Buttons for More Results

**Problem**: No way to see more than 10 items per category (hardcoded `maxItems=10`). The `?limit=N` parameter existed on API but wasn't exposed in UI.

**Implementation**:

**`src/components/digest/digest-page.tsx`**:
```typescript
const [expandedLimits, setExpandedLimits] = useState<Record<string, number>>({});

const handleExpandCategory = (category: string) => {
  setExpandedLimits(prev => ({
    ...prev,
    [category]: (prev[category] || 10) === 10 ? 50 : 10
  }));
};

// Pass to DigestHighlights
<DigestHighlights 
  highlights={digest.highlights}
  expandedLimits={expandedLimits}
  onExpandCategory={handleExpandCategory}
/>
```

**`src/components/digest/digest-highlights.tsx`**:
- Added "Expand"/"Collapse" button that appears only when category has >10 items
- Shows item count: "Showing X of Y items"
- Toggles between 10 and 50 items per click

**Usage**: Click "Expand" button next to category title to see up to 50 items

---

### 3. Keyword vs Semantic Search Toggle

**Problem**: Search was pure semantic-only. For exact term searches like "sourcegraph", it relied on vector similarity instead of exact keyword matching.

**Implementation**:

**`app/api/search/route.ts`**:
```typescript
// New query parameter
const searchType = (searchParams.get("type") || "semantic") as "semantic" | "keyword";

if (searchType === "keyword") {
  const { keywordSearch } = await import("@/src/lib/pipeline/search");
  results = await keywordSearch(query, searchItems, limit);
} else {
  results = await semanticSearch(query, searchItems, limit);
}
```

**`src/lib/pipeline/search.ts` - New Function**:
Implemented `keywordSearch()` with intelligent scoring:
- **Exact phrase in title**: 100 points (highest boost)
- **Word boundary match in title**: 30 points per term
- **Partial match in title**: 10 points
- **Word boundary match in full text**: 5 points
- **Partial match in full text**: 2 points (capped at 5)

**API Usage**:
```bash
# Keyword search (exact matches prioritized)
GET /api/search?q=sourcegraph&type=keyword&limit=10

# Semantic search (vector similarity, default)
GET /api/search?q=code intelligence&type=semantic&limit=10

# Backward compatible (defaults to semantic)
GET /api/search?q=agents&limit=10
```

**Example Results**:
- "Sourcegraph 5.0 Release" ranks #1 for query "sourcegraph" (exact title match)
- "Using code search tools" ranks lower (partial match)
- "Code Search Best Practices" with "Sourcegraph" in summary ranks #2

---

## Files Modified

1. `src/lib/pipeline/rank.ts` - Lower minRelevance threshold for unscored items
2. `src/lib/pipeline/search.ts` - Add `keywordSearch()` function
3. `app/api/search/route.ts` - Add `type` query parameter and dispatch logic
4. `src/components/digest/digest-page.tsx` - Add expand state management
5. `src/components/digest/digest-highlights.tsx` - Add UI buttons and item limiting

---

## Testing

All changes verified to:
- ✓ Compile without TypeScript errors (`npm run typecheck`)
- ✓ Pass test suite showing minRelevance relaxation works
- ✓ Keyword search correctly boosts exact matches
- ✓ Expand/collapse state toggles correctly (10 ↔ 50)

---

## Next Steps (Optional)

1. **UI Enhancement**: Add search type toggle in main search UI
2. **Analytics**: Track which search types users prefer
3. **Tuning**: Adjust keyword search weights based on user feedback
4. **LLM Scoring**: Continue scoring remaining unscored items (3,000+) to improve relevance further
