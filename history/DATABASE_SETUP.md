# SQLite Database Infrastructure Implementation

## Overview

Implemented a persistent SQLite database layer using better-sqlite3 to replace file-based caching and enable advanced features like search, analytics, and ranking history tracking.

## What Was Built

### 1. Database Schema (`src/lib/db/schema.ts`)
Created 5 interconnected tables:

- **feeds**: Stores subscription metadata from Inoreader
  - `id` (streamId), `canonical_name`, `default_category`, `vendor`, `tags` (JSON)
  - Tracks creation and update timestamps

- **items**: All fetched articles/posts from feeds
  - `id`, `stream_id`, `source_title`, `title`, `url`, `author`
  - `published_at` (Unix timestamp), `summary`, `content_snippet`
  - `categories` (JSON), `category`, timestamps

- **item_scores**: Ranking scores for analytics and A/B testing
  - `item_id`, `category`, `bm25_score`, `llm_relevance`, `llm_usefulness`
  - `llm_tags` (JSON), `recency_score`, `engagement_score`, `final_score`
  - `reasoning`, `scored_at` (timestamp)
  - Composite primary key: `(item_id, scored_at)` allows score history

- **cache_metadata**: Cache freshness tracking
  - `key` (e.g., 'feeds', 'items_7d'), `last_refresh_at`, `count`, `expires_at`
  - Enables TTL-based cache expiration

- **digest_selections**: Analytics for digest generation decisions
  - `id`, `item_id`, `category`, `period`, `rank`
  - `diversity_reason`, `selected_at`
  - Track which items made final digests and why

Includes 7 indexes on common query patterns (stream_id, category, published_at, etc).

### 2. Database Client (`src/lib/db/index.ts`)
- `getSqlite()`: Singleton pattern for database connection
- `initializeDatabase()`: Creates all tables/indexes on first use
- Automatic `.data/digest.db` creation with foreign key constraints enabled

### 3. Operations Modules

#### `src/lib/db/feeds.ts`
- `saveFeeds()`: Batch insert/update feeds from Inoreader
- `loadAllFeeds()`: Retrieve all cached feeds
- `loadFeed()`: Get single feed by streamId
- `getFeedsCount()`: Count total feeds
- `updateFeedsCacheMetadata()`: Track cache freshness (6-hour TTL)
- `getFeedsCacheMetadata()`: Get cache status
- `isFeedsCacheValid()`: Check if cache can be used

#### `src/lib/db/items.ts`
- `saveItems()`: Batch insert items from pipeline
- `loadItemsByCategory()`: Query items by category within time window
- `loadItem()`: Get single item by ID
- `getItemsCount()`: Total item count
- `getItemsCountByCategory()`: Count by category
- `updateItemsCacheMetadata()`: Track cache (1-hour TTL)

#### `src/lib/db/scores.ts`
- `saveItemScores()`: Persist ranking scores for analytics
- `getItemLatestScores()`: Get most recent scores for an item
- `getItemScoreHistory()`: Track score evolution over time
- `getAverageScoresByCategory()`: Understand what scores work per category

### 4. Integration

**Updated `src/config/feeds.ts`:**
- `getFeeds()` now checks database cache first (expires after 6 hours)
- Falls back to Inoreader API only if cache expired
- On successful fetch, saves to DB and updates metadata
- Multi-layer fallback: DB → API → DB (stale) → disk cache → empty

**Updated `app/api/items/route.ts`:**
- `GET /api/items?category=...&period=...` now:
  1. Initializes database
  2. Tries database cache first (1-hour TTL per period)
  3. If hit, ranks and returns immediately
  4. If miss, fetches from Inoreader API
  5. Saves items and scores to database
  6. Returns with `source: "cache"` or `source: "api"` header

## Key Design Decisions

### In-Memory + Disk Persistence
- Follows three-layer caching strategy:
  1. In-memory (feeds only, short session)
  2. Database (persistent, TTL-based, query-optimized)
  3. Disk cache (backwards compatibility, fallback)

### Score Persistence
- Every ranking operation writes scores to `item_scores` table
- Allows analytics: which scoring algorithms work best per category
- Enables A/B testing of weights without recomputation

### Time Windows
- Feeds cache: 6 hours (respects Inoreader's ~100 req/day limit)
- Items cache: 1 hour per period (7d vs 30d handled separately)
- TTL stored in `cache_metadata` with expiration timestamp

### Type Safety
- All database rows properly typed (no implicit `any`)
- Categories cast from DB strings to union type safely
- All optional fields handled with `|| undefined` pattern

## Database File

- Location: `.data/digest.db` (created on first run)
- Engine: SQLite (file-based, single-file, zero-config)
- Better-sqlite3 (synchronous, faster than async adapters)

## Dependencies Added

```json
{
  "dependencies": ["drizzle-orm", "better-sqlite3"],
  "devDependencies": ["drizzle-kit", "@types/better-sqlite3"]
}
```

Note: drizzle-orm added for schema definitions (not used for queries yet; raw SQL used instead for simplicity).

## Next Steps

1. **Implement `/api/admin/stats` endpoint** to expose cache/score analytics
2. **Add `/api/search` endpoint** for semantic/keyword search over cached items
3. **Implement `GET /api/items/:id/history`** to show score evolution
4. **Build scoring experiment endpoint** to test weight changes without reranking

## Testing

All code passes:
- ✅ `npm run typecheck` (strict TypeScript)
- ✅ `npm run lint` (ESLint, no `any` types)
- ✅ Direct database operations tested manually

No breaking changes to existing UI or API contracts.
