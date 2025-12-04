# Next Session: Build Search/Q&A UI Components

## Context

You completed semantic search and LLM Q&A endpoints (code-intel-digest-mop). Both APIs are fully functional with:
- `/api/search?q=...` - Semantic search over cached items
- `/api/ask?question=...` - Q&A with source citations
- Full embeddings caching in database
- TypeScript type coverage
- All code passes lint and typecheck

## Recommended Next Work

### Primary: Build Search/Q&A UI (code-intel-digest-l1z, P1)

Add frontend components for the new search and Q&A endpoints.

#### Search UI Component (`src/components/search/SearchBox.tsx`)
- Input field for query
- Category filter dropdown (optional)
- Period selector (week/month)
- Execute search button

#### Search Results Component (`src/components/search/SearchResults.tsx`)
- Display results from `/api/search`
- Show per-item:
  - Title (link to URL)
  - Source
  - Similarity score (0-1, maybe as % or bar)
  - Summary snippet
- Loading state during search
- Empty state if no results

#### Q&A UI Component (`src/components/qa/AskBox.tsx`)
- Question input field
- Category filter (optional)
- Ask button

#### Answer Display Component (`src/components/qa/Answer.tsx`)
- Display answer text from `/api/ask`
- Show source citations with:
  - Item title (link)
  - Source name
  - Relevance score
- Loading state with streamed answer support (future)

#### Integration Point
- Add new "Search" tab to main dashboard (`app/page.tsx`)
- Alongside existing digest tabs

## Quick Start

1. Check `history/SEMANTIC_SEARCH.md` for API response schemas
2. Create components using shadcn-ui patterns from existing `src/components/`
3. Follow existing component structure (functional, TypeScript, proper types)
4. Test with actual `/api/search` and `/api/ask` calls during development

## Database/API Status

All backend infrastructure is complete:
- ✅ Database tables and schema
- ✅ Embedding generation and caching
- ✅ Search algorithm
- ✅ Q&A answer generation
- ✅ API endpoints (untested but valid)

## Testing Strategy

1. Start dev server: `npm run dev`
2. Call API endpoints directly to verify responses
3. Build UI components
4. Connect to APIs
5. Verify end-to-end flow

## Known Limitations

- Answer generation is template-based (no Claude API yet)
- Embeddings use simple TF-IDF (not transformer-based)
- No analytics/search history tracking

These can be addressed in future iterations.

## Ready to Start?

Run `bd ready --json` to see available work, then:

```bash
bd update code-intel-digest-l1z --status in_progress
# ... implement ...
bd close code-intel-digest-l1z --reason "Completed search/Q&A UI"
```

Good luck! 🚀
