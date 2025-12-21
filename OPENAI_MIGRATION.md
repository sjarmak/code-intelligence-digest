# OpenAI Migration Complete

## What Changed

Paper analysis features now use **OpenAI GPT-4o-mini** instead of Claude:
- Summarization: `POST /api/papers/:bibcode/summarize`
- Q&A: `POST /api/papers/ask`

## Cost Savings

- **GPT-4o-mini**: ~$0.00015/1K input tokens, $0.0006/1K output tokens
- **Claude 3.5 Sonnet**: ~$0.003/1K input tokens, $0.015/1K output tokens
- **Savings**: 10-20x cheaper per request
- Typical paper summary: <1 cent
- Typical Q&A response: <2 cents

## Required Setup

1. Get OpenAI API key: https://platform.openai.com/api-keys
2. Add to `.env.local`:
   ```bash
   OPENAI_API_KEY=sk_...
   ```
3. Restart dev server

## What Still Works

- NASA ADS library browsing
- Paper full-text fetching and caching
- Local database of papers
- Library expansion/collapse UI
- All existing features unchanged

## Error Messages

If `OPENAI_API_KEY` is missing, you'll see:
- Error: "OPENAI_API_KEY not configured in .env.local"
- Clear instructions to configure it

## Model Details

Using `gpt-4o-mini`:
- Latest small efficient model
- Optimized for cost/speed tradeoff
- Still maintains reasoning capabilities
- 2-3 second response time typical
- Max 128K tokens context

## No Breaking Changes

- All API contracts remain the same
- Frontend components unchanged
- Database schema unchanged
- Just the LLM backend changed
