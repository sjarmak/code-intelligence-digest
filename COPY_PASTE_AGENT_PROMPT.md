# Copy & Paste This Prompt for the Agent

---

## Context

I have a Code Intelligence Digest system that ranks and displays content from multiple sources (newsletters, blogs, research papers, etc.) using a hybrid scoring system (BM25 + LLM relevance + recency decay).

**Data Available**:
- 11,051 items in database with full summaries (200-1000 chars each)
- Pre-computed scores: finalScore (0-1), llmRelevance (0-10), llmTags (domain terms)
- 7 content categories: newsletters, podcasts, tech_articles, ai_news, product_news, community, research
- Existing ranking & retrieval infrastructure

**Goal**: Build two new API endpoints that generate custom newsletters and podcasts where users provide a prompt that aligns the output to their specific needs (RAG-style).

---

## The Task

### Endpoint 1: Newsletter Generation

Create `POST /api/newsletter/generate` that:

**Accepts**:
```json
{
  "categories": ["tech_articles", "ai_news"],
  "period": "week",
  "limit": 20,
  "prompt": "Focus on practical applications for enterprise teams. Emphasize productivity gains and cost optimization."
}
```

**Returns**:
```json
{
  "id": "nl-uuid",
  "title": "Code Intelligence Digest – Week of Jan 20",
  "generatedAt": "2025-01-21T10:30:00Z",
  "categories": ["tech_articles", "ai_news"],
  "period": "week",
  "itemsRetrieved": 20,
  "itemsIncluded": 15,
  "summary": "This week's digest focuses on practical developer tools for enterprise teams...",
  "markdown": "# Code Intelligence Digest\n\n## Summary\n...",
  "html": "<article>...",
  "themes": ["code-search", "productivity", "devtools"],
  "generationMetadata": {
    "promptUsed": "Focus on practical...",
    "modelUsed": "gpt-4o",
    "tokensUsed": 2450,
    "duration": "3.2s"
  }
}
```

**Processing**:
1. Load items from DB for selected categories + period
2. Rank items using existing ranking pipeline
3. **Re-rank by prompt alignment** (key differentiator):
   - Parse prompt for key terms ("practical", "enterprise", "productivity")
   - Match against item LLM tags ("code-search", "agents", "enterprise-scale")
   - Boost items where tags align with prompt intent
   - Re-sort by re-ranked score
4. Apply diversity selection (existing function)
5. Generate with LLM:
   - 100-150 word executive summary aligned to user's prompt
   - Organized by theme/category
   - 1-2 sentence description per item with link
   - Callout boxes for standout findings
6. Return markdown + HTML variants, with themes and metadata

---

### Endpoint 2: Podcast Generation

Create `POST /api/podcast/generate` that:

**Accepts**:
```json
{
  "categories": ["podcasts", "research"],
  "period": "week",
  "limit": 15,
  "prompt": "Create an engaging 20-minute podcast discussing AI's impact on developer workflows. Target senior engineers.",
  "format": "transcript",
  "voiceStyle": "conversational"
}
```

**Returns**:
```json
{
  "id": "pod-uuid",
  "title": "Code Intelligence Weekly – Episode 42",
  "generatedAt": "2025-01-21T10:30:00Z",
  "categories": ["podcasts", "research"],
  "period": "week",
  "duration": "18:45",
  "itemsRetrieved": 15,
  "itemsIncluded": 12,
  "transcript": "[INTRO MUSIC]\n\nHost: Welcome to Code Intelligence Weekly...",
  "segments": [
    {
      "title": "Segment 1: AI's Impact on Code Generation",
      "startTime": "0:30",
      "endTime": "7:20",
      "duration": 410,
      "itemsReferenced": [
        {"title": "...", "url": "...", "sourceTitle": "..."}
      ],
      "highlights": ["Key quote about...", "Finding on..."]
    }
  ],
  "showNotes": "# Show Notes\n## References\n- [Title](url) from Source\n...",
  "generationMetadata": {
    "promptUsed": "Create an engaging...",
    "modelUsed": "gpt-4o",
    "tokensUsed": 5820,
    "voiceStyle": "conversational",
    "duration": "8.5s"
  }
}
```

**Processing**:
1. Load items from DB (same as newsletter)
2. Rank items (same as newsletter)
3. Re-rank by prompt alignment (same as newsletter)
4. Apply diversity selection
5. Extract podcast topics from item summaries
6. Generate with LLM:
   - Natural dialogue (host + expert/co-host voices)
   - Topic transitions and segmentation
   - References to source articles naturally woven in
   - Closing with key takeaways
   - [MUSIC] and [PAUSE] cues for audio production
7. Segment transcript:
   - Link segments to source items
   - Extract highlighted quotes/insights
   - Estimate segment duration
8. Generate show notes with references

---

## Implementation Guide

### The Core Innovation: Prompt Alignment Re-ranking

```typescript
// 1. Parse user prompt for key themes
const promptTerms = extractKeywords(prompt);
// e.g., ["practical", "enterprise", "productivity"]

// 2. For each item, score by alignment:
//    score = (original_score * 0.5) +
//            (tag_match_ratio * 0.4) +
//            (term_density * 0.1)
//
//    If item has tags ["code-search", "enterprise", "devtools"]
//    And prompt has themes ["practical", "enterprise", "productivity"]
//    → Item gets boost for "enterprise" match

// 3. Re-sort items by new score
```

This is what makes it RAG: you're not just showing items ranked by general quality, you're showing items ranked by relevance to the user's specific needs.

### Use These Code Patterns

**Existing RAG template** (`src/lib/pipeline/answer.ts`):
- How to retrieve items + format as context
- How to call LLM with prompt
- Error handling + fallback

**Existing digest template** (`src/lib/pipeline/digest.ts`):
- Theme extraction
- LLM summary generation
- Markdown formatting

**Existing ranking** (`src/lib/pipeline/rank.ts`):
- How scoring works (don't need to modify)

**Database functions** (`src/lib/db/items.ts`):
- `loadItemsByCategory(category, periodDays)`
- Already returns FeedItem[]

**Ranking pipeline** (`src/lib/pipeline/rank.ts`):
- `rankCategory(items, category, periodDays)` returns RankedItem[]

**Diversity selection** (`src/lib/pipeline/select.ts`):
- `selectWithDiversity(items, category, maxPerSource, maxItemsOverride)`

### Type Definitions to Use

```typescript
// Item with ranking scores
interface RankedItem extends FeedItem {
  bm25Score: number;
  llmScore: { relevance: number; usefulness: number; tags: string[] };
  recencyScore: number;
  finalScore: number;
  reasoning: string;
}

// Item structure
interface FeedItem {
  id: string;
  title: string;
  url: string;
  sourceTitle: string;
  author?: string;
  publishedAt: Date;
  summary?: string;       // ← Use this for context
  contentSnippet?: string; // First 500 chars
  category: Category;
}
```

---

## Requirements

- Both endpoints should complete in <10 seconds
- Both should handle all 7 categories: newsletters, podcasts, tech_articles, ai_news, product_news, community, research
- Both should include proper source attribution (links, authors) in output
- Prompt parsing must extract meaningful themes from user text
- Re-ranking must be visible in output (items aligned to prompt should rank higher)
- Error handling: if LLM fails, return simple formatted list as fallback
- TypeScript: no implicit any, strict mode

---

## Success Criteria

**Newsletter**:
- ✓ Accepts request with all fields
- ✓ Returns markdown + HTML
- ✓ Summary reflects user's prompt
- ✓ Items with matching tags rank higher
- ✓ Shows themes extracted from content
- ✓ Includes generation metadata

**Podcast**:
- ✓ Accepts request with all fields
- ✓ Returns transcript with natural dialogue
- ✓ Includes speaker changes and transitions
- ✓ voiceStyle parameter affects tone
- ✓ Segments linked to source items
- ✓ Show notes include references

**Both**:
- ✓ Prompt alignment working (demonstrable)
- ✓ Source attribution in all output
- ✓ <10 second generation
- ✓ Graceful error handling
- ✓ TypeScript compiles

---

## Example Prompts to Test With

1. **"Focus on practical tools for indie developers. Highlight cost-effective and open-source solutions."**
   - Should boost items about affordable tools, open source

2. **"Target C-suite executives. Emphasize ROI and competitive advantages."**
   - Should boost items about business impact, productivity gains

3. **"Deep technical discussion for compiler/IR teams. Emphasize LLVM, ASTs, program synthesis."**
   - Should boost items about low-level code, research papers

4. **"Create an engaging podcast for beginners learning to code. Make it fun and accessible."**
   - Should prioritize tutorial-style items, beginner-friendly content

---

## Technical Notes

- Database is populated with ~11k items, ~3.2k in 7-day window
- Summaries are HTML-stripped (no markup), 200-1000 chars
- Full article text not available, but summaries are comprehensive
- LLM tags already assigned to items (from previous scoring)
- OpenAI API is configured (OPENAI_API_KEY env var)
- No authentication needed for these endpoints (public API)

---

## Estimated Timeline

- Setup + type definitions: 20 min
- Newsletter endpoint + pipeline: 1 hour
- Podcast endpoint + pipeline: 1 hour  
- Testing + refinement: 30 min
- **Total: ~3 hours**

---

## References

See these files in the codebase:
1. `AGENT_BRIEF_NEWSLETTER_PODCAST.md` — Detailed specifications + examples
2. `AGENT_TECHNICAL_REFERENCE.md` — Code patterns + LLM prompting examples
3. `src/lib/pipeline/answer.ts` — RAG template to copy from
4. `src/lib/pipeline/digest.ts` — Digest generation to copy from
5. `src/lib/model.ts` — Type definitions

---

## Ready to Start?

All infrastructure is in place. You just need to:
1. Create the two new endpoints
2. Implement prompt alignment re-ranking
3. Generate polished output with LLM
4. Return structured responses with metadata

Good luck! 🚀

---

**Questions?** Check the technical reference file or ask about specific implementation details.
