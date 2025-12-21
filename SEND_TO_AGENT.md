# Send This to the Agent

## Files to Brief the Agent With

These 3 documents have everything needed to implement newsletter + podcast generation:

### 1. **AGENT_BRIEF_SUMMARY.md** (Start here—2 min read)
Quick overview of the task, data available, implementation sketch, and success checklist.

### 2. **AGENT_BRIEF_NEWSLETTER_PODCAST.md** (Full specification—10 min read)
Comprehensive requirements including:
- Exact request/response schemas
- Processing pipeline for both features
- Prompt alignment algorithm
- Database tables (if implementing history)
- Success criteria
- Example prompts

### 3. **AGENT_TECHNICAL_REFERENCE.md** (Code reference—reference)
Deep technical details:
- Type definitions (FeedItem, RankedItem, etc.)
- Database query patterns
- LLM prompting patterns
- Existing code to extend
- Error handling patterns
- Testing checklist

---

## How to Send This to the Agent

### Option A: Quick Brief
Send just **AGENT_BRIEF_SUMMARY.md** if the agent is experienced and can explore the code.

### Option B: Full Context (Recommended)
Send all 3 documents in this order:
1. AGENT_BRIEF_SUMMARY.md
2. AGENT_BRIEF_NEWSLETTER_PODCAST.md
3. AGENT_TECHNICAL_REFERENCE.md

### Option C: Copy-Paste Prompt
Use the prompt from **AGENT_BRIEF_SUMMARY.md** under "Quick Copy-Paste Prompt" section.

---

## What's Already Built (No Need to Repeat)

The agent doesn't need to build:
- ✅ Database schema (items, itemScores, feeds tables exist)
- ✅ Item loading + ranking (rankCategory, loadItemsByCategory)
- ✅ Diversity selection (selectWithDiversity)
- ✅ LLM integration (OpenAI client configured)
- ✅ Digest generation template (extractThemes, generateDigestSummary)
- ✅ RAG template (answer generation in answer.ts)

The agent only needs to:
- ✅ Create 2 new API endpoints
- ✅ Implement prompt alignment re-ranking
- ✅ Generate formatted output (newsletter markdown/HTML, podcast transcript)

---

## Key Insight to Highlight to Agent

This is **RAG-driven**, not just template-based:

Traditional newsletter: "Here are top 10 items"
RAG newsletter: "Here are items relevant to YOUR prompt about [X], formatted to highlight [Y]"

The prompt re-ranking is what makes it special—same items, but re-sorted by user intent.

---

## Data They'll Work With

- 11,051 items in database
- Each with: title, summary (full), URL, author, date, category, scores
- Pre-computed: finalScore, llmRelevance, llmTags, bm25Score
- Can query by category + time period
- All database functions already exist

---

## Estimated Timeline (Share with Agent)

- Setup + types: 20 min
- Newsletter implementation: 1 hour
- Podcast implementation: 1 hour
- Testing: 30 min
- **Total: ~3 hours**

---

## Success Criteria (Share with Agent)

```
Newsletter:
✓ POST /api/newsletter/generate works
✓ Returns markdown, HTML, summary, themes
✓ Prompt alignment visible in output
✓ Source attribution included
✓ <10 second generation

Podcast:
✓ POST /api/podcast/generate works
✓ Returns transcript, show notes, segments
✓ Natural dialogue with speaker changes
✓ voiceStyle affects tone
✓ <10 second generation

Both:
✓ Handle all 7 categories
✓ Graceful error handling
✓ TypeScript compiles
```

---

## Quick Links in Code

Point agent to:
- `src/lib/pipeline/answer.ts` — RAG template to extend
- `src/lib/pipeline/digest.ts` — Summary generation to extend
- `src/lib/pipeline/rank.ts` — Ranking system (don't modify)
- `app/api/items/route.ts` — API structure reference
- `src/lib/model.ts` — Type definitions (RankedItem, FeedItem)
- `src/lib/db/items.ts` — Database queries (loadItemsByCategory, etc.)

---

## Example First Request

Helps agent test their work:

```bash
curl -X POST http://localhost:3000/api/newsletter/generate \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["tech_articles", "ai_news"],
    "period": "week",
    "limit": 20,
    "prompt": "Focus on practical applications for startups. Highlight tools that reduce time-to-market."
  }'
```

---

## Ready to Send?

1. Copy all 3 brief documents (or just #1 if agent is experienced)
2. Share codebase link
3. Point agent to AGENT_BRIEF_SUMMARY.md as starting point
4. Suggest 3-hour estimate

That's it! Agent has everything needed. 🚀

---

## Questions to Clarify Before Sending (Optional)

If agent asks:
- **"How exact should the prompt matching be?"** → Aim for 70-80% accuracy. If user prompt is "enterprise tools", boost items with "enterprise" or "large-scale" tags.
- **"Should I cache results?"** → No caching needed for MVP. Each request generates fresh output.
- **"What about authentication?"** → No auth required for MVP (admin endpoints have it, but these are public).
- **"Full article text available?"** → No, only summaries (200-1000 chars). Sufficient for MVP.

---

## Final Checklist

Before sending:

- [x] AGENT_BRIEF_SUMMARY.md created
- [x] AGENT_BRIEF_NEWSLETTER_PODCAST.md created
- [x] AGENT_TECHNICAL_REFERENCE.md created
- [x] All reference code exists in repo
- [x] Database is populated (11,051 items)
- [x] OpenAI API configured
- [x] Type definitions clear
- [x] Example prompts provided

**Ready to send!** ✅
