# Testing Guide

## Quick Sanity Checks

### Full Newsletter Generation Pipeline

**Comprehensive end-to-end test (all categories, user prompt, 7 days, ~17s):**
```bash
source .env.local && export OPENAI_API_KEY=$OPENAI_API_KEY && npx tsx scripts/test-full-newsletter-generation.ts
```

Tests the complete flow:
- Load 3146 items across 7 categories
- Rank per category (hybrid BM25 + LLM + recency)
- Apply prompt profile (focus topics)
- Select with diversity constraints
- Decompose newsletters into articles
- Extract digests with LLM
- Synthesize newsletter with themes

Output validates:
- ✅ Summary generation (200+ chars)
- ✅ Theme extraction (5+ themes)
- ✅ Markdown structure (sections for each resource type)
- ✅ HTML generation (15K+ chars)
- ✅ URL preservation (articles with real URLs)

### Newsletter URL Extraction

**Quick check (< 1 second):**
```bash
npx tsx scripts/quick-url-check.ts
```

Shows pass/fail for each newsletter source (TLDR, Elevate, etc.).

**Detailed check with URL flow (5-10 seconds):**
```bash
npx tsx scripts/test-newsletter-url-pipeline.ts 2>&1 | grep -E "^📰|^   |^✅|^❌"
```

Shows:
- DB URL (Inoreader wrapper)
- Decomposed items count
- First decomposed item URL
- Extracted digests count
- First digest URL
- Overall flow status

### Build & Type Checking

```bash
npm run typecheck    # TypeScript type check
npm run lint         # ESLint
npm test -- --run    # Vitest (all tests)
npm run build        # Production build
```

## What the Tests Check

| Script | What it tests | Time | API Key |
|--------|---------------|------|---------|
| `test-full-newsletter-generation.ts` | Full pipeline: load → rank → select → decompose → extract → synthesize | 17s | Required (LLM calls) |
| `test-newsletter-url-pipeline.ts` | URLs flow through decomposition and extraction | 5-10s | Optional (fallback works) |
| `quick-url-check.ts` | Newsletter URL extraction per source | <1s | None |

## Expected Behavior

### Newsletter Item Categories

The newsletter output is organized by **resource type** (not content category):

- **Newsletters**: Curated roundups (TLDR, Elevate, System Design, etc.)
- **Research**: Academic papers, arXiv
- **Community**: Reddit, Hacker News, Twitter
- **Tech Articles**: Blog posts, dev.to
- **Podcasts**: Audio/video content
- **AI News**: News/announcements
- **Product News**: Release notes, changelogs

### URL Handling Strategy

**Newsletter-only content** (Elevate, System Design, Architecture Notes):
- These newsletters contain original articles not published elsewhere
- URLs point to Inoreader (the aggregator) - this is correct and expected
- Example: "My LLM coding workflow going into 2026" (original to Elevate)

**Link-aggregation newsletters** (TLDR, Byte Byte Go, Pointer):
- These extract links from external sources and include summaries
- Decomposition extracts real article URLs from newsletter content
- Example: TLDR links to "https://github.com/..." or "https://twitter.com/..."

**External articles**:
- Research papers: Links to arXiv.org
- Blog posts: Original author URLs (github.com, medium.com, substack.com)
- These have valid URLs and are properly linked in output

### URL Search Fallback

When an article is referenced but URL is missing:
1. Try to extract URL from newsletter HTML content
2. For non-newsletter sources, attempt web search
3. Keep Inoreader URL as fallback for newsletter-only content
4. Log warnings for items without valid URLs

## Common Issues

### No articles extracted from newsletter

Some newsletters don't have extractable article links (metadata-only content).
- Check newsletter has actual links in HTML via `extractArticlesFromHtml()`
- Some newsletters may be header summaries without detailed content

### Items without valid URLs in output

Expected for:
- Elevate, System Design, Architecture Notes (newsletter-only articles)
- Reddit/Twitter posts without external links

Not expected for:
- TLDR, Pointer (should have extracted URLs)
- External article sources (should have author URLs)

### Performance

- Decomposition: ~100ms per newsletter item
- LLM extraction: ~3-5s per batch of 20 items
- LLM synthesis: ~5-10s per 20 items
- Total pipeline: 15-20s for full test

## Files & Architecture

### Core Pipeline Files
- `src/lib/pipeline/decompose.ts` - Split newsletters into articles
- `src/lib/pipeline/extract.ts` - Extract article digests with LLM
- `src/lib/pipeline/newsletter.ts` - Synthesize digests into newsletter
- `src/lib/search/url-finder.ts` - Find missing article URLs

### Database
- `src/lib/db/items.ts` - Load items by category
- Columns: `id`, `title`, `url`, `summary`, `content_snippet`, `full_text`, `category`

### API Endpoint
- `app/api/newsletter/generate/route.ts` - POST to generate newsletter
- Input: `{ categories, period, limit, prompt? }`
- Output: `{ id, title, summary, markdown, html, themes, generatedAt }`

## Debug Logging

Enable debug logs to trace URL flow:
```bash
npx tsx scripts/test-newsletter-url-pipeline.ts 2>&1 | grep -E "\[URL|DECOMPOSE|EXTRACT"
```

Key log tags:
- `[BEFORE_DECOMPOSE]` - Item count before decomposition
- `[AFTER_DECOMPOSE]` - Item count after article extraction
- `[BEFORE_EXTRACT]` - Item URLs before digest extraction
- `[AFTER_EXTRACT]` - Digest URLs after extraction
- `[URL_MISSING]` - Items without valid URLs
- `[EXTRACT_DIGEST]` - Per-item URL tracking
