# Testing Guide

## Quick Sanity Checks

### Newsletter URL Extraction

**Quick check (< 1 second):**
```bash
npx tsx scripts/quick-url-check.ts
```

Shows pass/fail for each newsletter source.

**Detailed check (5-10 seconds):**
```bash
npx tsx scripts/test-newsletter-url-pipeline.ts 2>&1 | grep -E "^📰|^   |^✅|^❌"
```

Shows:
- DB URL (from database)
- Decomposed items count
- First decomposed item URL
- Extracted digests count
- First digest URL
- Overall flow status

### Individual Newsletter Decomposition

Test a single newsletter source:
```bash
npx tsx scripts/test-real-newsletter-decomposition.ts
npx tsx scripts/test-other-newsletters.ts
```

### Build & Type Checking

```bash
npm run typecheck    # TypeScript type check
npm run lint         # ESLint
npm test -- --run    # Vitest (all tests)
```

## What the Tests Check

| Script | What it tests | Time |
|--------|---------------|------|
| `quick-url-check.ts` | URLs flow correctly through decomposition | <1s |
| `test-newsletter-url-pipeline.ts` | Full pipeline with detailed output | 5-10s |
| `test-real-newsletter-decomposition.ts` | Real DB items, decomposition only | 2-3s |
| `test-other-newsletters.ts` | All newsletter sources work | 2-3s |

## Expected Output

### quick-url-check.ts
```
✅ TLDR: URLs extracted correctly
✅ System Design: URLs extracted correctly  
✅ Architecture Notes: URLs extracted correctly
```

### test-newsletter-url-pipeline.ts
```
📰 TLDR
   DB URL: https://www.inoreader.com/article/...
   Decomposed: 26 items
   [1] URL: https://tldr.tech/data?utm_source=tldrdata...
       Real URL: ✅
   Extracted: 676 digests
   [1] Digest URL: https://tldr.tech/data?utm_source=tldrdata...
       Real URL: ✅
   ✅ Flow: Inoreader → Real URL → Real URL (GOOD)
```

## URL Flow Verification

The pipeline should follow this flow:

```
Database (Inoreader URL)
    ↓
decomposeNewsletterItems()
    ↓
Decomposed items (Real URLs extracted from HTML)
    ↓
extractBatchDigests()
    ↓
ItemDigest objects (with real URLs)
    ↓
Newsletter markdown (with real article links)
```

## Common Issues

**Decomposed items have Inoreader URLs:**
- Check that all newsletter sources are in `NEWSLETTER_SOURCES` in `decompose.ts`
- Current sources: TLDR, Byte Byte Go, Pointer, Substack, Elevate, Architecture Notes, Leadership in Tech, Programming Digest, System Design

**Digests have Inoreader URLs:**
- Run the detailed test to see where URLs are lost
- Check logs for `[URL_MISSING]` warnings in `buildNewsletterMarkdown()`

**Articles not being extracted:**
- Check HTML content has links via `extractArticlesFromHtml()`
- Some newsletters may not have extractable article links (newsletter metadata only)

## Performance Notes

- Decomposition is fast (<100ms per item)
- Extraction involves LLM calls (slower, default uses fallback if API unavailable)
- Test scripts suppress detailed logs - add `2>&1 | grep -v "\[INFO\]"` to see debug output
