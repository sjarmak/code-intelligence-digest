# Newsletter & Podcast Generation Feature — Agent Brief Index

## Quick Navigation

You have 4 ways to brief an agent on this feature:

### **Option 1: Copy & Paste (Fastest)**
👉 **[COPY_PASTE_AGENT_PROMPT.md](COPY_PASTE_AGENT_PROMPT.md)** (10 min read)
- Self-contained prompt ready to send
- Includes requirements, examples, and implementation guide
- Everything agent needs to get started
- **Best for**: Experienced agents who just need clear requirements

### **Option 2: Graduated Brief (Recommended)**
Read these in order:
1. **[AGENT_BRIEF_SUMMARY.md](AGENT_BRIEF_SUMMARY.md)** (2 min) — TL;DR overview
2. **[AGENT_BRIEF_NEWSLETTER_PODCAST.md](AGENT_BRIEF_NEWSLETTER_PODCAST.md)** (10 min) — Full specification
3. **[AGENT_TECHNICAL_REFERENCE.md](AGENT_TECHNICAL_REFERENCE.md)** (reference) — Code patterns & types

### **Option 3: Quick Start Guide**
👉 **[SEND_TO_AGENT.md](SEND_TO_AGENT.md)** (5 min)
- Index of all documents
- How to send them to agent
- Success checklist
- **Best for**: Understanding what's already built vs. what needs to be built

### **Option 4: Context-Rich Brief**
👉 **[NEWSLETTER_PODCAST_READY.md](NEWSLETTER_PODCAST_READY.md)** (5 min)
- What's already in place
- What needs to be built
- Key technical details
- Data constraints

---

## The Feature in 30 Seconds

**What**: Two new API endpoints for generating custom newsletters and podcasts

**Why**: Users provide a prompt (e.g., "focus on enterprise tools") and the system retrieves + re-ranks content to align with their specific needs (RAG-style)

**Where**: 
- `POST /api/newsletter/generate` 
- `POST /api/podcast/generate`

**How Long**: ~3 hours to implement

**Data**: 11k+ items with summaries, pre-computed scores, LLM tags already available

---

## File-by-File Breakdown

| File | Purpose | Read Time | Audience |
|------|---------|-----------|----------|
| **COPY_PASTE_AGENT_PROMPT.md** | Self-contained prompt ready to send | 10 min | Anyone |
| **AGENT_BRIEF_SUMMARY.md** | 2-minute overview + checklist | 2 min | Decision makers |
| **AGENT_BRIEF_NEWSLETTER_PODCAST.md** | Full specification + examples | 10 min | Technical agents |
| **AGENT_TECHNICAL_REFERENCE.md** | Code patterns, types, algorithms | Reference | Implementing agents |
| **SEND_TO_AGENT.md** | How to send these docs to agent | 5 min | You (briefing) |
| **NEWSLETTER_PODCAST_READY.md** | Status: what's ready vs. TODO | 5 min | Project managers |

---

## Recommended Flow

### If You Have 5 Minutes
Send **COPY_PASTE_AGENT_PROMPT.md** directly to agent

### If You Have 15 Minutes
1. Read **AGENT_BRIEF_SUMMARY.md** (2 min)
2. Send **COPY_PASTE_AGENT_PROMPT.md** to agent (5 min)
3. Point agent to **AGENT_TECHNICAL_REFERENCE.md** as reference

### If You Have 30 Minutes
1. Read **AGENT_BRIEF_SUMMARY.md** (2 min)
2. Read **AGENT_BRIEF_NEWSLETTER_PODCAST.md** (10 min)
3. Send all 3 brief files to agent
4. Ask clarifying questions if needed

### If You Want Full Context
Read in order:
1. **AGENT_BRIEF_SUMMARY.md** — Understand scope
2. **AGENT_BRIEF_NEWSLETTER_PODCAST.md** — Understand requirements
3. **AGENT_TECHNICAL_REFERENCE.md** — Understand implementation
4. Send **COPY_PASTE_AGENT_PROMPT.md** + all docs to agent

---

## What's Already Built (Don't Repeat)

✅ Database with 11k+ items + pre-computed scores
✅ Ranking system (BM25 + LLM + recency)
✅ Diversity selection (per-source caps, total limits)
✅ LLM integration (OpenAI API)
✅ Existing RAG template (answer.ts)
✅ Digest generation template (digest.ts)

## What Agent Needs to Build

⚙️ Newsletter generation endpoint + pipeline
⚙️ Podcast generation endpoint + pipeline
⚙️ Prompt alignment re-ranking
⚙️ Output formatting (markdown/HTML for newsletter, transcript for podcast)

---

## Key Technical Concept: Prompt Alignment

The core innovation is **re-ranking by user intent**:

```
User: "Focus on practical applications for enterprise teams"

System:
1. Parse prompt → ["practical", "enterprise", "teams"]
2. Load ranked items
3. Re-score each item:
   score = (original_score * 0.5) +
           (tag_match * 0.4) +        ← "enterprise" tag boost
           (term_density * 0.1)
4. Re-sort by new score
5. Generate with LLM using re-ranked items

Result: Newsletter focused on enterprise topics
```

---

## Success Criteria (Share with Agent)

**Newsletter Endpoint**:
- ✓ Accepts category, period, limit, prompt
- ✓ Returns markdown + HTML
- ✓ Prompt alignment visible in output
- ✓ Source attribution included
- ✓ Completes <10 seconds

**Podcast Endpoint**:
- ✓ Accepts category, period, limit, prompt, voiceStyle
- ✓ Returns transcript + show notes + segments
- ✓ Natural dialogue with speaker changes
- ✓ voiceStyle affects tone
- ✓ Completes <10 seconds

**Both**:
- ✓ Work across all 7 categories
- ✓ Graceful error handling
- ✓ TypeScript strict mode

---

## Data Your Agent Will Work With

```typescript
// What's available in database:
{
  id: string;
  title: string;               // "Sourcegraph 5.0 Release"
  summary: string;             // Full text, 200-1000 chars
  url: string;                 // Link to original article
  author: string;              // Article author
  publishedAt: Date;           // Publication date
  sourceTitle: string;         // "Sourcegraph Blog"
  category: Category;          // newsletters, tech_articles, etc.
  
  // Pre-computed scores:
  finalScore: number;          // 0-1 (quality)
  llmRelevance: number;        // 0-10 (LLM rated)
  llmTags: string[];           // ["code-search", "agents", ...]
  bm25Score: number;           // 0-1 (term matching)
  recencyScore: number;        // 0-1 (time decay)
}
```

---

## Sending to Agent

**Minimal**:
```
"Brief: Implement newsletter and podcast generation. 
See COPY_PASTE_AGENT_PROMPT.md for full requirements.
Reference code: src/lib/pipeline/answer.ts and digest.ts"
```

**Standard**:
```
"Brief: Implement newsletter and podcast generation.
Documents:
1. AGENT_BRIEF_SUMMARY.md (2 min overview)
2. AGENT_BRIEF_NEWSLETTER_PODCAST.md (full spec)
3. AGENT_TECHNICAL_REFERENCE.md (code reference)
4. COPY_PASTE_AGENT_PROMPT.md (ready to code from)
"
```

**Full**:
Send all files in the "Send to Agent" directory.

---

## Questions Agent Might Ask (With Answers)

**Q: Where's the full article text?**
A: Only summaries available (200-1000 chars from Inoreader). Sufficient for MVP. Full-text scraping is optional enhancement.

**Q: How do I know if prompt alignment is working?**
A: Test with specific prompt like "focus on enterprise tools". Items tagged "enterprise" or "monorepo" should rank higher. Check finalScore increases for matching items.

**Q: What if LLM fails?**
A: Fallback to simple formatted list. See answer.ts for example.

**Q: Should I implement caching?**
A: Not for MVP. Each request generates fresh output.

**Q: How accurate should prompt parsing be?**
A: Aim for 70-80%. Simple keyword extraction + LLM tag matching sufficient.

---

## Next Steps

1. **Choose briefing method** (Copy-Paste, Graduated, or Full)
2. **Send documents to agent**
3. **Agent implements** (estimates ~3 hours)
4. **You test** endpoints with example prompts
5. **Iterate** if needed (prompt alignment tuning, formatting tweaks)

---

## File Sizes (For Reference)

- COPY_PASTE_AGENT_PROMPT.md: 9.6 KB (self-contained, send this!)
- AGENT_BRIEF_SUMMARY.md: 8.0 KB
- AGENT_BRIEF_NEWSLETTER_PODCAST.md: 12 KB
- AGENT_TECHNICAL_REFERENCE.md: 14 KB
- SEND_TO_AGENT.md: 5.1 KB
- NEWSLETTER_PODCAST_READY.md: 5.7 KB

**Total**: ~54 KB of well-organized, reference-quality documentation

---

## TL;DR

👉 **Send [COPY_PASTE_AGENT_PROMPT.md](COPY_PASTE_AGENT_PROMPT.md) to agent for fastest briefing**

Or send all 3 brief files (SUMMARY + NEWSLETTER_PODCAST + TECHNICAL_REFERENCE) for comprehensive context.

Everything the agent needs is documented. Ready to go! 🚀
