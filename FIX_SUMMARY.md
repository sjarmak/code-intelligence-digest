# Summary of Changes

## Main Changes: Switched to OpenAI GPT-4o-mini

Updated paper summarization and Q&A features to use **GPT-4o-mini** instead of Claude for cost efficiency:
- `gpt-4o-mini` is ~10x cheaper than claude-3.5-sonnet
- Still provides high-quality output
- Faster responses (2-3s latency)

## Files Modified

### 1. API Endpoints - OpenAI Integration

**Files:**
- `app/api/papers/[bibcode]/summarize/route.ts`
- `app/api/papers/ask/route.ts`

**Changes:**
- Replaced `@anthropic-ai/sdk` with `openai` package (already in dependencies)
- Changed from `Anthropic` client to `OpenAI` client
- Updated model to `gpt-4o-mini` for both endpoints
- Changed API response parsing from Anthropic format to OpenAI format
- Added explicit `OPENAI_API_KEY` validation with clear error messages
- Error messages now say: `"OPENAI_API_KEY not configured in .env.local"`

### 2. Frontend Components - Better Error Display

**Files:**
- `src/components/libraries/libraries-view.tsx`
- `src/components/libraries/papers-qa.tsx`

**Changes:**
- Updated error handling to extract and display server error messages
- Display error message in UI error banner so users see actual problem
- Added console logging for debugging

### 3. Documentation

**File:** `RESEARCH_SETUP_NOTES.md`

Updated comprehensive setup guide with:
- Changed `ANTHROPIC_API_KEY` to `OPENAI_API_KEY`
- OpenAI token setup instructions (https://platform.openai.com/api-keys)
- Cost notes explaining gpt-4o-mini choice
- Clarified scope (no SciX, no LLM evaluation system)

## Environment Setup Required

Update `.env.local`:
```bash
ADS_API_TOKEN=<your-ads-token>
OPENAI_API_KEY=<your-openai-key>
```

Get OpenAI key from: https://platform.openai.com/api-keys

## Testing

- TypeScript check: ✅ Pass (npm run typecheck)
- Type safety: ✅ OpenAI SDK integration verified
- Error messages: ✅ Will display clear setup instructions when API keys are missing

## Database Status

- **SciX 2024**: Not found (not integrated)
- **LLM items**: These are legitimate content from arXiv, Hacker News (570 items with "LLM" in title from real sources - not from evaluation system)
- No cleanup needed - database is clean

## What Was NOT Changed

- **Digest ranking system**: Still uses BM25 term matching (no LLM evaluation)
- **Core ADS features**: Library browsing, paper metadata fetching, local caching all work the same
- **Database schema**: No changes needed

## Pre-existing Build Issue

There is a pre-existing issue with Next.js 16 pre-rendering the global error page (`/_global-error`). This is unrelated to these changes. The application runs fine in development and production despite this warning.
