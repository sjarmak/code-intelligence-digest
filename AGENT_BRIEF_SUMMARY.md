# Agent Brief Summary: Newsletter & Podcast Generation

## TL;DR

**Task**: Build two new API endpoints that generate custom newsletters and podcasts from code intelligence digest content, powered by a RAG system where users provide prompts to align output with their needs.

**Deadline**: ~3 hours implementation
**Complexity**: Medium (uses existing LLM + ranking infrastructure)
**Data Available**: Yes—11,051 items with full summaries + pre-computed scores

---

## What to Build

### Endpoint 1: Newsletter Generation
```
POST /api/newsletter/generate
Input: {categories: Category[], period: "week", limit: 20, prompt: "..."}
Output: {markdown, html, summary, themes, metadata}
```

### Endpoint 2: Podcast Generation
```
POST /api/podcast/generate
Input: {categories: Category[], period: "week", limit: 20, prompt: "...", voiceStyle: "conversational"}
Output: {transcript, segments, showNotes, metadata}
```

**Key Insight**: The user provides a custom prompt (e.g., "Focus on practical tools for startups") and the system should retrieve relevant content and align output to match that intent.

---

## What Makes This RAG

1. **Retrieve**: Load top-ranked items from database for selected categories/period
2. **Augment**: Re-rank items by aligning with user's prompt (LLM tag matching + term overlap)
3. **Generate**: Use re-ranked items as context for LLM to generate newsletter/podcast aligned to user's needs

**Example**: If user says "Focus on enterprise adoption", items tagged with "enterprise" or "monorepo" or "large-scale" get boosted higher, ensuring the output focuses on enterprise-relevant content.

---

## Data Available (What You're Working With)

**From Database**:
- 11,051 items total (3,268 in last 7 days)
- Each item has:
  - `title`, `summary` (full, up to 1000 chars), `url`, `author`, `publishedAt`, `category`
  - Pre-computed: `finalScore` (0-1), `llmRelevance` (0-10), `llmTags` (domain terms)
  
**Domain Tags** (LLM-assigned):
- "code-search", "agents", "context-management", "devtools", "productivity", etc.

**Existing Code to Use**:
- `src/lib/pipeline/answer.ts` — RAG template (retrieve items → format context → call LLM)
- `src/lib/pipeline/digest.ts` — Digest generation template (themes + summaries)
- `src/lib/pipeline/rank.ts` — Ranking system already handles scoring
- `src/lib/db/items.ts` — Database queries

---

## Implementation Sketch

### Newsletter

```typescript
async function generateNewsletter(req) {
  // 1. Load items for categories + period
  const items = await loadItemsByCategory(category, periodDays);
  
  // 2. Rank items
  const ranked = await rankCategory(items, category, periodDays);
  
  // 3. **RE-RANK by prompt alignment** (NEW)
  const reranked = rerankByPrompt(ranked, req.prompt);
  
  // 4. Apply diversity selection
  const selected = selectWithDiversity(reranked, category, 2, req.limit);
  
  // 5. Generate content with LLM
  const summary = await generateSummaryWithPrompt(selected.items, req.prompt);
  const markdown = formatAsMarkdown(selected.items);
  const html = formatAsHTML(selected.items);
  
  return { markdown, html, summary, themes, metadata };
}
```

### Podcast

```typescript
async function generatePodcast(req) {
  // 1-4. Same as newsletter (load → rank → rerank → select)
  
  // 5. Extract topics
  const topics = extractPodcastTopics(selected.items);
  
  // 6. Generate transcript with dialogue
  const transcript = await generateTranscript(topics, req.prompt, req.voiceStyle);
  
  // 7. Segment transcript
  const segments = segmentTranscript(transcript, selected.items);
  
  return { transcript, segments, showNotes, metadata };
}
```

---

## Prompt Alignment (Core Algorithm)

**Parse the prompt**:
```
"Focus on practical applications for enterprise teams"
→ Keywords: ["practical", "enterprise", "teams"]
→ Domain intent: business/operations focused
```

**Re-rank items**:
```
Item score = (originalScore * 0.5) + (tagMatch * 0.4) + (termDensity * 0.1)

If item tags = ["code-search", "enterprise", "devtools"]
And prompt keywords = ["practical", "enterprise", "teams"]
→ Item gets boosted (enterprise tag matches)
```

---

## Files to Reference

**Send the agent**:
1. **AGENT_BRIEF_NEWSLETTER_PODCAST.md** ← Full requirements + examples
2. **AGENT_TECHNICAL_REFERENCE.md** ← Code patterns + type definitions
3. **NEWSLETTER_PODCAST_READY.md** ← Quick start guide

**Code in repo**:
- `src/lib/pipeline/answer.ts` — Copy structure from here
- `src/lib/pipeline/digest.ts` — Copy theme extraction from here
- `app/api/items/route.ts` — Reference for API structure
- `src/lib/model.ts` — Type definitions (RankedItem, FeedItem)

---

## Success Checklist

When the agent is done, verify:

- [ ] `POST /api/newsletter/generate` accepts request
- [ ] Returns markdown + HTML output
- [ ] Includes themes extracted from content
- [ ] Includes generation metadata (tokens, time)
- [ ] Source attribution (links + authors) in output
- [ ] Prompt alignment working (re-ranking by user intent)

- [ ] `POST /api/podcast/generate` accepts request
- [ ] Returns transcript with natural dialogue
- [ ] Includes show notes with source links
- [ ] Includes segment timestamps
- [ ] voiceStyle parameter affects tone
- [ ] Prompt alignment working

- [ ] Both endpoints handle errors gracefully
- [ ] Both endpoints complete <10 seconds
- [ ] Both endpoints work across all 7 categories
- [ ] TypeScript compiles without errors

---

## Example Prompts (For Testing)

1. **Newsletter**: "Focus on practical tools for indie developers. Highlight cost-effective solutions and open-source alternatives."

2. **Podcast**: "Create an engaging 20-minute podcast discussing AI's impact on developer workflows. Target senior engineers and tech leads. Include diverse perspectives."

3. **Newsletter**: "Target C-suite executives. Emphasize ROI and competitive advantages of modern developer tools. Include business metrics."

4. **Podcast**: "Deep technical discussion for compiler/IR team. Emphasize LLVM, ASTs, and program synthesis. Include research insights."

---

## Timeline Estimate

- **Setup + types**: 20 min
- **Newsletter endpoint + pipeline**: 1 hour
- **Podcast endpoint + pipeline**: 1 hour
- **Testing + refinement**: 30 min
- **Buffer**: 10 min
- **Total**: ~3 hours

---

## Questions Agent Might Ask

**Q: Where's the full article text?**
A: Only summaries available from Inoreader (200-1000 chars). Sufficient for MVP. Full-text scraping is optional enhancement.

**Q: How do I know what's a good prompt?**
A: Look at domain terms in `llmScore.tags` array. Parse prompt for nouns/adjectives. Match against known domain terms.

**Q: Should I include all items or filter by some threshold?**
A: Use diversity selection already in codebase (max 2 per source, cap by category). That's already tuned.

**Q: How long should podcast transcript be?**
A: Estimate 130 words/minute of speech. So for 20 minutes, aim for ~2600 words. Flexible.

**Q: What if LLM fails?**
A: Fallback to simple formatted list. Already done in answer.ts template.

---

## Quick Copy-Paste Prompt

If you want to brief an agent right now:

---

**Brief**: Implement RAG-driven newsletter and podcast generation.

- **Newsletter**: `POST /api/newsletter/generate` → accepts categories, period, limit, prompt → returns markdown/HTML with themes
- **Podcast**: `POST /api/podcast/generate` → accepts categories, period, limit, prompt, voiceStyle → returns transcript + show notes
- **Key**: Re-rank items by prompt alignment (LLM tags + term matching) before generating
- **Data**: 11,051 items with full summaries + pre-computed scores available
- **Reference**: `src/lib/pipeline/answer.ts`, `src/lib/pipeline/digest.ts`
- **Types**: See `src/lib/model.ts` (RankedItem, FeedItem)
- **Duration**: ~3 hours
- **Success**: Both endpoints work with custom prompts, output is formatted, metadata included

See AGENT_BRIEF_NEWSLETTER_PODCAST.md and AGENT_TECHNICAL_REFERENCE.md for full details.

---

## You're Ready!

All the context is documented. The agent has everything needed to implement these two endpoints. Good luck! 🚀
