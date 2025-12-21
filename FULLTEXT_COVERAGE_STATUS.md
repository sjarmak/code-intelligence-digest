# Full Text Coverage Status

**Last Updated**: 2025-12-21

## Overall Coverage

| Metric | Value |
|--------|-------|
| **Total Items** | 11,431 |
| **Cached Items** | 1,542 |
| **Coverage** | **13.5%** |
| **Cache Size** | 14.1 MB |
| **Avg Text Length** | 9,589 chars |
| **Fetch Failures** | 326 (can retry) |

---

## By Category

### ✅ High Coverage (>90%)

| Category | Total | Cached | Coverage | Avg Length |
|----------|-------|--------|----------|-----------|
| **newsletters** | 288 | 280 | **97.2%** | 889 chars |
| **ai_news** | 26 | 24 | **92.3%** | 102 KB (!) |

**Status**: Ready for search ✅

---

### 🟡 Medium Coverage (25-50%)

| Category | Total | Cached | Coverage | Avg Length |
|----------|-------|--------|----------|-----------|
| **tech_articles** | 2,131 | 586 | **27.5%** | 17.8 KB |
| **podcasts** | 25 | 8 | **32.0%** | 29.8 KB |

**Status**: Partially ready. Recommend populating more.

---

### 🔴 Low Coverage (<10%)

| Category | Total | Cached | Coverage | Avg Length |
|----------|-------|--------|----------|-----------|
| **community** | 2,918 | 280 | **9.6%** | 2.4 KB |
| **product_news** | 1,058 | 64 | **6.0%** | 5.6 KB |
| **research** | 4,985 | 300 | **6.0%** | 1.3 KB |

**Status**: Not prioritized yet.

---

## Search Impact

### Current State
- **Newsletters & AI News**: Full text fully leveraged ✅
- **Tech Articles**: ~30% of searches will use full text
- **Other categories**: Fallback to summary/snippet

### With Hybrid Search
Since hybrid search combines BM25 + semantic:
- **BM25 scoring** benefits from full text (keyword matches)
- **Semantic scoring** includes full text in embedding (first 2000 chars)
- Better results even without 100% coverage

**Example**: Search for "rust memory safety"
- 30% of tech_articles have full text → BM25 finds matches in full text
- 70% of tech_articles use summaries → Still matches via keywords in titles
- Hybrid ranking combines both approaches

---

## Population Strategy

### Option 1: Quick (High-Value First)
Already done:
- ✅ newsletters: 97%
- ✅ ai_news: 92%
- ✅ tech_articles: 27.5% (586 items)

**Next tier** (recommended):
```bash
# Populate more tech_articles (1,545 remaining)
npx tsx scripts/populate-fulltext-fast.ts
# Category: tech_articles, limit: 500
# Estimated: 15-30 minutes
```

### Option 2: Comprehensive (All Categories)
Continue with all categories:
```bash
npx tsx scripts/populate-fulltext-fast.ts
# All remaining items
# Estimated: 2-4 hours
```

### Option 3: Research-Focused
Populate research papers (4,985 items):
```bash
# Requires special handling for arXiv
# Current: 6% (300 items)
# Remaining: 4,685 items
# Estimated: 1-2 hours
```

---

## Current Fetch Success Rate

| Source | Count |
|--------|-------|
| web_scrape | 1,216 (79%) |
| arxiv | 0 (0%) |
| error | 326 (21%) |

### Common Failures
- HTTP 403 (paywalls): economist.com, wsj, etc.
- Content too short/non-HTML: anna's archive, maps
- Connectivity: Temporary network issues

**Note**: Failures are recorded. Safe to retry.

---

## Cache Metadata

### Size Analysis
- **Total cache**: 14.1 MB
- **Per item average**: 9.1 KB
- **Database**: Compact SQLite (BLOB-friendly)

### Performance Impact
- Minimal: Full text stored in single TEXT column
- Indexes on `category`, `published_at` handle queries
- Embedding cache (768-dim vectors) separate table

---

## Recommendation

### For Search Quality
**Priority**: Populate **tech_articles** more (currently 27.5%)
- 2,131 items total, 586 cached, 1,545 remaining
- Highest value for code intelligence use case
- Quick to fetch (mostly text-based)
- **Action**: Run `populate-fulltext-fast.ts` for 500-1000 more

### For Coverage Completeness
**Next**: **research** category (4,985 papers, only 6% cached)
- arXiv papers available via API
- Academic sources
- Best for full text extraction
- **Action**: Extend script to handle arXiv properly

### For Balanced Approach
**Roadmap**:
1. ✅ Done: newsletters (97%), ai_news (92%)
2. 🔄 In progress: tech_articles (27.5% → target 50%)
3. 🚀 Next: research (6% → target 25%)
4. 📊 Long-term: community, product_news (lower priority)

---

## Implementation Details

### Database Schema
```sql
-- Full text columns in items table
full_text TEXT              -- Cached article content
full_text_fetched_at INT    -- Unix timestamp
full_text_source TEXT       -- 'web_scrape' | 'arxiv' | 'error'
```

### Fetching Logic (Current)
```typescript
// If URL contains arxiv.org → Use arXiv API
if (url.includes("arxiv")) {
  const summary = await fetchFromArxiv(arxivId);
  // Returns abstract from arXiv XML
}

// Otherwise → Web scraping
const html = await fetch(url);
const text = extractTextFromHTML(html);
```

### Rate Limiting
- 1 request per 500ms per domain
- Max 10-second timeout
- 3 retries with exponential backoff

---

## API Usage with Full Text

### Hybrid Search
Full text automatically included:
```bash
curl "http://localhost:3000/api/search?q=rust&type=hybrid"
```

BM25 scores items matching full text keywords.
Embeddings include full text (first 2000 chars).

### Semantic Search
Full text included in embeddings:
```bash
curl "http://localhost:3000/api/search?q=memory+safety&type=semantic"
```

First 2000 chars of full text added to embedding text.

### Keyword Search
Full text scored for term matches:
```bash
curl "http://localhost:3000/api/search?q=webassembly&type=keyword"
```

Term matches in full text count toward score.

---

## Next Steps

### Immediate (Today)
✅ **Done**: Populate high-value categories (newsletters, ai_news, tech_articles)

### Short-term (This Week)
- [ ] Run population script for remaining tech_articles (1,545 items)
- [ ] Monitor cache size (currently 14.1 MB)
- [ ] Test search quality improvement

### Medium-term (This Month)
- [ ] Populate research category (4,985 papers)
- [ ] Consider arXiv API integration
- [ ] Monitor cache hit rates

### Long-term (Next Quarter)
- [ ] Replace pseudo-embeddings with real embeddings (OpenAI)
- [ ] Add reranking with LLM
- [ ] Build search quality metrics
- [ ] Populate remaining categories

---

## Cleanup/Management

### Clear All Full Text
```bash
sqlite3 .data/digest.db "UPDATE items SET full_text = NULL, full_text_source = NULL, full_text_fetched_at = NULL"
```

### Clear Failed Fetches Only
```bash
sqlite3 .data/digest.db "UPDATE items SET full_text = NULL, full_text_source = NULL WHERE full_text_source = 'error'"
```

### Check Cache Size
```bash
sqlite3 .data/digest.db "SELECT ROUND(SUM(LENGTH(full_text)) / 1024.0 / 1024.0, 2) FROM items WHERE full_text IS NOT NULL"
```

---

## Summary

| Aspect | Status |
|--------|--------|
| **Overall Coverage** | 13.5% (1,542 / 11,431 items) |
| **High Priority Categories** | ✅ 95%+ (newsletters, ai_news) |
| **Medium Priority** | 🟡 30% (tech_articles, podcasts) |
| **Low Priority** | 🔴 <10% (community, product, research) |
| **Search Integration** | ✅ Working (BM25 + semantic) |
| **Cache Size** | 14.1 MB (manageable) |
| **Fetch Success Rate** | 79% (326 failures can retry) |

**Recommendation**: Populate tech_articles more for better search results. Current coverage sufficient for hybrid search to work well.
