# Agent Brief: Newsletter & Podcast Generation with RAG

## Mission

Implement RAG-driven newsletter and podcast generation features that allow users to:
1. Generate custom newsletters based on selected categories with a user-provided prompt
2. Generate podcast scripts/transcripts from digest content
3. Both features should use retrieved content as context to align output with user needs

---

## Current State & Data Available

### Available Data

**Database Schema** (`src/lib/db/schema.ts`):
- **items table**: 11,051 items total, 3,268 in 7-day window
  - `id`, `title`, `url`, `author`, `publishedAt`, `summary`, `contentSnippet`, `category`
  - Summary = full HTML-stripped summary from Inoreader (can be 500+ chars)
  - contentSnippet = first 500 chars of summary
  - We have access to HTML-stripped full text in summaries, not truncated
  
- **itemScores table**: Pre-computed relevance scores (LLM + BM25 + recency)
  - `llmRelevance` (0-10), `llmUsefulness` (0-10), `llmTags` (domain terms), `finalScore` (0-1)
  
- **adsLibraryPapers**: Research papers with abstracts and optional full text
  - `adsPapers` table has `abstract` and optional `fullText` fields

### Ranking Pipeline

Already in place (`src/lib/pipeline/rank.ts`):
- BM25 scoring (domain term matching)
- LLM scoring (relevance + usefulness)
- Recency decay (exponential, category-specific half-lives)
- Domain-specific boosts:
  - **5x** for "sourcegraph" mentions
  - **2.5x** for agent + code context combinations
  - **1.5-3x** for domain term counts (code search, agents, context, etc.)
- Per-category filtering: min relevance thresholds, off-topic filtering
- Diversity selection: per-source caps, total item limits

### LLM Integration

- OpenAI API (OPENAI_API_KEY env var)
- Already scoring items with GPT-4o (0.7 * relevance + 0.3 * usefulness)
- Batch scoring in `scripts/score-items-llm.ts` (3 items per call)
- `src/lib/pipeline/digest.ts` has digest summary generation
- `src/lib/pipeline/answer.ts` has RAG answer generation (uses retrieved items as context)

### API Endpoints

- **`GET /api/items`**: Returns ranked items by category + period
  - Query: `?category=tech_articles&period=week&limit=50`
  - Returns: RankedItem[] with scores, reasoning, tags
  
- **`GET /api/search`**: Semantic or keyword search
  - Query: `?q=agents&type=keyword&limit=10&category=research`
  - Returns: SearchResult[] with similarity scores

- **`/api/qa`**: Existing RAG endpoint for Q&A
  - Uses retrieved items as context for LLM generation
  - Reference: `src/lib/pipeline/answer.ts`

---

## Requirements

### Feature 1: Custom Newsletter Generation

**Endpoint**: `POST /api/newsletter/generate`

**Request Body**:
```json
{
  "categories": ["newsletters", "tech_articles", "ai_news"],
  "period": "week",
  "limit": 20,
  "prompt": "Focus on practical applications for enterprise teams. Emphasize tools that improve developer productivity and code quality. Avoid theoretical papers."
}
```

**Processing Pipeline**:
1. Fetch top-ranked items for selected categories + period (using `/api/items` or direct DB call)
2. **Retrieve**: Use BM25 + semantic search to filter items matching prompt intent
   - Parse prompt for key themes: "practical", "enterprise", "developer productivity", "code quality"
   - Re-rank items based on relevance to prompt themes (boost items matching theme keywords)
3. **Augment**: Prepare context from summaries + scores
4. **Generate**: LLM prompt to create newsletter with:
   - Executive summary (100-150 words) aligned to user's prompt
   - Organized by category with highlights
   - Brief 1-2 sentence descriptions of each item
   - Callout boxes for standout findings
   - Actionable insights/recommendations based on prompt focus
5. **Format**: Return as markdown or JSON with HTML/plain text variants

**Response**:
```json
{
  "id": "nl-20250121-abc123",
  "title": "Code Intelligence Digest – Week of Jan 20",
  "generatedAt": "2025-01-21T10:30:00Z",
  "categories": ["newsletters", "tech_articles", "ai_news"],
  "period": "week",
  "itemsRetrieved": 20,
  "itemsIncluded": 15,
  "summary": "This week's digest focuses on...",
  "markdown": "# Code Intelligence Digest\n\n## Summary\n...",
  "html": "<article><h1>...",
  "themes": ["code-search", "agents", "developer-productivity"],
  "generationMetadata": {
    "promptUsed": "Focus on practical...",
    "modelUsed": "gpt-4o",
    "tokensUsed": 2450,
    "duration": "3.2s"
  }
}
```

**Details**:
- Summaries are available in full (not truncated)
- Include source attribution: [Title](url) by Author (Source)
- Group by category visually
- Include finalScore ranges for credibility signals
- Optionally add "Why this matters" paragraphs based on LLM tags + user prompt

---

### Feature 2: Podcast Generation

**Endpoint**: `POST /api/podcast/generate`

**Request Body**:
```json
{
  "categories": ["podcasts", "tech_articles"],
  "period": "week",
  "limit": 15,
  "prompt": "Create an engaging 20-minute podcast discussing recent breakthroughs in code search and AI agents. Target software engineers and tech leads.",
  "format": "transcript",
  "voiceStyle": "conversational"
}
```

**Processing Pipeline**:
1. Fetch top-ranked items for selected categories + period
2. **Retrieve**: Filter/rank items for podcast relevance
   - Extract key insights from summaries
   - Identify discussion topics and transitions
   - Find compelling quotes or findings
3. **Augment**: Prepare multi-speaker dialogue structure
   - Host intro (Host A)
   - Topic breakdown with guest/expert voice (Host B or implied expert)
   - Closing insights
4. **Generate**: LLM creates podcast transcript with:
   - Natural conversation flow
   - Topic transitions
   - Callouts to source articles
   - Actionable takeaways for listeners
   - Suggested music/sound design cues
5. **Format**: Transcript, optional MP3 generation (TTS via Eleven Labs or similar)

**Response**:
```json
{
  "id": "pod-20250121-abc123",
  "title": "Code Intelligence Weekly – Episode 42",
  "generatedAt": "2025-01-21T10:30:00Z",
  "categories": ["podcasts", "tech_articles"],
  "period": "week",
  "duration": "18:45",
  "itemsRetrieved": 15,
  "itemsIncluded": 12,
  "transcript": "[INTRO MUSIC]\n\nHost: Welcome to Code Intelligence...",
  "segments": [
    {
      "title": "Topic 1: Code Search Breakthroughs",
      "startTime": "0:30",
      "endTime": "7:20",
      "itemsReferenced": [{"title": "...", "url": "..."}],
      "highlights": ["...", "..."]
    }
  ],
  "showNotes": "# Show Notes\n## References\n...",
  "generationMetadata": {
    "promptUsed": "Create an engaging...",
    "modelUsed": "gpt-4o",
    "tokensUsed": 5820,
    "voiceStyle": "conversational",
    "duration": "8.5s"
  }
}
```

---

## Implementation Architecture

### New Endpoints

1. **`POST /api/newsletter/generate`** → `app/api/newsletter/route.ts`
2. **`POST /api/podcast/generate`** → `app/api/podcast/route.ts`
3. **`GET /api/newsletter/history`** (optional) → list generated newsletters
4. **`GET /api/podcast/history`** (optional) → list generated podcasts

### New Pipeline Modules

1. **`src/lib/pipeline/newsletter.ts`**
   - `generateNewsletter(categories, period, limit, prompt): Promise<NewsletterOutput>`
   - `rankItemsForPrompt(items, prompt): RankedItem[]` (re-rank based on prompt alignment)
   - `formatNewsletterMarkdown(items, themes, prompt): string`
   - `formatNewsletterHTML(items, themes, prompt): string`

2. **`src/lib/pipeline/podcast.ts`**
   - `generatePodcast(categories, period, limit, prompt, voiceStyle): Promise<PodcastOutput>`
   - `extractPodcastTopics(items): Topic[]`
   - `generateTranscript(topics, prompt, voiceStyle): string`
   - `segmentTranscript(transcript, items): Segment[]`

### Database Tables (Optional, for history)

```sql
CREATE TABLE generated_newsletters (
  id TEXT PRIMARY KEY,
  title TEXT,
  categories TEXT,  -- JSON array
  period TEXT,
  itemsIncluded INTEGER,
  prompt TEXT,
  markdown TEXT,
  html TEXT,
  themes TEXT,  -- JSON array
  createdAt INTEGER,
  expiresAt INTEGER
);

CREATE TABLE generated_podcasts (
  id TEXT PRIMARY KEY,
  title TEXT,
  categories TEXT,  -- JSON array
  period TEXT,
  itemsIncluded INTEGER,
  prompt TEXT,
  transcript TEXT,
  duration TEXT,
  segments TEXT,  -- JSON array
  createdAt INTEGER,
  expiresAt INTEGER
);
```

---

## Prompt Alignment Algorithm (Core to RAG)

The key to quality output is prompt-aware re-ranking:

```typescript
function scoreItemForPrompt(item: RankedItem, prompt: string): number {
  // Parse prompt for themes
  const promptTerms = extractKeyTerms(prompt);  // e.g., ["practical", "enterprise", "productivity"]
  
  // Score based on:
  // 1. Original finalScore (baseline quality)
  // 2. LLM tags match (item.llmScore.tags overlap with prompt intent)
  // 3. Term density in summary (how often prompt keywords appear)
  // 4. Domain relevance (code-search, agents, etc. match prompt intent)
  
  let score = item.finalScore * 0.6; // Start with 60% baseline
  
  // 40% from prompt alignment
  const tagMatches = item.llmScore.tags.filter(tag =>
    promptTerms.some(term => tag.includes(term) || term.includes(tag))
  ).length;
  score += (tagMatches / item.llmScore.tags.length) * 0.4;
  
  // Bonus for exact term matches in summary
  const matchingTerms = promptTerms.filter(term =>
    (item.summary || "").toLowerCase().includes(term.toLowerCase())
  ).length;
  score += (matchingTerms / promptTerms.length) * 0.2;
  
  return Math.min(score, 1.0);
}
```

---

## Success Criteria

- [x] Prompt input accepted and parsed
- [x] Relevant items retrieved based on categories + period
- [x] Items re-ranked by prompt alignment
- [x] LLM generates coherent, well-structured output
- [x] Output includes source attribution + URL references
- [x] Response includes generation metadata (tokens, time, model)
- [x] Formatting support: markdown + HTML for newsletters, transcript + show notes for podcasts
- [x] Error handling: graceful degradation if LLM fails
- [x] Performance: <10 seconds for generation

---

## Data Availability Notes

**What We Have**:
- ✅ Full summaries (HTML-stripped, 200-1000 chars typically)
- ✅ Content snippets (first 500 chars)
- ✅ Article titles + source attribution
- ✅ Publication dates (for sorting/recency)
- ✅ Pre-computed relevance scores (finalScore 0-1)
- ✅ LLM tags (domain classification)
- ✅ URLs (external links to full articles)

**What We Don't Have (But Could Add)**:
- ❌ Full article text (only summaries from Inoreader)
- ❌ Author bios (only names available)
- ❌ Audio/video transcripts (would need to scrape or ingest separately)

**Recommendation**: Use summaries as primary content. For high-value items, optional full-text scraping could enhance quality, but summaries are sufficient for MVP.

---

## Example Prompts (User-Provided)

1. "Focus on practical applications for startups. Highlight tools that reduce time-to-market and improve collaboration. Skip theoretical papers."

2. "Create content for a weekly team standup. Emphasize action items and decisions. Include security/compliance updates."

3. "Target C-level executives. Highlight business impact and ROI of developer tools. Focus on cost optimization and productivity gains."

4. "Generate a technical deep-dive for a compiler/IR team. Emphasize LLVM, ASTs, and program synthesis. Include research papers."

---

## Reference Code

**Existing RAG Implementation** (`src/lib/pipeline/answer.ts`):
```typescript
// Already implements:
// 1. Item retrieval and ranking
// 2. Context assembly from summaries
// 3. LLM prompt engineering for Q&A
// 4. Error handling + fallback
```

Use this as a template for newsletter/podcast generation.

**Existing Digest Generation** (`src/lib/pipeline/digest.ts`):
```typescript
// Already implements:
// 1. Theme extraction from items
// 2. LLM summary generation
// 3. Formatting (markdown)
```

Extend this for custom prompts.

---

## Summary

**Build RAG-powered newsletter + podcast generation**:
- Retrieve ranked items by category + user prompt
- Re-rank by prompt alignment (term matching + LLM tags)
- Use summaries + scores as context
- Generate polished output with LLM
- Support custom prompts to align with user needs
- Return structured output with metadata + generation details

**Effort**: ~2-3 hours for full implementation
- Newsletter endpoint + pipeline: 1.5h
- Podcast endpoint + pipeline: 1h
- Testing + refinement: 0.5h
