# Metadata & Context Available for Relevance Ranking and RAG

This document maps the metadata extracted from each content source and how it flows through the ranking and RAG pipelines.

## Core Metadata Model (FeedItem)

All items are normalized to this structure:

```typescript
interface FeedItem {
  id: string;                    // Unique Inoreader item ID
  streamId: string;              // Feed/source ID from Inoreader
  sourceTitle: string;           // Normalized feed name
  title: string;                 // Item title
  url: string;                   // Canonical/alternate article URL
  author?: string;               // Author name (when available)
  publishedAt: Date;             // Publication timestamp
  summary?: string;              // Full HTML summary/content from feed
  contentSnippet?: string;       // Truncated summary (max 500 chars)
  categories: string[];          // Inoreader user labels/folders
  category: Category;            // Normalized category (newsletters, podcasts, etc.)
  raw: unknown;                  // Raw Inoreader API response (preserved for extension)
}
```

## Per-Category Metadata Availability

### 1. **Newsletters** 
- **Sources**: Curated newsletters (Pragmatic Engineer, specialized dev newsletters)
- **Available Metadata**:
  - ✅ Title, author, publication date (always)
  - ✅ Full HTML summary/content (via `summary.content` from Inoreader)
  - ✅ URL to original article
  - ✅ Source/newsletter name
  - ✅ Inoreader user categories/labels
  - ⚠️  Author often equals newsletter name, not individual writer
  - ⚠️  No engagement metrics from Inoreader
  
- **RAG Context Available**:
  - Full newsletter body text for retrieval
  - Title + summary for relevance matching
  - Publication date for temporal grounding

---

### 2. **Podcasts**
- **Sources**: Tech podcasts (RSS feeds), podcast platforms
- **Available Metadata**:
  - ✅ Episode title
  - ✅ Episode description/summary (via feed)
  - ✅ Publication date
  - ✅ Podcast name (sourceTitle)
  - ✅ Episode URL
  - ⚠️  No audio transcript (would require separate API)
  - ⚠️  No guest/speaker info extracted from RSS
  - ⚠️  No duration/engagement metrics
  
- **RAG Context Available**:
  - Episode description for summary-based retrieval
  - Title for keyword matching
  - Metadata only (no transcripts unless manually added)
  - **Limitation**: Cannot do deep semantic search on audio content

---

### 3. **Tech Articles** (blogs, essays, thought leadership)
- **Sources**: Engineering blogs, Medium, dev.to, technical essays
- **Available Metadata**:
  - ✅ Article title
  - ✅ Author name
  - ✅ Publication date
  - ✅ Full article text (via `summary.content`)
  - ✅ Source blog/platform name
  - ✅ URL to original
  - ✅ Inoreader user labels
  - ⚠️  No canonical tags/categories from original site
  - ⚠️  No engagement metrics (comments, views, shares)
  
- **RAG Context Available**:
  - Full article text for dense retrieval
  - Excellent for semantic search and BM25
  - Author + date for attribution
  - Title for quick matching

---

### 4. **AI News** (model releases, research, infra updates)
- **Sources**: AI company announcements, ArXiv, ML newsletters
- **Available Metadata**:
  - ✅ Announcement/article title
  - ✅ Publication date
  - ✅ Summary/body text
  - ✅ Source (OpenAI, Anthropic, arXiv, etc.)
  - ✅ URL
  - ⚠️  Paper titles sometimes differ from ArXiv metadata
  - ⚠️  No structured model metadata (architecture, params, performance)
  - ⚠️  No access to actual papers/model cards
  
- **RAG Context Available**:
  - Announcement text for relevance scoring
  - Title for model/researcher identification
  - Publication date for temporal signals
  - **Enhancement opportunity**: Link to model cards, papers via ArXiv/HuggingFace APIs

---

### 5. **Product News** (releases, changelogs, feature announcements)
- **Sources**: GitHub releases, official changelogs, tool websites
- **Available Metadata**:
  - ✅ Product name / release title
  - ✅ Release date
  - ✅ Changelog/feature descriptions (via summary)
  - ✅ Product URL
  - ✅ Source product name
  - ⚠️  No version numbers extracted
  - ⚠️  No breaking changes flagged
  - ⚠️  No dependency info (for tool chains)
  
- **RAG Context Available**:
  - Changelog text for feature matching
  - Title for product identification
  - Date for timeliness signals
  - **Enhancement opportunity**: Parse semantic versioning, extract breaking changes

---

### 6. **Community** (Reddit, forums, discussion posts)
- **Sources**: Reddit, HackerNews, dev.to, forums
- **Available Metadata**:
  - ✅ Post title
  - ✅ Post body/summary (truncated from HTML)
  - ✅ Publication date
  - ✅ Source community (subreddit, forum)
  - ✅ URL to post
  - ⚠️  **No engagement metrics available** (upvotes, comments count) from RSS feed
  - ⚠️  No author reputation
  - ⚠️  No linked discussion context
  
- **RAG Context Available**:
  - Post text for semantic search
  - Discussion title for relevance
  - Community name for source attribution
  - **Limitation**: Cannot use upvote signals via RSS; would need direct API access
  
- **Database Schema Note**:
  ```typescript
  engagementScore?: number;  // Prepared for community, but not currently populated from RSS
  ```

---

### 7. **Research** (arXiv, academic papers, empirical studies)
- **Sources**: arXiv, research papers via feeds/newsletters
- **Available Metadata**:
  - ✅ Paper title
  - ✅ Authors (sometimes)
  - ✅ Publication date (arXiv date)
  - ✅ Abstract/summary (from feed)
  - ✅ URL to paper
  - ⚠️  No full paper text (would require PDF extraction)
  - ⚠️  No citation count (would need external API)
  - ⚠️  No methodology/results structured data
  
- **RAG Context Available**:
  - Abstract for semantic relevance
  - Title for topic matching
  - Author names for expertise signals
  - Publication date for recency
  - **Enhancement opportunity**: Direct arXiv API for citation metrics, link to full paper PDFs

---

## Metadata Extraction Pipeline

### Normalization (normalize.ts)
Raw Inoreader API → `FeedItem`:
```
InoreaderArticle {
  id, title, author, published, summary.content
  origin { streamId, title }
  categories (user labels)
  canonical/alternate (URLs)
}
    ↓
FeedItem {
  id, title, author, publishedAt, summary, contentSnippet
  streamId, sourceTitle, url
  categories, category (mapped)
  raw (full object preserved)
}
```

### Feed Configuration (feeds.ts)
Maps streamId → category via folder heuristics:
- Inoreader folder/label name patterns matched against fixed dictionary
- Fallback to "newsletters" if no match
- Preserves all user labels in `categories` field
- Also captures vendor domain (e.g., "github.com", "medium.com")

### Scoring Inputs (model.ts, llmScore.ts, bm25.ts)

**LLM Scoring** uses:
```
Input: title, sourceTitle, summary
Output: { relevance: 0-10, usefulness: 0-10, tags: string[] }
```
Tags are domain-specific: `["code-search", "agent", "context", "research", "devex", ...]`

**BM25 Scoring** uses:
```
Document text = title + summary + sourceTitle + (categories/tags)
Query = category-specific domain terms + weighted keywords
```

**Recency Scoring** uses:
```
publishedAt + category half-life:
  - Newsletters: 3 days
  - AI News: 2 days
  - Podcasts: 7 days
  - Research: 10 days
  - Others: 4-5 days
```

**Engagement Scoring** (community only):
```
Field prepared: engagementScore in itemScores table
Current: populated from starredItems.relevanceRating (manual curation)
Opportunity: populate from Reddit upvotes/comments via secondary API
```

---

## Database Storage (schema.ts)

All normalized metadata stored in SQLite:

### `items` Table
```sql
id TEXT PRIMARY KEY
stream_id TEXT                -- Links to feeds.streamId
source_title TEXT            -- Normalized source name
title TEXT                   -- Item title
url TEXT                     -- Canonical URL
author TEXT                  -- Optional author
published_at INTEGER         -- Unix timestamp
summary TEXT                 -- Full HTML summary (~10-50KB per item)
content_snippet TEXT         -- Truncated (~500 chars)
categories TEXT              -- JSON array of user labels
category TEXT                -- Primary category (newsletters, tech_articles, etc.)
created_at, updated_at       -- Sync metadata
```

### `item_scores` Table
```sql
item_id, category, period
bm25_score REAL             -- 0-1 normalized per category/window
llm_relevance INTEGER       -- 0-10 raw
llm_usefulness INTEGER      -- 0-10 raw
llm_tags TEXT               -- JSON array
recency_score REAL          -- 0-1 with decay
engagement_score REAL       -- 0-1 (community items)
final_score REAL            -- Composite: 0-1
reasoning TEXT              -- Human-readable explanation
scored_at INTEGER           -- Timestamp (for score history)
```

### `starred_items` Table
```sql
item_id, inoreader_item_id
relevance_rating INTEGER    -- 0-3: unset, low, medium, high
notes TEXT                  -- User curation notes
starred_at, rated_at        -- Temporal signals
```

---

## Context Available for RAG

### Immediate RAG Sources (Low Latency)
1. **FeedItem.summary** — Full article/post text (best for dense retrieval)
2. **FeedItem.title** — For lexical matching and BM25
3. **FeedItem.author** — For credibility/expertise signals
4. **FeedItem.sourceTitle** — For source filtering/weighting
5. **Category + LLM tags** — For intent/domain filtering

### Stored Historical Scores
- **itemScores table** — Full scoring history per item
- Enables A/B testing, score adjustments, reasoning reconstruction

### User Curation Layer (starredItems)
- Starred items with manual relevance ratings (0-3)
- User notes on why item was valuable
- Acts as training signal for future scoring

---

## Gaps & Enhancement Opportunities

### Data Missing from RSS
1. **Engagement metrics** (upvotes, comments, shares)
   - **Fix**: Direct API access to Reddit, HN, etc.
   
2. **Transcripts** (for podcasts)
   - **Fix**: Use Deepgram, Rev, or similar API
   
3. **Full paper PDFs** (for research)
   - **Fix**: Direct arXiv/paper API integration
   
4. **Author reputation** (community posts)
   - **Fix**: Cache user karma/history via platform APIs
   
5. **Structured data** (model cards, changelogs)
   - **Fix**: Parse markdown/structured formats into fields

### Extraction Enhancements
1. **Semantic section parsing** — Extract key findings, methodology, results
2. **Entity extraction** — Products, authors, companies mentioned
3. **Structured data** — Models, libraries, tools discussed
4. **Cross-references** — Detect related items, citations

### RAG Enhancements
1. **Embedding-based retrieval** — Hybrid keyword + semantic
2. **Multi-hop reasoning** — Connect related items across categories
3. **Temporal analysis** — Track how topics evolve over time
4. **Source credibility scoring** — Adjust retrieval weights per source

---

## Summary Table

| Category | Title | Author | Date | Full Text | URL | Engagement | Structured |
|----------|-------|--------|------|-----------|-----|------------|-----------|
| Newsletters | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Podcasts | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | ❌ | ❌ |
| Tech Articles | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| AI News | ✅ | ⚠️ | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| Product News | ✅ | ⚠️ | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| Community | ✅ | ⚠️ | ✅ | ✅ | ✅ | ❌* | ❌ |
| Research | ✅ | ✅ | ✅ | ⚠️ | ✅ | ❌ | ❌ |

\* Community engagement available via dedicated API, not RSS
