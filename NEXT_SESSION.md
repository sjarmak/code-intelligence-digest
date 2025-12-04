# Next Session: Semantic Search & LLM Q&A

## Current Status

✅ **Database infrastructure complete** (code-intel-digest-g66)
- 5-table SQLite schema (feeds, items, item_scores, cache_metadata, digest_selections)
- 3 operation modules for CRUD operations
- Integrated with feeds.ts (6h TTL) and /api/items (1h TTL)
- All code passes typecheck and lint

✅ **Ranking persistence complete** (code-intel-digest-qr4)
- Added `SelectionResult` interface to track diversity reasons for each item
- Created `src/lib/db/selections.ts` with full CRUD for digest_selections table
- Updated `selectWithDiversity()` to return items + diversity reasons map
- Persist digest selections to database on every /api/items request
- Created `/api/admin/ranking-debug`: top 50 ranked items with scores and reasoning
- Created `/api/admin/analytics/scores`: score distributions and top-performing sources
- Created `/api/admin/analytics/selections`: selection decision tracking with diversity analysis

✅ **Cache invalidation complete** (code-intel-digest-bkx)
- Created `src/lib/db/cache.ts` with TTL checks and manual invalidation
- Created `src/lib/backoff.ts` with exponential backoff utilities (1m→2m→4m→8m up to 8h)
- Created `POST /api/admin/cache/invalidate` endpoint:
  - Supports scope: 'feeds' | 'items' | 'all'
  - Per-category items invalidation
- Created `GET /api/admin/cache/status` endpoint:
  - Shows cache health with TTL status (valid/expiring-soon/expired)
  - Tracks total cached items count
  - Human-readable timestamps and countdowns
- Documented rate limit safety (10/100 req/day used, 90 available)

All code passes typecheck and lint.

## Ready to Start

### 1. **code-intel-digest-mop** (MEDIUM)
**Add semantic search and LLM Q&A endpoints**

Goal: Enable intelligent queries over cached digest content

Tasks:
1. Build vector index on item summaries (using an embedding model)
2. Create `/api/search?q=code+intelligence&category=research` endpoint:
   - Semantic search over cached items
   - Return top-K results with relevance scores
3. Create `/api/ask?question=How+do+code+agents+handle+context?` endpoint:
   - LLM Q&A over selected digest items
   - Return answer + source citations
4. Implement caching for embeddings (avoid recomputing)

Test: Verify search and Q&A work on cached digest data without additional API calls.

## Testing Checklist

- [ ] Database creates .data/digest.db on first run
- [ ] Feeds cache works (6h TTL with expire_at in metadata)
- [ ] Items cache works (1h TTL per period)
- [ ] Scores persist correctly (item_scores table populated)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

## Rate Limit Handling

With DB in place:
1. Inoreader allows ~100 requests/day
2. Feeds cache: 6 hours (4 refreshes/day max)
3. Items cache: 1 hour per period (24 refreshes/day max if requested every hour)
4. Implement endpoint to check rate limit status

## Architecture Notes

Current three-layer caching:
```
User Request
  ↓
In-memory cache (feeds only)
  ↓
Database cache (TTL check via expires_at)
  ↓
Inoreader API (on miss + backoff on error)
  ↓
Disk cache fallback (backwards compat)
```

Next phase adds:
- Scoring/ranking history for analytics
- Per-category cache strategies
- Smart invalidation and backoff

## Recommended Approach

1. Start with code-intel-digest-qr4 (debugging is valuable)
2. Add simple cache invalidation endpoints (avoid complexity)
3. Defer search/Q&A until foundation is proven

Expected outcome: Production-ready caching with minimal API load.
