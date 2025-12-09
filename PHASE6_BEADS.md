# Phase 6 Beads & Implementation Tasks

**Status**: Task Definition Complete  
**Phase**: 6 of 7  
**Estimated Duration**: 18-24 hours  
**Priority Order**: See below

---

## Bead Registry

### P1 - Critical/High-Impact

#### Bead: `code-intel-digest-71d`
**Title**: Investigate search ranking issue - 'code search' query returns anthropic/bun story above hacker news trigram  
**Priority**: 1 (Bug/Critical)  
**Effort**: 4-6 hours  
**Status**: Not Started  
**Depends On**: None  

**Description**:
When user searches for 'code search', the anthropic/bun story ranks higher than the direct hacker news trigram result. Additionally, the same article appears twice from different sources.

**Root Causes to Investigate**:
1. Semantic similarity scoring may not be strong enough vs. BM25+LLM scores
2. Hybrid score blending weight (0.2) too low for search context
3. Duplicate deduplication not working for different sources
4. BM25 query not optimized for search mode

**Acceptance Criteria**:
- [ ] 'code search' query returns Code Search/Trigrams article as #1
- [ ] No duplicate articles from different sources
- [ ] Semantic similarity properly differentiates
- [ ] Search quality test added

**See Also**: `SEARCH_QUALITY_ANALYSIS.md`

---

#### Bead: `code-intel-digest-lv2`
**Title**: Add embeddings-based retrieval system for LLM QA - vector storage setup  
**Priority**: 1 (Infrastructure)  
**Effort**: 6-8 hours  
**Status**: Not Started  
**Depends On**: None (can work in parallel)  
**Blocks**: `code-intel-digest-hj4`

**Description**:
Set up vector storage and retrieval infrastructure for LLM-based QA system. This includes:
- Embedding generation (OpenAI or Anthropic)
- Vector storage in SQLite with BLOB field
- Cosine similarity search
- Caching and batch generation during sync

**Implementation**:
1. Add `embeddings` table to database schema
2. Create `src/lib/embeddings/generate.ts` - batch embedding generation
3. Create `src/lib/embeddings/index.ts` - vector search utilities
4. Add `src/lib/db/embeddings.ts` - storage/retrieval
5. Create `src/lib/pipeline/retrieval.ts` - top-K retrieval

**Acceptance Criteria**:
- [ ] Embeddings table created and working
- [ ] generateEmbedding() batches items efficiently
- [ ] Vector search returns top-K by cosine similarity
- [ ] Embeddings cached and retrieved from DB
- [ ] Costs optimized (batching, caching)
- [ ] Tests show <100ms retrieval for 8000 items

**Tech**: Better-sqlite3 with BLOB storage, cosine similarity

---

#### Bead: `code-intel-digest-hj4`
**Title**: Implement LLM answer generation with balanced retrieval quality  
**Priority**: 1 (Feature)  
**Effort**: 5-7 hours  
**Status**: Not Started  
**Depends On**: `code-intel-digest-lv2` (embeddings setup)  

**Description**:
Implement the final part of the QA system: retrieving relevant items and generating coherent LLM answers with proper source attribution.

**Implementation**:
1. Create `src/lib/pipeline/answer.ts` - answer generation
2. Update `app/api/ask/route.ts` - main endpoint
3. Create QA prompt system with retrieved context
4. Implement source attribution logic
5. Add cost controls (caching, cheaper models)

**Endpoint**: `GET /api/ask?question=...&category=...&period=...`

**Response**:
```json
{
  "question": "What are best practices for code search?",
  "answer": "Based on recent discussions and research, code search best practices include...",
  "sources": [
    { "id": "...", "title": "...", "url": "...", "relevance": 0.92 },
    { "id": "...", "title": "...", "url": "...", "relevance": 0.87 }
  ],
  "generatedAt": "2025-12-07T18:00:00Z"
}
```

**Acceptance Criteria**:
- [ ] Answer generation works end-to-end
- [ ] Answers cite sources properly
- [ ] Retrieved sources are relevant (top-5)
- [ ] Cost per answer <$0.01 (using Haiku or mini models)
- [ ] Tests verify answer quality and sourcing
- [ ] Category/period filters work correctly

**Tech**: Claude, proper prompt engineering, source citation

---

### P2 - Important Features

#### Bead: `code-intel-digest-7jb`
**Title**: Update UI from card-based grid to ranked list format (max 10 items per category)  
**Priority**: 2 (Feature)  
**Effort**: 3-4 hours  
**Status**: Not Started  
**Depends On**: None  
**Blocks**: `code-intel-digest-byv` (digest page depends on this layout)

**Description**:
Replace the current card-based 2-column responsive grid with a ranked list format showing numbered results (1-10). This improves scannability and matches user expectations for ranked search/digest results.

**Components to Modify**:
- `src/components/feeds/items-grid.tsx` - Grid → list layout
- `src/components/feeds/item-card.tsx` - Card → list-item component
- `app/page.tsx` - Spacing/layout adjustments

**New List Item Format**:
```
1. [Score: 8.5] Article Title Goes Here
   Hacker News · Code Search, Semantic Search, Indexing | Relevance: 9/10 | 2 days ago
```

**Acceptance Criteria**:
- [ ] List shows numbered 1-10 ranking
- [ ] Score displayed prominently
- [ ] Category badge included
- [ ] Source/date/tags visible
- [ ] Responsive on mobile (vertical list)
- [ ] Max 10 items per category enforced
- [ ] Links work, open in new tab

**Design Notes**:
- Keep color scheme from card design
- Hover effects for interactivity
- Maintain dark theme consistency

---

#### Bead: `code-intel-digest-byv`
**Title**: Create content digest page with highlights and AI summary  
**Priority**: 2 (Feature)  
**Effort**: 4-5 hours  
**Status**: Not Started  
**Depends On**: `code-intel-digest-7jb` (uses list format), `code-intel-digest-hj4` (LLM for summary)

**Description**:
New page at `/digest` that provides:
1. AI-generated summary of top content (week/month/day)
2. Highlighted articles (top 3-5 per category)
3. Identified themes and trends
4. Quick navigation to full category digests

**Implementation**:
1. Create `src/components/digest/` directory with sub-components
2. Add `app/api/digest/route.ts` endpoint
3. Implement summary generation (using LLM)
4. Create theme extraction logic

**Endpoint**: `GET /api/digest?period=week`

**Response**:
```json
{
  "period": "week",
  "dateRange": { "start": "2025-12-01", "end": "2025-12-07" },
  "summary": "This week was dominated by discussions about semantic search improvements and agentic workflows...",
  "themes": ["semantic search", "agents", "context management", "code tooling"],
  "itemCount": 47,
  "highlights": {
    "newsletters": [
      { "id": "...", "title": "...", "source": "..." }
    ],
    "ai_news": [...],
    ...
  }
}
```

**Acceptance Criteria**:
- [ ] Digest page loads and displays
- [ ] Period selector works (daily/week/month/all)
- [ ] Summary is coherent and insightful
- [ ] Highlights show top items per category
- [ ] Themes extracted and displayed
- [ ] Links to full category digests work
- [ ] Responsive design

---

### P3 - Supporting Tasks

#### Bead: `code-intel-digest-hv1`
**Title**: Add 'daily' time period option (1 day) to all components  
**Priority**: 3 (Enhancement)  
**Effort**: 2-3 hours  
**Status**: Not Started  
**Depends On**: None  
**Blocks**: None (but needed for digest page)

**Description**:
Add support for daily (1-day/24-hour) time period alongside existing week/month/all-time options. This enables more frequent updates and allows users to stay current with daily changes.

**Components to Update**:
- `app/page.tsx` - Add "Daily" button
- `src/components/feeds/items-grid.tsx` - Type: `'day' | 'week' | 'month' | 'all'`
- `src/components/search/search-box.tsx` - Add daily option
- `src/components/qa/ask-box.tsx` - Add daily option
- `app/api/items/route.ts` - Map 'day' → 1 day
- `app/api/search/route.ts` - Add daily support

**Config Changes**:
```typescript
const PERIOD_DAYS: Record<string, number> = {
  day: 1,      // NEW
  week: 7,
  month: 30,
  all: 90,
};

const perSourceCaps = {
  day: 1,      // NEW: stricter for daily (1/source)
  week: 2,
  month: 3,
  all: 4,
};

const halfLifeMultipliers = {
  day: 0.5,    // NEW: 12 hours half-life for daily
  week: 1.0,
  month: 1.0,
  all: 1.0,
};
```

**Acceptance Criteria**:
- [ ] Daily button appears in UI
- [ ] Daily period works in digest tab
- [ ] Daily period works in search tab
- [ ] Daily period works in QA tab
- [ ] API endpoints support 'day' parameter
- [ ] Diversity caps applied correctly (1/source)
- [ ] Tests pass for daily period

---

## Dependencies & Critical Path

```
Start
  ├─ code-intel-digest-71d (search fix) - 4-6h
  ├─ code-intel-digest-hv1 (daily period) - 2-3h
  ├─ code-intel-digest-7jb (list format) - 3-4h
  │   └─ code-intel-digest-byv (digest page) - 4-5h
  └─ code-intel-digest-lv2 (embeddings) - 6-8h
      └─ code-intel-digest-hj4 (QA answers) - 5-7h

Critical Path: lv2 → hj4 (11-15h total)
Parallel Path: 71d + hv1 + 7jb → byv (13-18h total)

Total Time: 18-24 hours (all paths in parallel)
```

---

## Recommended Execution Order

### Day 1 Morning (3-4h)
- **code-intel-digest-71d**: Debug search ranking (start immediately, produces learnings)
- **code-intel-digest-hv1**: Add daily period (quick win, unblocks digest page)

### Day 1 Afternoon (3-4h)
- **code-intel-digest-7jb**: Convert UI to list format (visual improvement, tests digest design)
- Get feedback on list format before building digest page

### Day 2 Morning (4-5h)
- **code-intel-digest-lv2**: Set up embeddings infrastructure (foundational)
- Can work in parallel while UI changes test

### Day 2 Afternoon (4-5h)
- **code-intel-digest-hj4**: Implement QA answer generation (uses embeddings)
- Test QA page integration

### Day 3 (4-5h)
- **code-intel-digest-byv**: Build digest page (uses list format + LLM summary)
- Polish and testing

---

## Testing Strategy

### Unit Tests
- Search ranking with 'code search' query
- Embedding generation and caching
- Answer generation and source attribution
- Daily period calculations
- List format rendering

### Integration Tests
- End-to-end search flow
- End-to-end QA flow
- API responses for all periods (day/week/month/all)
- Digest page data aggregation

### Quality Gates
- TypeScript strict: 0 errors
- ESLint: 0 errors
- All tests passing
- Visual regression tests (list format)

---

## Success Metrics

By end of Phase 6:

| Metric | Target | Status |
|--------|--------|--------|
| Search quality | 'code search' → correct ranking | 🔄 Testing |
| UI format | List shows 1-10 ranking | 📋 To Do |
| Time periods | Daily/Week/Month/All-time | 📋 To Do |
| QA system | Answers + sources working | 📋 To Do |
| Digest page | Summary + highlights | 📋 To Do |
| TypeScript | 0 errors | ✅ Currently OK |
| ESLint | 0 errors | ✅ Currently OK |
| Tests | All passing | 📋 To Add |

---

**Created**: December 7, 2025  
**Last Updated**: December 7, 2025  
**Status**: Ready for Phase 6A
