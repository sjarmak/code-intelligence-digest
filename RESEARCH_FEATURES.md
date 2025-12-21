# Research Libraries Features Guide

## Overview

The Research Libraries section provides a comprehensive interface for managing, analyzing, and querying your NASA ADS research paper collections with AI-powered capabilities.

## Features

### 1. Collapsible Library Management

View and manage all your ADS libraries in one place with expand/collapse functionality.

**How it works:**
- All your ADS libraries are listed in the main view
- Click on a library name to expand/collapse it
- Shows paper count and library description
- Expandable libraries are fetched on-demand (lazy loading)
- Libraries maintain expanded/collapsed state during the session

**Visual indicators:**
- Chevron down (↓) when expanded
- Chevron right (→) when collapsed
- Paper count badge showing total papers
- Loading spinner while fetching papers

### 2. Paper Summaries

Generate AI-powered summaries for individual papers using Claude.

**How it works:**
- Click the "Summarize" button on any paper
- System fetches the paper if not cached
- Claude analyzes the full text/abstract
- Summary appears in a dedicated section below the paper

**What gets summarized:**
1. Full paper text (if available from ADS API)
2. Abstract (if full text unavailable)
3. Title (as fallback)

**Summary characteristics:**
- 2-3 sentence concise overview
- Focuses on key findings and relevance
- Cached in browser session (doesn't re-generate)

### 3. Full-Text Search & Q&A

Ask questions about your entire paper library using natural language.

**How it works:**
1. Type a question in the "Ask About Papers" panel at the top
2. System searches all cached papers locally
3. Claude synthesizes answers from top 10 relevant papers
4. Shows the answer with source papers listed below

**Example questions:**
- "What is the latest research on neural architecture search?"
- "How do different papers approach embeddings?"
- "What are the key challenges in semantic code search?"
- "Which papers discuss context windows?"

**Answer synthesis:**
- Based on paper titles, abstracts, and cached full text
- Searches across all papers in your libraries
- Returns up to 10 most relevant papers for context
- Answers are 2-4 paragraphs synthesizing information
- Shows which papers the answer is based on

### 4. Paper Details & Metadata

Each paper displays comprehensive metadata:

**Title & Link**
- Clickable title that opens the paper
- Prefers arXiv for arXiv papers, otherwise ADS

**Identifiers**
- Bibcode (unique ADS identifier)
- Quick links to arXiv and ADS abstract pages

**Metadata**
- Authors (up to 3 shown, with "et al." for more)
- Publication date/year
- Abstract (clipped to 3 lines, expandable)

**Interaction buttons**
- Summarize: Generate AI summary
- arXiv/ADS badges: Direct links to papers

### 5. Database Persistence

All fetched papers are automatically stored locally for fast access.

**What gets cached:**
- Paper metadata (title, authors, dates)
- Abstract text
- **Full body text from ADS API**
- Links and identifiers
- Library relationships

**Benefits:**
- Subsequent library views are instant
- Full text available for LLM processing
- Enables local search without API calls
- Papers persist across sessions

See `ADS_DATABASE_USAGE.md` for database operations.

## Usage Workflows

### Workflow 1: Explore a Library

1. Navigate to `/research`
2. Click a library name to expand it
3. View papers with metadata
4. Click paper titles to read the full paper
5. Use Summarize to quickly understand papers

### Workflow 2: Ask a Question Across Libraries

1. Go to Research page
2. Enter question in the "Ask About Papers" panel
3. System searches all cached papers
4. Read synthesized answer with source papers
5. Click source papers to dive deeper

### Workflow 3: Create Paper Summaries for Review

1. Expand your library
2. Click "Summarize" on papers of interest
3. Summaries appear below each paper
4. Scroll through summaries to get overview
5. Follow links for detailed reading

### Workflow 4: Build Focused Research Summary

1. Ask Q&A panel: "What is X?" (broad topic)
2. Review answer and source papers
3. Expand library and summarize those specific papers
4. Compile findings for research notes

## API Reference

### GET /api/libraries (POST method)

**List all user libraries**

```bash
curl -X POST http://localhost:3000/api/libraries \
  -H "Authorization: Bearer $ADS_API_TOKEN"
```

Response:
```json
{
  "libraries": [
    {
      "id": "library-id",
      "name": "Benchmarks",
      "numPapers": 42,
      "description": "Optional description",
      "public": false
    }
  ]
}
```

### GET /api/libraries

**Fetch papers from a library with metadata**

```bash
curl "http://localhost:3000/api/libraries?library=Benchmarks&start=0&rows=50&metadata=true"
```

Parameters:
- `library` - Library name (required)
- `start` - Pagination offset (default: 0)
- `rows` - Papers per page (default: 50)
- `metadata` - Include full text (default: false)

Response: Library data with papers, authors, abstracts, and full text

### POST /api/papers/:bibcode/summarize

**Generate summary for a paper**

```bash
curl -X POST "http://localhost:3000/api/papers/2025arXiv251212730D/summarize"
```

Response:
```json
{
  "summary": "2-3 sentence summary of the paper..."
}
```

### POST /api/papers/ask

**Ask a question about cached papers**

```bash
curl -X POST "http://localhost:3000/api/papers/ask" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is semantic code search?",
    "limit": 20
  }'
```

Parameters:
- `question` - Your question (required)
- `limit` - Max papers to search (default: 20)

Response:
```json
{
  "answer": "Synthesized answer from papers...",
  "papersUsed": 5,
  "papers": [
    {
      "bibcode": "2025arXiv...",
      "title": "Paper Title",
      "adsUrl": "https://..."
    }
  ]
}
```

## Configuration

### Environment Variables

```bash
# Required
ADS_API_TOKEN=your-ads-api-token

# Optional for summarization
ANTHROPIC_API_KEY=your-claude-api-key
```

### Paper Fetch Settings

In `app/api/libraries/route.ts`:
```typescript
const rows = 50; // Papers per fetch
const includeMetadata = true; // Get full text
```

### Q&A Settings

In `app/api/papers/ask/route.ts`:
```typescript
const papersToUse = 10; // Papers for context
const maxTokens = 1000; // Response length
```

## Performance Tips

1. **First load is slow**: Fetches metadata for all papers (parallelized)
2. **Subsequent loads are fast**: Uses cached database
3. **Search is local**: No API calls for Q&A
4. **Large libraries**: Consider pagination or filtering
5. **Summaries are cached**: Won't re-generate if already requested

## Troubleshooting

### "No libraries found"
- Check `ADS_API_TOKEN` in `.env.local`
- Verify token hasn't expired
- Ensure you have libraries in your ADS account

### "Failed to generate summary"
- Check `ANTHROPIC_API_KEY` is set
- Verify Claude API access
- Check Claude model is available

### "Question returns no results"
- Not enough papers cached in database
- Try expanding more libraries first
- Search terms may not match paper content
- Try different search terms

### "Papers not showing"
- Expand library first (papers fetch on expand)
- Check network tab for API errors
- Database may need initialization

### Slow performance
- Large libraries take time to fetch initially
- Database queries are indexed but check browser dev tools
- Consider limiting papers per library fetch

## Future Enhancements

- [ ] Persistent summary storage
- [ ] Export answers to markdown/PDF
- [ ] Multi-library search options
- [ ] Paper recommendations based on Q&A
- [ ] Citation graph visualization
- [ ] Author/journal filtering
- [ ] Advanced search with filters
- [ ] Collaborative notes on papers
- [ ] Integration with digest ranking
- [ ] Paper tagging/organization

## Architecture

### Frontend Components
- `LibrariesView` - List and expand libraries
- `PapersQA` - Q&A interface

### Backend APIs
- `/api/libraries` - Library and paper fetching
- `/api/papers/[bibcode]/summarize` - Individual summaries
- `/api/papers/ask` - Multi-paper Q&A

### Database
- `ads_papers` - Paper metadata and full text
- `ads_library_papers` - Library relationships
- `ads_libraries` - Library metadata cache

### LLM Integration
- Claude 3.5 Sonnet for summarization
- Claude for answer synthesis
- Token limits: 500 (summary), 1000 (answer)

## Links

- [ADS API Documentation](https://ui.adsabs.harvard.edu/help/api/api-docs.html)
- [ADS Database Guide](./ADS_DATABASE_USAGE.md)
- [ADS Metadata Integration](./ADS_METADATA_INTEGRATION.md)
