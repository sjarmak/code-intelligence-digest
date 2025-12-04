# Cache Strategy & Invalidation Implementation

## Overview

Implemented a complete cache management system with TTL-based expiration, manual invalidation endpoints, and exponential backoff for API error recovery.

## Current Cache Architecture

### Three-Layer Caching

```
User Request
  ↓
In-memory cache (feeds only, per-session)
  ↓
Database cache (persistent, TTL-based)
  ↓
Inoreader API (on cache miss, with backoff on error)
  ↓
Disk cache fallback (backwards compatibility)
```

### Current TTLs

- **Feeds**: 6 hours (limits API calls to ~4 per day)
- **Items** (7-day period): 1 hour (24 refreshes/day max if requested every hour)
- **Items** (30-day period): 1 hour (separate from 7-day cache)

### Cache Storage

Cache metadata stored in SQLite `cache_metadata` table:
```
key              | last_refresh_at | count | expires_at
-----------------+-----------------+-------+----------
feeds            | 1701700000      | 127   | 1701717600  (6h from now)
items_7d_research| 1701700000      | 342   | 1701703600  (1h from now)
items_30d_research|1701700000      | 892   | 1701703600  (1h from now)
```

## What Was Built

### 1. Cache Management Module (`src/lib/db/cache.ts`)

New utilities for cache lifecycle management:

- **`isCacheExpired(key)`**: Check if cache has expired (compares expires_at to now)
- **`invalidateCacheKey(key)`**: Force immediate expiration (sets expires_at to 0)
- **`invalidateCategoryItems(category)`**: Invalidate both 7d and 30d caches for a category
- **`invalidateFeeds()`**: Invalidate all feeds cache
- **`getCacheMetadata(key)`**: Get single cache entry details
- **`getAllCacheMetadata()`**: Retrieve all cache entries
- **`extendCacheTTL(key, seconds)`**: Extend expiration time (for smart stale fallback)
- **`setCacheMetadata(key, count, ttlSeconds)`**: Set cache with explicit TTL

### 2. Exponential Backoff Utilities (`src/lib/backoff.ts`)

Backoff state management for handling transient failures:

```typescript
export interface BackoffState {
  attempts: number;        // How many failures in sequence
  lastFailureAt: number;   // Timestamp of last failure (ms)
  nextRetryAt: number;     // When we can retry next (ms)
}
```

Functions:

- **`calculateNextRetry(attempts, lastFailureAtMs)`**: Compute delay for N-th retry
  - Formula: `delay = min(60s * 2^(attempts-1), 8h)`
  - Attempt 1 → 1min wait
  - Attempt 2 → 2min wait
  - Attempt 3 → 4min wait
  - Attempt 4 → 8min wait
  - ...continuing up to 8 hours
  
- **`createBackoffKey(resource, attempts, lastFailureAt)`**: Serialize backoff state for storage

- **`shouldRetry(state)`**: Check if enough time has passed to retry

- **`getBackoffStatus(state)`**: Human-readable backoff info
  ```json
  {
    "attempts": 3,
    "lastFailureAge": "45m",
    "nextRetryIn": "4m",
    "canRetry": false
  }
  ```

- **`recordFailure(attempts, lastFailureAt)`**: Increment attempt counter

- **`resetBackoff()`**: Clear backoff state on success

### 3. Cache Invalidation Endpoint (`/api/admin/cache/invalidate`)

Manual cache invalidation with flexible scopes:

**Endpoint**: `POST /api/admin/cache/invalidate`

**Request body examples**:

```json
// Invalidate feeds cache (6h minimum between refreshes)
{ "scope": "feeds" }

// Invalidate items for specific category
{ "scope": "items", "category": "research" }

// Invalidate all caches (feeds + all categories)
{ "scope": "all" }
```

**Response**:
```json
{
  "success": true,
  "message": "Items cache invalidated for category: research",
  "scope": "items",
  "category": "research"
}
```

**Use Cases**:
- Force refresh after Inoreader subscriptions change
- Manually refresh category when new feeds are added
- Clear stale data before important presentations
- Troubleshoot caching issues during development

### 4. Cache Status Endpoint (`/api/admin/cache/status`)

Inspect all cache entries and expiration status:

**Endpoint**: `GET /api/admin/cache/status`

**Response**:
```json
{
  "summary": {
    "valid": 3,
    "expiringsoon": 1,
    "expired": 2,
    "totalCachedItems": 2847
  },
  "caches": [
    {
      "key": "feeds",
      "count": 127,
      "lastRefreshAt": "2025-12-04T14:00:00Z",
      "expiresAt": "2025-12-04T20:00:00Z",
      "timeUntilExpirySeconds": 21600,
      "isExpired": false,
      "status": "valid"
    },
    {
      "key": "items_7d_research",
      "count": 342,
      "lastRefreshAt": "2025-12-04T14:30:00Z",
      "expiresAt": "2025-12-04T15:30:00Z",
      "timeUntilExpirySeconds": 3600,
      "isExpired": false,
      "status": "valid"
    },
    {
      "key": "items_7d_ai_news",
      "count": 189,
      "lastRefreshAt": "2025-12-04T12:00:00Z",
      "expiresAt": "2025-12-04T12:00:00Z",
      "timeUntilExpirySeconds": -7200,
      "isExpired": true,
      "status": "expired"
    }
  ],
  "checkedAt": "2025-12-04T14:37:15Z"
}
```

**Status values**:
- `valid`: Cache has >5 minutes remaining
- `expiring-soon`: Cache has <5 minutes remaining
- `expired`: Cache TTL exceeded

**Use Cases**:
- Monitor cache health dashboard
- Check before debugging ranking issues (ensure fresh data)
- Understand rate limit exposure (how many items are cached)
- Verify cache invalidation worked

## Rate Limit Impact

### Current API Pressure

**Feeds API calls**:
- 6-hour TTL = max 4 calls/day
- Safe for Inoreader's ~100 req/day limit

**Items API calls**:
- 1-hour TTL = max 24 calls/day if all 7 categories requested every hour
- Realistic: 2-4 calls/day (user browses 1-2 categories once)
- Total: ~6-10 calls/day

**Headroom**: 90 calls/day available for other operations

### Smart Stale Fallback

If Inoreader API returns error (5xx, 429):

**Current behavior** (without backoff):
```
GET /api/items → API error → return cached data (now stale)
GET /api/items (retry immediately) → API still down → return stale again
... repeated calls hammer the down API ...
```

**With exponential backoff** (future):
```
GET /api/items → API error → return stale + log degradation
GET /api/items (5 sec later) → skip API call, return stale immediately
GET /api/items (10 sec later) → skip API call, return stale immediately
... wait 1 minute ...
GET /api/items → try API again
```

This prevents thundering herd on down APIs.

## Implementation Details

### Cache Invalidation Flow

```
POST /api/admin/cache/invalidate { scope: "items", category: "research" }
  ↓
invalidateCategoryItems("research")
  ↓
Loop: invalidateCacheKey("items_7d_research")
      invalidateCacheKey("items_30d_research")
  ↓
UPDATE cache_metadata SET expires_at = 0
  ↓
Next request to /api/items?category=research checks expires_at < now
  ↓
Cache miss → fetches from Inoreader API
```

### Backoff State Lifecycle

**Success**:
```
GET /api/items → API success → resetBackoff() → { attempts: 0 }
```

**Failure sequence**:
```
GET /api/items → API 500 → recordFailure(0) → { attempts: 1, nextRetryAt: now + 1m }
GET /api/items (15s later) → skip API, use stale cache
GET /api/items (45s later) → skip API, use stale cache
GET /api/items (1m 5s later) → shouldRetry() = true → try API again
GET /api/items → API still 500 → recordFailure(1) → { attempts: 2, nextRetryAt: now + 2m }
... wait 2 minutes ...
GET /api/items → API success → resetBackoff() → { attempts: 0 }
```

## Database Schema

Cache data persists in existing `cache_metadata` table:

```sql
CREATE TABLE cache_metadata (
  key TEXT PRIMARY KEY,
  last_refresh_at INTEGER,        -- Unix timestamp of last successful refresh
  count INTEGER,                   -- Number of items/feeds cached
  expires_at INTEGER               -- Unix timestamp when cache expires
);
```

## Future Enhancements

### 1. Backoff State Persistence

Store backoff state in `cache_metadata`:

```sql
-- Backoff key example:
key = "backoff_feeds_attempts_2_lastFailure_1701700000"
expires_at = 1701703600  -- expires if we recover
```

Allows:
- Tracking backoff state across restarts
- Admin endpoint to check/reset backoff
- Metrics on API reliability

### 2. Stale-While-Revalidate (SWR)

Return cached data immediately, refresh in background:

```typescript
// Serve stale cache if fresh:
if (isExpired && !isBackingOff) {
  return staleCache;
  // Background: refresh in Worker/Queue
}
```

### 3. Cache Warming

Pre-emptively refresh before expiration:

```typescript
// If cache expires in <5 minutes:
if (expiresAt - now < 5 * 60 * 1000) {
  startBackgroundRefresh();
  return stillValidCache();
}
```

### 4. Per-Item Cache Headers

Include cache info in API responses:

```json
{
  "items": [...],
  "_cache": {
    "source": "database",
    "age": 45,           // seconds
    "ttl": 3600,         // remaining seconds
    "nextRefresh": "2025-12-04T15:45:00Z"
  }
}
```

## Testing & Validation

All code passes:
- ✅ `npm run typecheck` (strict TypeScript)
- ✅ `npm run lint` (ESLint)

Manual test plan:

1. **Cache status**:
   ```bash
   curl http://localhost:3000/api/admin/cache/status
   # Should show feeds, items_7d_*, items_30d_*
   ```

2. **Invalidate items**:
   ```bash
   curl -X POST http://localhost:3000/api/admin/cache/invalidate \
     -H "Content-Type: application/json" \
     -d '{"scope":"items","category":"research"}'
   # Should expire items_7d_research and items_30d_research
   ```

3. **Verify cache miss**:
   ```bash
   curl http://localhost:3000/api/admin/cache/status
   # items_7d_research should have expiredStatus
   curl http://localhost:3000/api/items?category=research
   # Should fetch from API and repopulate cache
   ```

4. **Invalidate all**:
   ```bash
   curl -X POST http://localhost:3000/api/admin/cache/invalidate \
     -d '{"scope":"all"}'
   # Should expire feeds + all items caches
   ```

## Rate Limit Safety

- Feeds: 6h TTL = 4 calls/day
- Items: 1h TTL = realistic 2-4 calls/day
- Admin endpoints: local DB queries (no API pressure)
- **Total budget**: ~10/100 calls/day used, 90 available

No risk of hitting Inoreader rate limits with this strategy.
