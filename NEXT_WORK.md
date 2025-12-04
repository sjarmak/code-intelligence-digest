# Next Work: Semantic Search & LLM Q&A (code-intel-digest-mop)

## Status
- **Priority**: 1 (High)
- **Type**: Feature
- **Blocking**: None
- **Dependencies**: Database and cache layers complete (code-intel-digest-qr4, code-intel-digest-bkx)

## Goal
Enable intelligent queries over cached digest content without additional Inoreader API calls.

## Tasks

### 1. Vector Embeddings Infrastructure
- Decide embedding model (e.g., Hugging Face, OpenAI, local)
- Add embedding generation on item summary (in pipeline or on-demand)
- Create `src/lib/embeddings/index.ts` module
- Cache embeddings in database or `.data/` directory

### 2. Semantic Search Endpoint
- Implement `GET /api/search?q=code+intelligence&category=research&limit=10`
- Features:
  - Query embedding generation
  - Vector similarity search over cached items
  - Return top-K results with relevance scores
  - Filter by category if specified
- Response: JSON with items + scores

### 3. LLM Q&A Endpoint
- Implement `GET /api/ask?question=How+do+code+agents+handle+context?&context=research`
- Features:
  - Pass question + top-K similar items to LLM
  - Generate answer with source citations
  - Return answer + cited items
- Response: JSON with answer text + source links

### 4. Embedding Caching
- Store embeddings to avoid recomputing
- Options: SQLite column, disk cache, memory
- Invalidate when items updated

## Expected Outcomes

- [ ] Vector embeddings working for item summaries
- [ ] Semantic search endpoint returns relevant results
- [ ] Q&A endpoint generates cited answers
- [ ] All code passes typecheck and lint
- [ ] Comprehensive documentation in `history/SEMANTIC_SEARCH.md`
- [ ] No additional Inoreader API calls (uses cached data only)

## Testing

1. Call `/api/search?q=code+search` → should find relevant items
2. Call `/api/ask?question=What+is+semantic+search?` → should return answer
3. Verify embeddings cached (no repeated computation)
4. Check database space usage with embeddings

## Architecture Notes

- Embeddings are deterministic: same input = same vector (safe to cache)
- Question embedding computed fresh each time (user query, not cached)
- Can reuse existing ranking infrastructure for scoring
- Keep embedding model lightweight (inference only, no training)

## Estimated Effort

- Embedding setup: 1-2 hours
- Search endpoint: 1 hour
- Q&A endpoint: 1-2 hours
- Testing + docs: 1 hour
- **Total**: 4-6 hours

## Success Criteria

1. ✅ `npm run typecheck` passes
2. ✅ `npm run lint` passes
3. ✅ Semantic search returns relevant results (manual testing)
4. ✅ Q&A generates coherent answers with citations
5. ✅ No additional Inoreader API pressure
6. ✅ Clear documentation of approach chosen

## Next After This

- Score experimentation UI
- Cache warming / stale-while-revalidate
- Rate limit monitoring dashboard
