# ADS Metadata Integration Guide

## Overview

This document describes how the Code Intelligence Digest now fetches and displays paper metadata from the NASA Astrophysics Data System (ADS).

## What Changed

### Fixed API Method
- **Previous approach**: POST to `/v1/search/query` → 405 Method Not Allowed
- **Current approach**: GET to `/v1/search/query` with URL-encoded parameters → ✅ Working

### New Features
1. **Paper Metadata**: Titles, authors, abstracts **and full text** now fetch from ADS API
2. **Full Text Storage**: Paper bodies are now fetched and stored in local database
3. **Paper Links**: 
   - ADS abstract page links for all papers
   - Direct arXiv links when papers are from arXiv
4. **Local Storage**: Database schema + implementation for caching paper metadata and full text
5. **Enhanced UI**: Clickable paper titles with metadata display

## Files Modified

### Core API Client (`src/lib/ads/client.ts`)
- ✅ Fixed `getBibcodeMetadata()` to use GET instead of POST
- ✅ Added `getADSUrl()` to generate ADS abstract page links
- ✅ Added `getArxivUrl()` to parse arXiv IDs from bibcodes

**Key code pattern**:
```typescript
// Correct: Use GET with URLSearchParams
const params = new URLSearchParams({
  q: bibcodeQuery,
  rows: String(count),
  fl: 'bibcode,title,author,pubdate,abstract',
});

const res = await fetch(
  `https://api.adsabs.harvard.edu/v1/search/query?${params.toString()}`,
  {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  },
);
```

### API Route (`app/api/libraries/route.ts`)
- Imports URL generation functions
- Now always provides `adsUrl` and `arxivUrl` in responses
- Works even when metadata fetch fails (graceful degradation)

### UI Component (`src/components/libraries/libraries-view.tsx`)
- Paper titles are now clickable links
- Shows ADS and arXiv badges when links are available
- Click title → opens paper on arXiv (if available) or ADS
- Click badge → opens specific source

**Visual improvements**:
- Blue links with hover effects
- Color-coded badges (arXiv in red, ADS in blue)
- Hover state shows the card border highlights

### Database Operations (`src/lib/db/ads-papers.ts`)
New module with full database operations for ADS papers:
- `storePaper()` / `storePapersBatch()` - Save paper metadata and full text
- `getPaper()` - Retrieve cached paper
- `getLibraryPapers()` - Get papers in a library
- `linkPaperToLibrary()` / `linkPapersToLibraryBatch()` - Link papers to libraries
- `hasCachedFullText()` - Check if paper text is cached
- `getPapersMissingFullText()` - Find papers needing full text fetch
- `searchPapers()` - Full-text search on local cache

### Database Schema (`src/lib/db/schema.ts` + `src/lib/db/ads-papers.ts`)
Added three new tables for local caching:

#### `ads_papers`
Stores paper metadata locally including **full text from ADS API**
```sql
CREATE TABLE ads_papers (
  bibcode TEXT PRIMARY KEY,
  title TEXT,
  authors TEXT,  -- JSON array
  pubdate TEXT,
  abstract TEXT,
  body TEXT,  -- **FULL TEXT from ADS API** - enables LLM processing
  year INTEGER,
  journal TEXT,
  ads_url TEXT,
  arxiv_url TEXT,
  fulltext_source TEXT,  -- Where full text came from (e.g., "ads_api")
  fetched_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);
```

#### `ads_library_papers`
Junction table linking papers to libraries
```sql
CREATE TABLE ads_library_papers (
  libraryId TEXT,
  bibcode TEXT,
  addedAt INTEGER,
  PRIMARY KEY (libraryId, bibcode)
);
```

#### `ads_libraries`
Caches library metadata
```sql
CREATE TABLE ads_libraries (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  numDocuments INTEGER,
  isPublic INTEGER,  -- Boolean as int
  fetchedAt INTEGER,
  createdAt INTEGER,
  updatedAt INTEGER
);
```

## How It Works

### 1. Fetching Library Papers
```
GET /api/libraries?library=Benchmarks&rows=20&start=0&metadata=true
↓
Fetches library contents (bibcodes list from ADS)
↓
For each bibcode, fetches metadata from ADS Search API
↓
Generates paper URLs (ADS + arXiv if applicable)
↓
Returns enriched paper objects with links
```

### 2. arXiv URL Detection
Papers from arXiv follow a standard bibcode pattern:
```
YYYY arXiv AABBBBBC
2025arXiv251212730D
└──┬─  │    └─┬──┘└┘
   │   │     │    └─ First letter of first author
   │   │     └──────── Paper ID with leading digits
   │   └────────────── Source: arXiv
   └────────────────── Year
```

We extract the paper ID and construct the arXiv URL:
```
2025arXiv251212730D → https://arxiv.org/abs/2512.12730
```

### 3. Full Text Caching and Storage
Papers are automatically stored with full text from ADS API:

```typescript
// Automatically happens when fetching libraries
GET /api/libraries?library=Benchmarks&metadata=true
↓
1. Fetch library papers from ADS
2. Fetch metadata + BODY text from ADS Search API
3. Store everything in local database
4. Link papers to library in junction table
```

This enables:
- ✅ Full text available for LLM processing (summaries, embeddings, relevance scoring)
- ✅ Faster subsequent loads (avoid redundant API calls)
- ✅ Offline access to paper details
- ✅ Local search/filtering on cached papers
- ✅ Integration with ranking/digest systems using full text

**Database persistence is automatic** - you get full text in the database immediately upon fetching libraries.

## Testing

### Test Metadata Fetching
```bash
# Run the test script (requires valid ADS_API_TOKEN)
npx tsx scripts/test-ads-metadata.ts
```

Output shows:
- ✅ URL generation working
- ✅ API responding correctly
- ✅ Metadata parsed properly
- ✅ Authors, abstracts, dates extracted

### Manual Testing
1. Visit `http://localhost:3000/research`
2. Click on a paper title
3. Opens arXiv (if available) or ADS abstract page
4. Click "arXiv" or "ADS" badges for direct links

## API Response Format

The `/api/libraries` endpoint now returns:

```json
{
  "library": {
    "id": "library-id",
    "name": "Benchmarks",
    "numPapers": 42
  },
  "items": [
    {
      "bibcode": "2025arXiv251212730D",
      "title": "Paper Title Here",
      "authors": ["Author One", "Author Two"],
      "pubdate": "2025-12-27",
      "abstract": "Paper abstract text...",
      "adsUrl": "https://ui.adsabs.harvard.edu/abs/2025arXiv251212730D",
      "arxivUrl": "https://arxiv.org/abs/2512.12730"
    }
  ],
  "pagination": {
    "start": 0,
    "rows": 20,
    "total": 42,
    "hasMore": true
  }
}
```

## Next Steps

### Short-term (Completed)
1. ✅ Fix metadata fetch (GET method) - DONE
2. ✅ Add paper links (ADS + arXiv) - DONE
3. ✅ Update UI to show metadata and links - DONE
4. ✅ Add database schema for full text storage - DONE
5. ✅ Implement database persistence of full text - DONE (automatic on fetch)
6. ✅ Create database operations module - DONE

### Medium-term
1. Create endpoint to query cached papers by bibcode
2. Add filtering/searching by paper metadata from local database
3. Create bulk full-text search API
4. Track papers marked as relevant by user
5. Integrate with LLM ranking system for digest

### Long-term
1. Generate embeddings from full text
2. Integration with code-intelligence digest ranking
3. Paper summarization using LLMs
4. Citation graph analysis from full text
5. Author/journal reputation scoring based on relevance
6. Connect papers to relevant Inoreader digest items

## Troubleshooting

### 401 Unauthorized
- Verify `ADS_API_TOKEN` is correct in `.env.local`
- Check token isn't expired at https://ui.adsabs.harvard.edu/settings/token

### 404 Library Not Found
- Verify library name is correct (case-sensitive)
- Check library exists in your ADS account
- Default library name is "Benchmarks"

### Empty Metadata
- Metadata fetch is optional - papers still display with bibcodes
- Check logs for warnings about API failures
- Verify token has search API permissions

### Slow Load Times
- First load fetches all paper metadata - this is normal
- Subsequent loads should be faster once metadata is cached
- Monitor API rate limits if loading large libraries

## References

- [ADS API Documentation](https://ui.adsabs.harvard.edu/help/api/api-docs.html)
- [Bibcode Format](https://ui.adsabs.harvard.edu/help/actions/bibcode)
- [arXiv API](https://arxiv.org/help/api/user-manual)
- [Previous Thread Notes](https://ampcode.com/threads/T-019b2863-b61e-77de-8ade-2c1fb59410cc)
