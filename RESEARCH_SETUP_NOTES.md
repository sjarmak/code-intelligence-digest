# Research Features Setup

## ADS Libraries Integration

The system includes full NASA ADS (Astrophysics Data System) libraries integration for browsing and analyzing research papers.

### Environment Variables Required

```bash
# In .env.local:
ADS_API_TOKEN=<your-ads-token>           # Required for browsing libraries and papers
OPENAI_API_KEY=<your-api-key>            # Required for paper summarization and Q&A (uses gpt-4o-mini)
```

### Getting API Tokens

**ADS Token:**
1. Visit https://ui.adsabs.harvard.edu/settings/token
2. Generate or copy your existing token
3. Add to `.env.local` as `ADS_API_TOKEN`

**OpenAI API Key:**
1. Visit https://platform.openai.com/api-keys
2. Create a new API key
3. Add to `.env.local` as `OPENAI_API_KEY`

### Features

#### 1. Library Browsing
- View all your ADS libraries
- Expand/collapse libraries to view papers
- Full metadata: titles, authors, abstracts, publication dates
- Links to both ADS and arXiv (when available)

**Access:** http://localhost:3000/research → "My Libraries" section

#### 2. Paper Summarization
- Generate concise 2-3 sentence summaries for any paper
- Uses GPT-4o-mini with full paper text
- Click "Summarize" button on any paper card
- Summaries cached locally in database

**Requirements:** `OPENAI_API_KEY` environment variable

#### 3. Multi-Paper Q&A
- Ask questions that search across all cached papers
- System finds relevant papers and synthesizes answers using GPT-4o-mini
- Shows source papers used to generate the answer
- Works entirely from locally cached paper content

**Access:** http://localhost:3000/research → "Ask About Papers" panel
**Requirements:** `OPENAI_API_KEY` environment variable

### Database

Papers are automatically stored in SQLite database when:
- You view papers in a library (with metadata enabled)
- Full text content is fetched from ADS API
- Stored in `ads_papers` table with full text in `body` column

**Key operations in `src/lib/db/ads-papers.ts`:**
- `storePaper()` / `storePapersBatch()` - Save papers
- `searchPapers()` - Full-text search of cached papers
- `getPaper()` - Retrieve single paper
- `getLibraryPapers()` - Get papers in a library
- `hasCachedFullText()` - Check if full text is available

### Architecture Notes

**Client-side components:**
- `src/components/libraries/libraries-view.tsx` - Browse libraries and papers
- `src/components/libraries/papers-qa.tsx` - Q&A interface

**Backend endpoints:**
- `GET /api/libraries?library=X&rows=20&start=0&metadata=true` - Fetch library papers
- `POST /api/libraries` - List all libraries
- `POST /api/papers/:bibcode/summarize` - Generate paper summary
- `POST /api/papers/ask` - Answer questions about papers

**ADS API client:**
- `src/lib/ads/client.ts` - ADS API wrapper with retry logic
- Uses GET method for ADS Search API (not POST)
- Includes exponential backoff on transient errors

### Limitations

- Q&A searches only locally cached papers (not all of ADS)
- Full text requires fetching from ADS API (may take 1-2 seconds per paper)
- Summarization and Q&A require active API key (no offline mode)

### Troubleshooting

**Error: "OPENAI_API_KEY not configured in .env.local"**
- Add `OPENAI_API_KEY` to `.env.local`
- Ensure `.env.local` is in project root
- Restart dev server after adding env var
- Get key from https://platform.openai.com/api-keys

**Error: "ADS_API_TOKEN not configured in .env.local"**
- Add `ADS_API_TOKEN` to `.env.local`
- Token must be valid (regenerate at https://ui.adsabs.harvard.edu/settings/token if expired)

**Papers not showing in library**
- Check that ADS_API_TOKEN is valid
- Ensure library name matches exactly (case-sensitive)
- Try a different library (e.g., "Benchmarks" is the default test library)

**Summaries/Q&A responses slow**
- Normal: Claude API calls take 2-5 seconds
- First paper fetch may take longer (full text retrieval)
- Cached papers should respond instantly

## API Cost Notes

Paper summarization and Q&A use **gpt-4o-mini** for cost-effectiveness:
- `gpt-4o-mini` is significantly cheaper than full GPT-4o
- ~10x cheaper token cost compared to claude-3.5-sonnet
- Still provides high-quality summarization and reasoning
- Optimized for fast API responses (2-3 second latency)

## Scope Notes

### What IS Included
- NASA ADS libraries integration (browse personal research libraries)
- Paper summarization with GPT-4o-mini
- Multi-paper Q&A powered by local search + LLM synthesis
- Full-text caching in SQLite database

### What IS NOT Included
- SciX 2024 bibliography (not part of this implementation)
- LLM-based scoring for digest items (digest uses BM25 + term matching)
- LLM evaluation system (evaluation only uses manual relevance ratings)
