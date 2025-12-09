# Search Quality Analysis: 'code search' Query Issue

**Issue**: When searching for 'code search', anthropic/bun story ranks higher than hacker news trigram result. Result appears twice from different sources.

**Status**: Under Investigation  
**Bead**: `code-intel-digest-71d`

---

## Problem Statement

### Observed Behavior
```
Search Query: "code search"
Results (Current - WRONG ORDER):
  1. [0.92] Anthropic Acquiring Bun - TechCrunch
  2. [0.91] Code Search with Trigrams - Hacker News  
  3. [0.91] Anthropic Acquiring Bun - Pragmatic Engineer (duplicate)
```

**Expected Behavior**:
```
  1. [0.98] Code Search with Trigrams - Hacker News
  2. [0.85] ...other relevant items...
  3. [0.82] ...anthropic related but less direct...
```

### Why This Matters
- Semantic search should prioritize exact matches
- "code search" query should match "code search" article directly
- Duplicate sources appearing suggests diversity constraints not working for search
- BM25 + semantic weighting may be backwards

---

## Technical Investigation Areas

### 1. Semantic Similarity Scoring
**File**: `src/lib/embeddings/` (or equivalent embedding generation)

**Questions**:
- Is query embedding for "code search" being generated correctly?
- Are item embeddings being generated from title+summary+snippet?
- What is actual cosine similarity between "code search" query and:
  - "Code Search with Trigrams" article? (Should be ~0.95+)
  - "Anthropic Acquiring Bun" article? (Should be ~0.3-0.5)

**Investigation**:
```typescript
// Add debug logging
const queryEmb = await generateEmbedding("code search");
const codesearchItemEmb = await generateEmbedding("Code Search with Trigrams semantic search..."); 
const anthropicItemEmb = await generateEmbedding("Anthropic Acquiring Bun...");

console.log("Similarities:");
console.log("code search → code search item:", cosineSimilarity(queryEmb, codesearchItemEmb)); // Should be >0.9
console.log("code search → anthropic item:", cosineSimilarity(queryEmb, anthropicItemEmb));     // Should be <0.6
```

---

### 2. BM25 Query Term Weighting
**File**: `src/lib/pipeline/bm25.ts`

**Issue**: Search mode might need different query construction than digest browsing.

**Current Behavior**:
- Takes user query directly as BM25 terms
- Query: "code search" → terms: ["code", "search"]
- Both are common words, may not differentiate well

**Potential Fix**:
```typescript
// In search mode, expand query with domain synonyms
const expandedQuery = {
  "code search": ["code search", "code navigation", "codebase search", "symbol search"],
  "semantic search": ["semantic search", "embeddings", "rag", "retrieval"],
  // ... etc
};

// Or use query expansion with BM25 IDF weighting
const queryTerms = expandQuery(userQuery);  // Intelligent expansion
```

**Test**:
```bash
npm run test -- search-ranking.test.ts
# Check if pure BM25 on "code search" query puts hacker news item first
```

---

### 3. Hybrid Score Blending
**File**: `src/lib/pipeline/search.ts` - `rerankWithSemanticScore()`

**Current Formula**:
```typescript
blendedScore = finalScore * (1 - boostWeight) + semanticScore * boostWeight;
```

With `boostWeight = 0.2`:
```
blendedScore = finalScore * 0.8 + semanticScore * 0.2
```

**Problem**: If `finalScore` (from BM25+LLM) is high, semantic boost of 0.2 may not be enough to override it.

**Example**:
```
Anthropic item:
  finalScore = 0.75 (from BM25+LLM ranking)
  semanticScore = 0.60 (moderate match)
  blended = 0.75 * 0.8 + 0.60 * 0.2 = 0.60 + 0.12 = 0.72

Code search item:
  finalScore = 0.65 (from BM25+LLM ranking)
  semanticScore = 0.95 (excellent match)
  blended = 0.65 * 0.8 + 0.95 * 0.2 = 0.52 + 0.19 = 0.71
```

**Result**: Anthropic item wins by 0.01 despite much worse semantic match!

**Solution**: Increase `boostWeight` for search mode:
```typescript
const boostWeight = isSearchMode ? 0.5 : 0.2;  // 50% weight for semantic in search
// blended = finalScore * 0.5 + semanticScore * 0.5
```

---

### 4. Duplicate Source Handling
**File**: `src/lib/pipeline/select.ts` - diversity constraints

**Issue**: Same article from different sources appearing multiple times.

**Current Diversity Logic**:
```typescript
const currentSourceCount = sourceCount.get(item.sourceTitle) ?? 0;
if (currentSourceCount >= maxPerSource) {
  // Skip this item
}
```

**Problem**: Different sources (Pragmatic Engineer vs TechCrunch) for same article create duplicate entries.

**Potential Solutions**:

Option A: Deduplicate by similarity before ranking
```typescript
// Group items with >0.95 semantic similarity
const deduplicateItems = (items) => {
  const groups = clusterBySimilarity(items, 0.95);
  return groups.map(g => g[0]); // Keep first from each cluster
};
```

Option B: Track URLs not just sources
```typescript
const seenUrls = new Set<string>();
for (const item of rankedItems) {
  if (seenUrls.has(item.url)) {
    continue;  // Skip duplicate URL
  }
  seenUrls.add(item.url);
  // ... rest of logic
}
```

---

## Recommended Fix Strategy

### Phase 1: Add Debug Logging (Low Risk)
```typescript
// In semanticSearch()
logger.info(`Query embedding generated: ${queryEmbedding.slice(0,5).join(',')}...`);

// In rerankWithSemanticScore()
for (const item of rankedItems) {
  const semanticScore = semanticScores.get(item.id) ?? 0;
  logger.info(`Item: ${item.title.slice(0,30)}...
    finalScore=${item.finalScore.toFixed(3)}
    semanticScore=${semanticScore.toFixed(3)}
    blended=${blended.toFixed(3)}`);
}
```

Run test search, analyze logs to identify where ranking breaks down.

### Phase 2: Tune Hybrid Weight (Medium Risk)
Increase semantic boost weight for search:
```typescript
// In search.ts
const boostWeight = 0.5;  // Increased from 0.2 for direct user searches
```

Test with 'code search' query - should now rank correctly.

### Phase 3: Deduplication (Medium Risk)
Add URL-based deduplication before diversity constraints:
```typescript
// In select.ts
const deduplicatedItems = [];
const seenUrls = new Set<string>();

for (const item of rankedItems) {
  const urlKey = new URL(item.url).hostname + item.url.split('/').pop();
  if (!seenUrls.has(urlKey)) {
    deduplicatedItems.push(item);
    seenUrls.add(urlKey);
  }
}

return selectWithDiversity(deduplicatedItems, category, maxPerSource);
```

### Phase 4: Query Expansion (If Needed)
Only if above fixes don't work - implement smart query expansion:
```typescript
const expandedTerms = expandQueryTerms(userQuery);
const semanticScores = await embedSimilarity(queryEmbedding, itemEmbeddings);
const bm25Scores = bm25.score(expandedTerms);  // Use expanded terms
```

---

## Testing Plan

### Test 1: Manual Search
```bash
# Search for 'code search'
curl "http://localhost:3002/api/search?q=code+search&limit=5"

# Expected top result: Code Search with Trigrams article (Hacker News)
# Expected NOT to include duplicates
```

### Test 2: Debug Scoring
```typescript
// tests/search-quality.test.ts
test('code search query returns trigram article first', async () => {
  const results = await semanticSearch('code search', items, 10);
  
  expect(results[0].title).toContain('Trigram');
  expect(results[0].sourceTitle).toContain('Hacker');
  
  // Check no duplicates
  const urls = new Set(results.map(r => r.url));
  expect(urls.size).toBe(results.length);
});
```

### Test 3: Embedding Quality
```typescript
// tests/embeddings-quality.test.ts
test('semantic similarity differentiates code search from anthropic news', async () => {
  const queryEmb = await generateEmbedding('code search');
  const codeSearchEmb = await generateEmbedding('Code Search with Trigrams...');
  const anthropicEmb = await generateEmbedding('Anthropic Acquiring Bun...');
  
  const codeSim = cosineSimilarity(queryEmb, codeSearchEmb);
  const anthropicSim = cosineSimilarity(queryEmb, anthropicEmb);
  
  expect(codeSim).toBeGreaterThan(0.85);  // High match
  expect(anthropicSim).toBeLessThan(0.60);  // Low match
  expect(codeSim).toBeGreaterThan(anthropicSim);
});
```

---

## Implementation Checklist

- [ ] Add debug logging to semanticSearch() and rerankWithSemanticScore()
- [ ] Run test search, capture logs
- [ ] Analyze embedding similarities (Phase 1)
- [ ] Increase boostWeight to 0.5 (Phase 2)
- [ ] Test 'code search' query - verify ranking improved
- [ ] Add URL-based deduplication (Phase 3)
- [ ] Re-run tests, verify no duplicates
- [ ] If still failing, implement query expansion (Phase 4)
- [ ] Add tests to prevent regression

---

## Success Criteria

✅ Searching 'code search' returns Code Search with Trigrams article as #1  
✅ No duplicate articles from different sources  
✅ Semantic similarity correctly differentiates between direct and indirect matches  
✅ All search tests pass  
✅ No regression on other search queries  

---

**Last Updated**: December 7, 2025  
**Status**: Ready for investigation
