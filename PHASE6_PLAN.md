# Phase 6: UI Refinement + Advanced Features

**Date**: December 7, 2025  
**Phase**: 6 of 7 (Estimated 60% complete after Phase 5)  
**Status**: Planning & Task Definition

---

## New Requirements

### 1. **Search Ranking Quality Issue** (P1 - Bug)
**Bead**: `code-intel-digest-71d`

**Problem**: Search query 'code search' returns anthropic/bun story ranked higher than hacker news trigram result (appears twice from different sources).

**Root Cause Analysis Needed**:
- Is BM25 weighting favoring wrong terms?
- Is semantic similarity calculation misbehaving?
- Is LLM score weighting giving too much weight to certain sources?
- Are duplicate sources being scored the same?

**Investigation**:
1. Test search with 'code search' query
2. Check embeddings similarity scores vs final scores
3. Verify BM25 query construction for search context
4. Compare scores with and without semantic similarity boost
5. Check diversity constraints - why duplicates appearing?

**Solution Strategy**:
- May need to tune semantic boost weight (currently 0.2)
- May need category-specific query adjustments for search mode
- May need to increase source diversity enforcement for search results

---

### 2. **UI Format Change** (P2 - Feature)
**Bead**: `code-intel-digest-7jb`

**Current**: Card-based grid (1-2 columns responsive)  
**Target**: Ranked list format with up to 10 results per category

**Changes**:
- Update `ItemsGrid` to display as numbered list (1-10 ranking)
- Show item index before title
- Compact layout with score/tags inline
- Keep responsive but optimize for vertical scanning
- Show final score + relevance score prominently

**Components to Update**:
- `src/components/feeds/items-grid.tsx` - Change grid layout to list
- `src/components/feeds/item-card.tsx` - Convert to list-item format
- `app/page.tsx` - Adjust layout spacing

**Example Layout**:
```
1. [8.5] Article Title - Hacker News
   Code search semantic search | Relevance 9/10

2. [8.2] Another Article - Pragmatic Engineer
   context agents code review | Relevance 8/10
```

---

### 3. **Daily Time Period** (P3 - Feature)
**Bead**: `code-intel-digest-hv1`

**Current**: Week (7d), Month (30d), All-time (90d)  
**Add**: Daily (1d)

**Components to Update**:
- `app/page.tsx` - Add "Daily" button
- `src/components/feeds/items-grid.tsx` - Type support
- `src/components/search/search-box.tsx` - Add daily option
- `src/components/qa/ask-box.tsx` - Add daily option
- `app/api/items/route.ts` - Add 1d period mapping
- `app/api/search/route.ts` - Add daily support
- Database queries - already support arbitrary periodDays

**Business Logic**:
- Daily: 24h window (1d)
- Per-source caps for daily: 1 item/source (stricter diversity)
- Recency half-life: 12 hours (faster decay)

---

### 4. **Embeddings + LLM QA Integration** (P1 - Feature)
**Beads**: `code-intel-digest-lv2`, `code-intel-digest-hj4`

**Architecture**:
```
User Question
    ↓
Query Embeddings (Anthropic or Cohere)
    ↓
Semantic Retrieval (top-K similar items)
    ↓
Rank Retrieved Items (hybrid scoring)
    ↓
LLM Answer Generation (Claude, with sources cited)
    ↓
Response (Answer + Sources)
```

**Database Schema Additions**:
```sql
-- If not exists: embeddings table
CREATE TABLE IF NOT EXISTS embeddings (
  item_id TEXT PRIMARY KEY,
  embedding BLOB,  -- Vector as bytes
  embedding_model TEXT,
  created_at INTEGER
);
```

**Implementation Steps**:

1. **Embedding Generation** (`src/lib/embeddings/generate.ts`):
   - Use OpenAI `text-embedding-3-small` or Anthropic Claude Embeddings
   - Batch generation for efficiency
   - Cache in embeddings table

2. **Retrieval** (`src/lib/pipeline/retrieval.ts`):
   - Find top-K similar items using cosine similarity
   - Re-rank using hybrid scoring (embeddings + BM25 + LLM)
   - Return ranked sources to LLM

3. **LLM Answer Generation** (`src/lib/pipeline/answer.ts`):
   - System prompt: "You are an expert Code Intelligence analyst"
   - Context: Top-5 retrieved items
   - Task: Generate coherent answer + cite sources
   - Output: Answer text + source attribution

4. **QA API Endpoint** (`app/api/ask/route.ts`):
   - Accept question, category (optional), period
   - Retrieve top items
   - Generate answer
   - Return: question, answer, sources[], metadata

**Cost Considerations**:
- Embeddings: ~$0.0001 per 1K tokens (very cheap)
- LLM answers: ~$0.01 per answer (Claude 3 Haiku or GPT-4o mini)
- Cache embeddings to avoid regeneration
- Batch embeddings during daily sync

---

### 5. **Content Digest Page** (P2 - Feature)
**Bead**: `code-intel-digest-byv`

**New Page**: `/digest` (separate from main `/` dashboard)

**Features**:
- Shows highlighted content (top 5-10 items per category)
- AI-generated summary of the week/month/day
- Key themes and trends
- Quick links to full category digests

**Components**:
- `src/components/digest/digest-page.tsx` - Main page
- `src/components/digest/digest-summary.tsx` - AI summary section
- `src/components/digest/digest-highlights.tsx` - Top items per category
- `src/components/digest/digest-trends.tsx` - Key themes

**API Endpoint** (`app/api/digest/route.ts`):
```typescript
GET /api/digest?period=week
Returns:
{
  period: "week",
  dateRange: { start, end },
  summary: "AI-generated text summary",
  themes: ["semantic search", "agents", "devex"],
  highlights: {
    newsletters: [...top 3],
    ai_news: [...top 3],
    ...
  }
}
```

**Summary Generation**:
- Use Claude to generate 200-300 word summary
- Analyze top items across all categories
- Extract key themes and trends
- Format as readable prose

---

## Implementation Order

### Phase 6A: Search Fix + Daily Period (This Week)
1. Debug search ranking issue (P1)
2. Add daily period support (P3)
3. Test search quality improvement

**Estimated**: 4-6 hours

### Phase 6B: UI Refinement (Next)
4. Convert grid to ranked list (P2)
5. Update all components for new layout
6. Test responsive design

**Estimated**: 3-4 hours

### Phase 6C: Embeddings + QA (Advanced)
7. Set up embedding generation (P1)
8. Implement retrieval pipeline (P1)
9. Implement answer generation (P1)
10. Integrate into QA page

**Estimated**: 6-8 hours

### Phase 6D: Digest Page
11. Create digest page (P2)
12. Implement summary generation
13. Design highlights section

**Estimated**: 3-4 hours

---

## File Structure Changes

```diff
src/
  components/
    feeds/
      items-grid.tsx          (MODIFIED: grid → list)
      item-card.tsx           (MODIFIED: card → list-item)
    search/
      search-box.tsx          (MODIFIED: add daily)
      search-results.tsx      (UPDATED: list format)
    qa/
      ask-box.tsx             (MODIFIED: add daily)
      qa-page.tsx             (UPDATED: use retrieval)
    +digest/
      +digest-page.tsx        (NEW)
      +digest-summary.tsx     (NEW)
      +digest-highlights.tsx  (NEW)
      +digest-trends.tsx      (NEW)
  lib/
    pipeline/
      rank.ts                 (OK: no changes needed)
      search.ts               (UPDATED: ranking order)
      +retrieval.ts           (NEW: embedding-based)
      +answer.ts              (NEW: LLM synthesis)
    +embeddings/
      +generate.ts            (NEW)
      +index.ts               (NEW: vector search)
    db/
      items.ts                (OK)
      +embeddings.ts          (NEW: storage)
app/
  page.tsx                    (MODIFIED: add daily button)
  api/
    items/route.ts            (MODIFIED: daily support)
    search/route.ts           (MODIFIED: daily support)
    +digest/
      +route.ts               (NEW)
    +ask/
      +route.ts               (NEW: enhanced)
```

---

## Quality Gates

- [ ] TypeScript strict: 0 errors
- [ ] ESLint: 0 errors
- [ ] Search quality: verified on 'code search' query
- [ ] Daily period: working in all tabs
- [ ] List format: responsive on mobile/desktop
- [ ] Embeddings: generating and caching
- [ ] Answer generation: coherent, sourced
- [ ] Digest page: loading and displaying

---

## Risks & Mitigation

| Risk | Mitigation |
|------|-----------|
| Embedding API costs | Cache all embeddings, batch during sync |
| Answer generation costs | Use cheaper models (Haiku), limit to 1 answer per session |
| Search quality fixes break other things | Test thoroughly, keep BM25 weights tunable |
| List format breaks mobile | Design mobile-first, test responsively |

---

## Next Steps

1. Start with **Phase 6A** (search debug + daily period) - quickest wins
2. Progress to **Phase 6B** (UI list format) - visual improvement
3. Then **Phase 6C** (embeddings + QA) - technical complexity
4. Finally **Phase 6D** (digest page) - nice-to-have polish

---

## Success Criteria

✅ Search quality improved (anthropic/bun not ranked above hacker news)  
✅ Daily period available in all tabs  
✅ List format shows 10 items per category  
✅ QA generates coherent answers with sources  
✅ Digest page summarizes top content  
✅ All tests passing  
✅ Zero build/type errors  

---

**Created**: December 7, 2025  
**Status**: Ready for Phase 6A start
