# Daily Sync API Efficiency Issue & Fix

## Problem

The daily sync was using **97 out of 100 daily API calls** per run, which is wasteful and leaves no budget for other operations.

### Root Cause

The sync was configured to fetch from a **30-day window** instead of **24 hours**:

```typescript
const DAYS_TO_FETCH = 30;
const thirtyDaysAgo = Math.floor((Date.now() - DAYS_TO_FETCH * 24 * 60 * 60 * 1000) / 1000);
```

While the code had client-side filtering, the Inoreader API was still paginating through ~97,000 unread items from the past 30 days (1000 items per API call = ~97 calls).

## Solution

Changed daily sync to **fetch only items newer than what's already in the database**.

### Changes Made

1. **Added database query** in `src/lib/db/items.ts`:
   ```typescript
   export async function getLastPublishedTimestamp(): Promise<number | null>
   ```
   Queries for the most recent `published_at` timestamp in the items table.

2. **Updated daily sync logic** in `src/lib/sync/daily-sync.ts`:
   - Get last published timestamp from database
   - Fetch only items newer than that timestamp
   - Falls back to 24-hour window if database is empty (initial sync)
   - Client-side filter ensures no duplicates

3. **Expected impact**:
   - Old: 97+ API calls per sync
   - New: **1-3 API calls per sync**
   - Savings: **94-96 calls per day** for other operations

### Why This Works

Inoreader's `xt` parameter with a unix timestamp filters results to unread items **after that time**. 

By using the database's latest item timestamp, you skip all the items you already have, meaning the API returns only new items. Typically just a few dozen per day.

**Single API call breakdown**:
- `n=1000` → fetch up to 1000 items
- `continuation` token → if more items exist, can fetch next batch
- Last item timestamp → typically 20-100 new items per day across all feeds
- Most syncs: 1 call completes entire sync
- Worst case (if very active): 2-3 calls

## Daily API Budget After Fix

```
Total daily limit: 100 calls

Daily Sync:        1-3 calls (down from 97)
Scoring batch:    10-20 calls (depending on items to score)
Admin APIs:        5-10 calls (relevance tuning, starred items)
Buffer:           60+ calls (for future features)
```

## Backward Compatibility

This only affects the daily sync. If you want to backfill historical items, use a separate weekly/monthly sync with the 30-day window or use the optimized sync function that fetches in bulk without pagination concerns.

## Implementation Notes

- Sync state was reset before testing new logic
- Client-side filtering still enforces 24-hour cutoff as safety measure
- Logging clearly indicates "last 24 hours" for visibility
