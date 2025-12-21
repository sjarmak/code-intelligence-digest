# Ready to Brief: Newsletter & Podcast Generation Feature

## Quick Summary

You can now brief an agent to implement newsletter and podcast generation with the following context:

### What's Already in Place
- ✅ Full text summaries available in database (up to 1000 chars, not truncated)
- ✅ Pre-computed relevance scores (LLM + BM25 + recency)
- ✅ Existing RAG infrastructure (`src/lib/pipeline/answer.ts`)
- ✅ Existing digest generation (`src/lib/pipeline/digest.ts`)
- ✅ 11,051 items with 3,268 in 7-day window
- ✅ LLM integration ready (OpenAI API, batch processing)
- ✅ Domain term tagging system (code search, agents, context, etc.)

### What Needs to Be Built
1. **Newsletter Generation API** (`POST /api/newsletter/generate`)
   - Accept selected categories + user prompt
   - Retrieve + rank items by prompt alignment
   - Generate markdown/HTML with proper formatting
   
2. **Podcast Generation API** (`POST /api/podcast/generate`)
   - Accept categories + user prompt + format preference
   - Generate transcript with natural dialogue flow
   - Include show notes + segment timestamps

### Key Technical Details
- Items have: `title`, `summary` (full), `contentSnippet`, `url`, `author`, `publishedAt`, `category`
- Scores available: `finalScore` (0-1), `llmRelevance` (0-10), `llmTags` (domain terms)
- Re-ranking algorithm: Prompt term matching + LLM tag overlap + domain relevance
- API design: Accept user prompt + categories → Return structured output with metadata

### Data Constraints
- **Have**: Summaries (not full article text), titles, authors, publication dates, URLs
- **Don't have**: Full article scraping (summaries sufficient for MVP)
- **Can fetch on demand**: Direct article links for users to read full content

---

## Files to Brief the Agent

Point the agent to:
1. **AGENT_BRIEF_NEWSLETTER_PODCAST.md** (comprehensive requirements)
2. **src/lib/pipeline/answer.ts** (existing RAG implementation to extend)
3. **src/lib/pipeline/digest.ts** (existing digest generation to extend)
4. **app/api/items/route.ts** (ranking API reference)
5. **src/lib/model.ts** (FeedItem + RankedItem types)

---

## What Data Is Actually Available

From the `items` table:
```typescript
{
  id: string;
  title: string;                    // e.g., "Sourcegraph 5.0 Release"
  url: string;                      // External link
  sourceTitle: string;              // e.g., "Sourcegraph Blog"
  author?: string;                  // e.g., "Sarah Chen"
  publishedAt: Date;               // Full publication date
  summary: string;                  // FULL summary (not truncated), 200-1000 chars
  contentSnippet: string;           // First 500 chars of summary
  category: string;                 // newsletters, tech_articles, etc.
  categories: string[];             // Multi-category tags
}
```

From the `itemScores` table (pre-computed):
```typescript
{
  finalScore: number;               // 0-1 (combined score)
  llmRelevance: number;            // 0-10 (LLM rated)
  llmUsefulness: number;           // 0-10 (LLM rated)
  llmTags: string[];               // ["code-search", "agents", "context", ...]
  bm25Score: number;               // 0-1 (term matching)
  recencyScore: number;            // 0-1 (decay based on publication date)
  reasoning: string;               // Why item was ranked this way
}
```

**Key insight**: We have summaries as context, which is sufficient for RAG. Full article scraping is optional enhancement.

---

## Prompt to Send to Agent

You can copy-paste this or use AGENT_BRIEF_NEWSLETTER_PODCAST.md:

---

# Agent Prompt: Newsletter & Podcast Generation with RAG

**Objective**: Implement two new API endpoints for generating custom newsletters and podcasts from code intelligence digest content.

**Key Constraint**: This is RAG-driven — the user provides a custom prompt (e.g., "Focus on practical tools for enterprise teams"), and the system should retrieve + re-rank relevant content to match that prompt intent, then generate output aligned to the user's needs.

**Requirements**:

1. **Newsletter Generation** (`POST /api/newsletter/generate`)
   - Input: `{categories, period, limit, prompt}`
   - Process: Retrieve top items → re-rank by prompt alignment → generate markdown/HTML
   - Output: Structured JSON with title, summary, markdown, HTML, themes, metadata
   
2. **Podcast Generation** (`POST /api/podcast/generate`)
   - Input: `{categories, period, limit, prompt, format, voiceStyle}`
   - Process: Retrieve items → extract topics → generate transcript with dialogue flow
   - Output: Structured JSON with transcript, show notes, segments, metadata

**Available Data**:
- 11,051 items with full summaries (up to 1000 chars)
- Pre-computed scores: `finalScore`, `llmRelevance`, `llmTags`, `bm25Score`, `recencyScore`
- Existing RAG implementation: `src/lib/pipeline/answer.ts` (use as template)
- Existing digest generation: `src/lib/pipeline/digest.ts` (extend for custom prompts)

**Prompt Alignment Algorithm**:
- Parse user prompt for key terms/intent
- Re-rank items by overlap of LLM tags + prompt keywords + domain term density
- Bias toward items with high finalScore that match prompt theme

**Success Criteria**:
- ✅ Endpoints accept custom prompts
- ✅ Output is coherent and well-formatted
- ✅ Source attribution included (URLs, authors)
- ✅ Generation metadata provided (tokens, time, model)
- ✅ Error handling + graceful fallback
- ✅ <10 second generation time

**Context Files**: See AGENT_BRIEF_NEWSLETTER_PODCAST.md for full specifications, examples, and implementation details.

---

## Next Steps

1. Copy the **AGENT_BRIEF_NEWSLETTER_PODCAST.md** file
2. Share with the agent along with a link to this codebase
3. The agent can immediately start building the two new endpoints

That's it! All the context they need is documented.
