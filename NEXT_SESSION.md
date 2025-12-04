# Next Session: Ranking Persistence & Cache Strategy

## Current Status

✅ **Database infrastructure complete** (code-intel-digest-g66)
- 5-table SQLite schema (feeds, items, item_scores, cache_metadata, digest_selections)
- 3 operation modules for CRUD operations
- Integrated with feeds.ts (6h TTL) and /api/items (1h TTL)
- All code passes typecheck and lint

## Ready to Start

### 1. **code-intel-digest-qr4** (HIGH PRIORITY)
**Implement item ranking and filtering persistence layer**

Goal: Store all ranked items (not just top-K selections) to enable:
- Algorithm experimentation (what weights work per category?)
- Score analytics dashboard
- Ranking history tracking

Tasks:
1. Create `/api/admin/ranking-debug` endpoint to:
   - Show top 50 items (ranked but not selected) per category
   - Display BM25, LLM, recency, final scores
   - Show why items were filtered (low relevance, off-topic, source cap)
2. Create `/api/analytics/scores` endpoint:
   - Average scores per category (trends over time)
   - Score distribution (histograms)
   - Top-performing sources/items
3. Populate `digest_selections` table when items are selected:
   - Record rank position, diversity reason, timestamp
   - Track what gets excluded and why

Test: Verify 100+ items stored per category with full score metadata.

### 2. **code-intel-digest-bkx** (MEDIUM)
**Add caching expiration and cache invalidation strategy**

Goal: Smart cache refresh without hammering Inoreader API

Tasks:
1. Implement cache invalidation endpoints:
   - `POST /api/admin/invalidate-feeds` - force feeds refresh (6h minimum)
   - `POST /api/admin/invalidate-items?category=research` - per-category items refresh
2. Add exponential backoff retry logic:
   - Track failed refresh attempts in cache_metadata
   - Exponential backoff: 1h, 2h, 4h, 8h between retries
3. Implement "smart stale" fallback:
   - If API fails, extend TTL instead of failing hard
   - Log degradation with timestamp

Test: Verify cache eviction, API rate limiting handling, error recovery.

### 3. **code-intel-digest-mop** (AFTER #2)
**Add semantic search and LLM Q&A endpoints**

This becomes possible once persistence is solid.

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
