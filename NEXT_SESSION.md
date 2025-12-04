# Next Session: Cache Strategy & Smart Invalidation

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
- Updated `/api/items/route.ts` to persist digest selections on every request
- Created `/api/admin/ranking-debug` endpoint:
  - Shows top 50 ranked items (before selection filtering)
  - Displays BM25, LLM, recency, final scores with reasoning
  - Shows score range (min/max/avg) per category
- Created `/api/admin/analytics/scores` endpoint:
  - Average scores per category from item_scores table
  - Score distributions (histograms) for BM25, LLM relevance/usefulness, recency, final
  - Top performing sources by average score
- Created `/api/admin/analytics/selections` endpoint:
  - Overall selection statistics per period
  - Per-category selection breakdown with diversity reasons
  - Analysis of why items were selected vs excluded

All code passes typecheck and lint.

## Ready to Start

### 1. **code-intel-digest-bkx** (HIGH PRIORITY)
**Add caching expiration and cache invalidation strategy**

Goal: Smart cache refresh without hammering Inoreader API

### 2. **code-intel-digest-mop** (AFTER #1)
**Add semantic search and LLM Q&A endpoints**

This becomes possible once cache strategy and admin endpoints are solid.

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
