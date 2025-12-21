# Newsletter Generation Improvements

## Summary

Upgraded newsletter synthesis from single-pass to two-pass pipeline with GPT-5.2 models, better source diversity, and minimum 10-item guarantee.

## Key Improvements

### 1. Two-Pass Architecture

**Pass 1 (Extraction)** – `gpt-5.2-instant`
- Extract per-item digests with structured JSON
- Automatic text chunking for long articles (2000+ chars)
- Produce: gist, key bullets, relevance score, credibility rating
- Fast & cheap

**Pass 2 (Synthesis)** – `gpt-5.2-pro` with `reasoning_effort: "high"`
- Synthesize themes across sources
- Write polished newsletter with consistent editorial voice
- Extract research paper findings aligned to user prompt
- Include 4-5 strategic callout boxes explaining importance
- Higher quality output

### 2. Better Source Diversity

**Updated selection logic:**
- Enforce minimum 10 items per newsletter
- Distribute across multiple sources (not dominated by one)
- Smart per-source caps that relax if below minimum threshold
- Ensures breadth of perspective

### 3. Research Paper Support

**For academic/research items:**
- Automatic identification of research content (based on source credibility)
- Extract key findings relevant to user's focus areas
- Include research insights in synthesis prompts

### 4. Long Text Handling

**Automatic chunking strategy:**
```
Long article (5000+ chars)
  ↓
Split into ~2000 char chunks
  ↓
Summarize each chunk independently
  ↓
Merge summaries into processed text
  ↓
Extract digest from merged summary
```

**Benefits:**
- ✅ Handles research papers, detailed guides, long articles
- ✅ Reduces context bloat and hallucination risk
- ✅ Maintains key information across all chunks

### 5. User-Aligned Relevance

Each item includes:
- `userRelevanceScore` (0-10) based on prompt match
- `whyItMatters` explanation tied to user focus
- Topic tags extracted from content
- Source credibility rating

## API Changes

### Newsletter Generation Endpoint

**POST** `/api/newsletter/generate`

**Request** (unchanged):
```json
{
  "categories": ["tech_articles", "ai_news"],
  "period": "week",
  "limit": 15,
  "prompt": "Focus on coding agents and context management"
}
```

**Response** (improved):
```json
{
  "id": "nl-xxx",
  "title": "Code Intelligence Digest – Week of Dec 21, 2024",
  "summary": "250-350 word executive summary synthesizing themes",
  "markdown": "Complete markdown with thematic sections",
  "html": "Semantic HTML with consistent styling",
  "themes": ["coding-agents", "context-management", ...],
  "generationMetadata": {
    "modelUsed": "gpt-5.2-instant + gpt-5.2-pro",
    "tokensUsed": 4500,
    "duration": "8.3s"
  }
}
```

### Download & Export Endpoints (Already Implemented)

**POST** `/api/newsletter/download`
- Download as `.txt` or `.md` file

**POST** `/api/newsletter/pdf`
- Export as print-ready HTML (save as PDF via print dialog)

## Files Added

1. **`src/lib/pipeline/extract.ts`** (230 lines)
   - `extractItemDigest()` – Extract single item digest
   - `extractBatchDigests()` – Batch extraction with parallelization
   - Text chunking and merging logic
   - Fallback digest generation

2. **`history/TWO_PASS_SYNTHESIS_PIPELINE.md`**
   - Detailed architecture documentation
   - Before/after comparison
   - Integration guide

## Files Modified

1. **`src/lib/pipeline/newsletter.ts`**
   - New: `generateNewsletterFromDigests()` – Pass 2 synthesis
   - Updated: Model from `gpt-4o-mini` to `gpt-5.2-pro`
   - Updated: LLM prompt with synthesis instructions
   - Added: `buildDigestContext()` for digest formatting

2. **`src/lib/pipeline/select.ts`**
   - Enforce minimum 10 items
   - Better source diversity tracking
   - Smart caps relaxation for minimum threshold

3. **`app/api/newsletter/generate/route.ts`**
   - Wire up extraction pass (Pass 1)
   - Wire up synthesis pass (Pass 2)
   - Update metadata with two-model attribution

## Model Selection Rationale

### Why gpt-5.2-instant for Extraction?
- ✅ Fast processing (per-item)
- ✅ Deterministic extraction (temp=0)
- ✅ Cost-effective (hundreds of tokens per item)
- ✅ Structured JSON output
- ✅ Good enough for extraction (not synthesis)

### Why gpt-5.2-pro with high reasoning for Synthesis?
- ✅ Better long-document understanding
- ✅ Cross-source theme synthesis
- ✅ Consistent editorial voice
- ✅ Strategic importance analysis
- ✅ High reasoning_effort enables extended thinking
- ✅ Better at instruction following

## Cost Estimates

Per newsletter (15 items, weekly):

| Step | Model | Tokens | Cost |
|------|-------|--------|------|
| Extraction | gpt-5.2-instant | ~4,500 | ~$0.005 |
| Synthesis | gpt-5.2-pro | ~3,000 | ~$0.015 |
| **Total** | | ~7,500 | ~$0.020 |

*(Actual costs depend on OpenAI pricing)*

## Quality Improvements

### Before (Single-Pass)
- Model: gpt-4o-mini
- Input: Raw full text + summaries mixed
- Output: Generic structure, title-only items
- User relevance: Score only, no explanation

### After (Two-Pass)
- Models: gpt-5.2-instant + gpt-5.2-pro
- Input: Structured digests (gist, bullets, relevance)
- Output: Polished prose, synthesized themes, strategic callouts
- User relevance: Score + explicit "why it matters" explanations
- Minimum items: Always 10+
- Source diversity: Guaranteed spread across sources
- Research papers: Key findings extracted + aligned to user prompt

## Next Steps

1. **UI Integration**
   - Add "Download Text", "Download Markdown", "Export PDF" buttons
   - Show extraction progress (Pass 1) → synthesis progress (Pass 2)
   - Display final metadata (model used, tokens, duration)

2. **Testing**
   - Test with research paper-heavy selections
   - Verify chunking works for 10K+ character articles
   - Validate source diversity distribution
   - Compare outputs for tone and quality

3. **Monitoring**
   - Track actual vs estimated token usage
   - Monitor extraction failure rates (fallback usage)
   - Measure synthesis quality via user feedback

## Implementation Notes

- All changes are backward compatible with existing API
- Fallbacks in place if OpenAI API is unavailable
- Extraction runs in parallel (faster for many items)
- Total pipeline should complete in 10-15 seconds for 15 items
