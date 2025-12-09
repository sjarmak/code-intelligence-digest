# Phase 6: Architecture & Technical Decisions

**Date**: December 7, 2025  
**Status**: Architecture Finalized  
**Reference**: See PHASE6_PLAN.md for feature details

---

## System Architecture After Phase 6

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│                       USER INTERFACE                         │
│  • Digest (browsing) with daily/week/month/all periods      │
│  • Search (semantic + BM25 hybrid)                          │
│  • Ask (LLM answers with sources)                           │
│  • Content Digest Page (summary + highlights)               │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    API LAYER (Next.js)                      │
│  GET /api/items?category=&period=&limit=10                │
│  GET /api/search?q=&category=&period=&limit=10             │
│  GET /api/ask?question=&category=&period=                  │
│  GET /api/digest?period=                                   │
└────┬──────────┬──────────┬──────────┬─────────────────────┘
     │          │          │          │
     ▼          ▼          ▼          ▼
┌──────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐
│  RANKING │  │ SEARCH  │  │RETRIEVAL │  │ SUMMARY  │
│ PIPELINE │  │PIPELINE │  │PIPELINE  │  │GENERATION│
└────┬─────┘  └────┬────┘  └────┬─────┘  └────┬─────┘
     │             │             │            │
     ▼             ▼             ▼            ▼
  ┌────────────────────────────────────────────────────┐
  │             DATABASE LAYER (SQLite)                 │
  │  ├─ items (8,058 cached)                           │
  │  ├─ item_scores (pre-computed LLM)                 │
  │  ├─ embeddings (vectors, ~768 dims)                │
  │  ├─ cache_metadata                                 │
  │  └─ configuration                                  │
  └────────────────────────────────────────────────────┘
     │
     ▼
  ┌─────────────────────────────────────────┐
  │    DAILY SYNC (1x per day)              │
  │  • Fetch new items from Inoreader       │
  │  • Generate LLM scores (batch)          │
  │  • Generate embeddings (batch)          │
  │  • Save to database                     │
  └─────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. Ranking Pipeline (Existing, No Changes)

**File**: `src/lib/pipeline/rank.ts`

```typescript
rankCategory(items, category, periodDays)
  ├─ Filter by time window
  ├─ Build BM25 index
  ├─ Score with BM25 (category query)
  ├─ Load pre-computed LLM scores from DB
  ├─ Calculate recency score (exponential decay)
  ├─ Combine: LLM * w_llm + BM25 * w_bm25 + Recency * w_recency
  └─ Return sorted by finalScore
```

**Why No Changes**: This is optimal for digest browsing. We don't change it.

---

### 2. Search Pipeline (Modified)

**Files**: 
- `src/lib/pipeline/search.ts` (new semanticSearch function)
- `app/api/search/route.ts` (endpoint)

**Flow**:
```typescript
semanticSearch(query, items, limit)
  ├─ Generate query embedding
  ├─ Get cached item embeddings (or generate if missing)
  ├─ Compute cosine similarity
  ├─ Return top-K by similarity
  └─ Return as SearchResult[]

// In API:
GET /api/search
  ├─ Load items for category/period
  ├─ Call semanticSearch()
  ├─ REMOVED: No need to rerank (semantic scores are pure)
  └─ Return results
```

**Search Quality Fix** (For `code-intel-digest-71d`):
```typescript
// Option 1: Hybrid blending (if we want BM25 + semantic)
rerankWithSemanticScore(rankedItems, semanticScores, boostWeight = 0.5)
  ├─ Blend: finalScore * (1 - weight) + semanticScore * weight
  ├─ Higher weight (0.5) for search context
  └─ Re-sort and return

// Option 2: Pure semantic (simpler, faster)
// Just return semanticSearch results without blending
```

**Decision**: Start with Option 2 (pure semantic for search), fall back to Option 1 if needed.

---

### 3. Embeddings System (New)

**Files Created**:
- `src/lib/embeddings/generate.ts` - Batch embedding generation
- `src/lib/embeddings/index.ts` - Vector operations
- `src/lib/db/embeddings.ts` - Database layer

**Architecture**:
```typescript
// Generation (happens during daily sync)
async generateEmbedding(text: string): Promise<number[]>
  └─ Call OpenAI or Anthropic API, return 768-dim vector

async generateEmbeddingsBatch(items: FeedItem[])
  ├─ Batch items (e.g., 20 at a time)
  ├─ Generate embeddings in parallel
  ├─ Save to embeddings table
  └─ Update cache_metadata

// Retrieval (happens on user request)
async getEmbeddingsBatch(itemIds: string[]): Promise<Map<string, number[]>>
  ├─ Query embeddings table
  ├─ Return cached vectors
  └─ <100ms for 8000 items

// Vector Search
function topKSimilar(queryVector, candidates, k)
  ├─ Compute cosine similarity for each candidate
  ├─ Sort by similarity descending
  └─ Return top-K
```

**Database Schema**:
```sql
CREATE TABLE IF NOT EXISTS embeddings (
  item_id TEXT PRIMARY KEY,
  embedding BLOB,           -- Vector as binary (768 dims * 4 bytes)
  embedding_model TEXT,     -- "openai:text-embedding-3-small"
  created_at INTEGER,       -- Unix timestamp
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_embeddings_created_at ON embeddings(created_at);
```

**Cost Optimization**:
- Generate embeddings once during daily sync
- 1000 items → 1000 embeddings @ ~$0.02 total cost
- Retrieve via SQL (free)
- Vector search in-memory (instant)

---

### 4. Retrieval Pipeline (New)

**Files Created**:
- `src/lib/pipeline/retrieval.ts` - Top-K retrieval

**Architecture**:
```typescript
async retrieveRelevantItems(
  query: string,
  category: Category | null,
  periodDays: number,
  limit: number = 5
): Promise<RankedItem[]>
  ├─ Load items by category/period
  ├─ Generate query embedding
  ├─ Get all item embeddings from DB
  ├─ Compute cosine similarity scores
  ├─ Select top-K by similarity
  ├─ Rank using hybrid scoring (similarity + BM25 + LLM)
  └─ Return top RankedItem[]
```

**Hybrid Re-ranking (Optional)**:
```typescript
// If we want to boost retrieval results with other signals:
hybridScore = (
  semanticSim * 0.5 +           // Strong weight on semantic match
  bm25Score * 0.3 +              // Supporting BM25
  recencyScore * 0.15 +           // Boost recent items
  llmRelevance * 0.05            // LLM relevance as tiebreaker
)
```

**Computational Efficiency**:
- For 1000 items: cosine similarity = O(1000 * 768) = instant
- Top-K selection: O(1000) = instant
- Total: <50ms for 1000 items

---

### 5. Answer Generation (New)

**Files Created**:
- `src/lib/pipeline/answer.ts` - LLM synthesis
- `app/api/ask/route.ts` - Endpoint

**Architecture**:
```typescript
async generateAnswer(
  question: string,
  retrievedItems: RankedItem[],
  category?: string,
  period?: string
): Promise<{
  answer: string;
  sources: SourceAttribution[];
  reasoning: string;
}>
  ├─ Format retrieved items as context
  ├─ Build prompt:
  │  ├─ System: "You are Code Intelligence analyst"
  │  ├─ Context: Top-5 items with title/summary/source
  │  └─ User: Question
  ├─ Call Claude (or gpt-4o-mini)
  ├─ Parse response
  ├─ Extract source citations (use item IDs)
  └─ Return answer + sources
```

**System Prompt**:
```
You are an expert analyst of code intelligence content, developer tools, 
AI agents, and semantic search technologies.

Answer the user's question concisely (2-3 paragraphs max) using the provided articles.
Cite specific sources by title and mention at least 2-3 sources in your answer.

Format your response as:
[Answer paragraph 1]
[Answer paragraph 2]

Sources: [Title 1] ([URL]), [Title 2] ([URL])
```

**Cost Per Answer**:
- Input tokens: ~2000 (question + top-5 items)
- Output tokens: ~500 (answer)
- Claude Haiku: ~$0.001/answer
- GPT-4o mini: ~$0.0015/answer

**Caching Strategy**:
- Cache answers by (question_hash, category, period) for 24h
- Avoid regenerating same question multiple times

---

### 6. Digest Page (New)

**Files Created**:
- `src/components/digest/` (4 sub-components)
- `app/api/digest/route.ts` - Endpoint

**Architecture**:
```typescript
async generateDigest(period: string): Promise<{
  summary: string;
  themes: string[];
  highlights: Record<Category, RankedItem[]>;
  dateRange: { start: string; end: string };
}>
  ├─ Load top items for each category (period-filtered)
  ├─ Extract themes from items:
  │  ├─ Collect all LLM tags
  │  ├─ Count frequency
  │  └─ Return top 5-7 themes
  ├─ Generate summary with Claude:
  │  ├─ Context: themes + top 3 items
  │  └─ Output: 200-300 word narrative
  └─ Return structured response
```

**Summary Generation Prompt**:
```
Based on these code intelligence items from [period]:

Top themes: [theme1, theme2, ...]
Top articles: [title1, title2, title3, ...]

Generate a 200-300 word summary of the key developments and trends in:
- Code search and semantic search
- AI agents and agentic workflows
- Developer tools and productivity
- Enterprise codebases and scaling

Focus on actionable insights and key takeaways.
```

**Response Structure**:
```json
{
  "period": "week",
  "dateRange": {
    "start": "2025-12-01",
    "end": "2025-12-07"
  },
  "summary": "This week was dominated by advances in semantic search... [200+ words]",
  "themes": [
    "semantic search",
    "agents",
    "context management",
    "code tooling",
    "vector databases",
    "developer experience"
  ],
  "highlights": {
    "newsletters": [
      { "id": "...", "title": "...", "source": "...", "score": 8.5 },
      { "id": "...", "title": "...", "source": "...", "score": 8.2 },
      { "id": "...", "title": "...", "source": "...", "score": 7.9 }
    ],
    "ai_news": [...],
    "tech_articles": [...],
    ...
  }
}
```

---

## Data Flow Examples

### Example 1: Search for "code search"

```
User Input: "code search" [period=week]
   ↓
GET /api/search?q=code+search&period=week
   ↓
Load items (category=all, period=7d): 3,100 items
   ↓
Generate embedding for "code search"
   ↓
Get all 3,100 embeddings from DB
   ↓
Compute cosine similarity:
   ├─ Code Search Trigrams article: 0.95 ✅
   ├─ Anthropic Bun article: 0.40 ❌
   └─ ... (sorted descending)
   ↓
Return top-10 results
   ├─ #1: Code Search Trigrams (0.95)
   ├─ #2: Other relevant... (0.87)
   └─ ...
   ↓
UI: List format, ranked 1-10
```

### Example 2: Ask "How do agents handle context windows?"

```
User Input: "How do agents handle context windows?" [period=month]
   ↓
GET /api/ask?question=...&period=month
   ↓
Load all items (period=30d): 3,500 items
   ↓
Retrieve top-5 by semantic + hybrid scoring:
   ├─ Context management paper (relevance: 0.94)
   ├─ Agent framework article (relevance: 0.91)
   ├─ LLM context survey (relevance: 0.89)
   ├─ Pragmatic Engineer post (relevance: 0.85)
   └─ Advanced prompting guide (relevance: 0.83)
   ↓
Format context: [title, summary, source] for each
   ↓
LLM Prompt:
   System: "You are Code Intelligence analyst"
   Context: "Here are 5 recent articles..."
   Question: "How do agents handle context windows?"
   ↓
Claude generates answer:
   "Agents typically handle context windows through several strategies:
   
   1. Dynamic token budgeting...
   2. Hierarchical summarization...
   
   These approaches are detailed in [Context Paper], discussed in [Agent Framework],..."
   ↓
Extract sources and cite properly
   ↓
Return:
   {
     "answer": "Agents typically handle...",
     "sources": [
       { "id": "...", "title": "Context Management", "relevance": 0.94 },
       ...
     ]
   }
   ↓
UI: Display answer + source links
```

### Example 3: View Daily Digest

```
User navigates to: /digest?period=day
   ↓
GET /api/digest?period=day
   ↓
Load top items for each category (period=1d):
   ├─ newsletters: 3-5 items
   ├─ ai_news: 3-5 items
   ├─ tech_articles: 3-5 items
   └─ ... (other categories)
   ↓
Extract themes from all top items:
   count("agents") → 6 occurrences
   count("semantic search") → 5 occurrences
   ... (sort by frequency)
   ↓
Generate summary (Claude):
   Input: themes + top-3 from each category
   Output: "Today's code intelligence highlights: advances in agentic workflows,
            with strong focus on context management and semantic search..."
   ↓
Return:
   {
     "period": "day",
     "summary": "Today's code intelligence...",
     "themes": ["agents", "semantic search", "context", ...],
     "highlights": {
       "newsletters": [...],
       "ai_news": [...],
       ...
     }
   }
   ↓
UI: Display summary + highlights per category
```

---

## Database Schema Changes

### New Table: embeddings

```sql
CREATE TABLE IF NOT EXISTS embeddings (
  item_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  embedding_model TEXT DEFAULT 'openai:text-embedding-3-small',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX idx_embeddings_created_at ON embeddings(created_at);
CREATE INDEX idx_embeddings_model ON embeddings(embedding_model);
```

### No Changes Needed

- `items` table: OK (already has all needed fields)
- `item_scores` table: OK (LLM scores working)
- `cache_metadata` table: OK (can store embedding cache state)

---

## Cost Analysis

### OpenAI Embeddings
- Model: `text-embedding-3-small`
- Cost: $0.02 per 1M tokens
- For 1000 items (avg 200 tokens each): ~$0.004
- Daily: 1000 new items → ~$0.004/day → ~$1.50/year

### LLM Answers (Claude Haiku)
- Input: ~$0.80 per 1M tokens
- Output: ~$4.00 per 1M tokens
- Per answer: ~2000 tokens input, 500 tokens output
  - Cost: (2000 * 0.80 + 500 * 4.00) / 1M = $0.003
- Per user/day: 5 questions × $0.003 = $0.015/day → $5.50/year

### Digest Summaries (Claude Haiku)
- Per digest: ~3000 tokens input, 1000 tokens output
  - Cost: (3000 * 0.80 + 1000 * 4.00) / 1M = $0.006
- Per day: 1 summary × $0.006 = $0.006/day → $2.20/year

### Total Monthly Cost (Estimated)

For unlimited users:
```
Daily sync embeddings:   ~$0.004
Daily digest summary:    ~$0.006
User questions (500):    ~$1.50
_________________________
Total per day:          ~$1.51
Total per month:        ~$45
Total per year:         ~$550
```

vs. Phase 5 (pre-computed scores, no embeddings):
```
Daily sync LLM scores:   ~$0.10
No answer generation
No digest summaries
_________________________
Total per day:          ~$0.10
Total per month:        ~$3
Total per year:         ~$36
```

**Trade-off**: +$514/year for advanced QA + digest features

---

## Performance Targets

| Operation | Target | Method |
|-----------|--------|--------|
| Load items | <100ms | Database query |
| Generate query embedding | <200ms | OpenAI API |
| Retrieve top-K (1000 items) | <50ms | In-memory cosine |
| Rank retrieved items | <50ms | BM25 + scoring |
| Generate answer | <3s | Claude API |
| Render list UI | <100ms | React rendering |
| **Total API request (search)** | **<600ms** | Parallel + caching |
| **Total API request (QA)** | **<4s** | Embedding + retrieval + LLM |

---

## Security & Privacy

### No PII Handling
- All content is from public feeds (Inoreader)
- No user authentication needed (yet)
- No personal data stored

### Data Retention
- Items kept for 90 days
- Embeddings kept indefinitely (reusable)
- No user tracking or analytics

### API Security
- No authentication required (for MVP)
- Rate limiting recommended for production
- Log all requests for monitoring

---

## Migration Strategy

### Phase 6A (Week 1): Non-Breaking Changes
- Search ranking fix (internal)
- Daily period support (backwards compatible)
- List format UI (just styling)

### Phase 6B (Week 2): New Infrastructure
- Embeddings table creation (safe, new table)
- Retrieval pipeline (new code path)
- Answer generation (new endpoint)

### Phase 6C (Week 3): Integration
- Digest page (new page)
- Tests and quality gates
- Production deployment

**Zero downtime**: All changes are additive or isolated

---

**Created**: December 7, 2025  
**Status**: ✅ Architecture Finalized  
**Next**: Start Phase 6A implementation
