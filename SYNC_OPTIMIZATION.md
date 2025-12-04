# Inoreader Sync Optimization: 1 API Call for Everything

## Problem

Inoreader has a **100 calls/day limit**. The original sync fetched each stream individually:
- ~30 streams × 7 categories = 30+ calls
- Rate limit exceeded after just 3 full syncs per day

## Solution: Bulk Fetch

**New approach: Fetch all items in 1 call using Inoreader's special stream IDs**

- 📍 `user/{userId}/state/com.google/all` → All items
- 📍 `user/{userId}/label/{labelName}` → All items in a folder

This uses **only 1 API call** to populate the entire database!

## API Endpoints

### Option 1: Fetch Everything (1 Call)

```bash
curl -X POST http://localhost:3000/api/admin/sync-optimized/all
```

Response:
```json
{
  "success": true,
  "categoriesProcessed": 7,
  "itemsAdded": 427,
  "apiCallsUsed": 1,
  "message": "✅ Synced 427 items using only 1 API call!",
  "timestamp": "2025-12-04T15:30:00Z"
}
```

**Result**: 427 items synced, 99 API calls remaining for the day

### Option 2: Fetch One Category (1 Call)

```bash
curl -X POST "http://localhost:3000/api/admin/sync-optimized/category?category=research"
```

Response:
```json
{
  "success": true,
  "category": "research",
  "itemsAdded": 127,
  "apiCallsUsed": 1,
  "message": "✅ Synced 127 items using only 1 API call!",
  "timestamp": "2025-12-04T15:30:00Z"
}
```

### Option 3: Fetch by Label (1 Call)

If you've organized your feeds in Inoreader with labels/folders:

```bash
# Fetch items tagged with "Code_Intelligence" label
curl -X POST "http://localhost:3000/api/admin/sync-optimized/label?labelId=user/123/label/Code_Intelligence"
```

## How It Works

### Traditional Approach (Slow, Wasteful)
```
For each category:
  For each stream in category:
    GET /stream/contents/{streamId}      ← Individual call
    
Total: 30+ API calls
Result: Rate limit hit quickly
```

### Optimized Approach (Fast, Efficient)
```
GET /stream/contents/user/{userId}/state/com.google/all  ← 1 call for EVERYTHING

Process response:
  Normalize items
  Categorize items
  Save to database
  
Total: 1 API call
Result: 99+ calls available for other uses
```

## Implementation Details

### Optimization 1: User "All Items" Stream

Inoreader provides a special stream ID that returns **all items in your account**:

```
GET https://www.inoreader.com/reader/api/0/stream/contents/user/{userId}/state/com.google/all
```

This fetches up to 1000 items (typically 1-2 months of content) in one call.

**Why this works:**
- Single API call covers all subscriptions
- Items are returned with their original feed info
- Still includes all metadata (title, summary, published date, etc)

### Optimization 2: Bulk Categorization

After fetching, the `categorizeItems()` pipeline function:
1. Reads the feed's config (which category it belongs to)
2. Assigns each item to the correct category
3. Saves all items at once

**Result:** One database transaction saves 400+ items

### Optimization 3: Bulk Database Save

Items are saved in a single transaction:
```typescript
const insertMany = sqlite.transaction((items) => {
  for (const item of items) {
    stmt.run(item.id, item.title, ...); 
  }
});
insertMany(allItems);  // Atomic
```

## API Call Budget

### Before (Original Approach)
```
Daily budget: 100 calls

Full sync:    30 calls
Remaining:    70 calls

3× syncs:     90 calls
Remaining:    10 calls
```

**Problem**: Hit limit after 3 syncs (frequent syncs impossible)

### After (Optimized Approach)
```
Daily budget: 100 calls

Full sync:    1 call
Remaining:    99 calls

100× syncs:   100 calls
Remaining:    0 calls
```

**Benefit**: Can sync multiple times per day, all remaining capacity available

## Scheduling Recommendations

With optimized sync using only 1 call per day:

| Frequency | Daily Calls | Remaining | Use Case |
|-----------|------------|-----------|----------|
| 1× daily | 1 | 99 | Standard (morning refresh) |
| 2× daily | 2 | 98 | High freshness |
| 4× daily | 4 | 96 | Real-time updates |
| Hourly | 24 | 76 | Very fresh feed |

**Recommended**: Sync once daily at 2am UTC
- **Benefit**: Fresh data every morning
- **Cost**: 1 API call
- **Remaining**: 99 calls for other features

## Code Structure

### Optimized Sync Module
`src/lib/sync/inoreader-sync-optimized.ts`

Functions:
- `syncAllCategoriesOptimized()` - Fetch all items in 1 call
- `syncCategoryOptimized(category)` - Fetch one category in 1 call
- `syncByLabel(labelId)` - Fetch from Inoreader label in 1 call

### API Endpoint
`app/api/admin/sync-optimized/route.ts`

Routes:
- `POST /api/admin/sync-optimized/all` - Full sync
- `POST /api/admin/sync-optimized/category` - Single category
- `POST /api/admin/sync-optimized/label` - By label

## Usage Example

### Manual Sync
```bash
# Sync everything with fresh data
curl -X POST http://localhost:3000/api/admin/sync-optimized/all

# Check logs
# [INFO] [SYNC-OPTIMIZED] Fetched 427 total items in 1 API call!
# [INFO] [SYNC-OPTIMIZED] Complete: 7/7 categories, 427 total items, 1 API call(s)
```

### Scheduled Sync
Use cron-job.org or similar service to call daily:

```bash
# crontab -e
0 2 * * * curl -X POST https://your-domain.com/api/admin/sync-optimized/all
```

Or GitHub Actions:
```yaml
name: Daily Sync
on:
  schedule:
    - cron: '0 2 * * *'
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Sync Inoreader
        run: curl -X POST ${{ secrets.API_URL }}/api/admin/sync-optimized/all
```

## Testing

### Test Full Sync
```bash
# Check before
sqlite3 .data/digest.db "SELECT COUNT(*) FROM items;"
# Output: 0 (or previous count)

# Run sync
curl -X POST http://localhost:3000/api/admin/sync-optimized/all

# Check after
sqlite3 .data/digest.db "SELECT COUNT(*) FROM items;"
# Output: 427 (or your number)

# Verify distribution
sqlite3 .data/digest.db \
  "SELECT category, COUNT(*) FROM items GROUP BY category;"
# Should show items in all 7 categories
```

### Monitor API Calls
The response includes `apiCallsUsed`:
```json
{
  "apiCallsUsed": 1,
  "itemsAdded": 427,
  "message": "✅ Synced 427 items using only 1 API call!"
}
```

**Verify**: This should always be 1 (unless error during fetch)

## Performance

| Operation | Time | API Calls |
|-----------|------|-----------|
| Full sync | 5-10s | 1 |
| Category sync | 2-5s | 1 |
| Label sync | 2-5s | 1 |

**Limiting factor**: Network latency to Inoreader, not API call count

## Limitations & Considerations

### Limitation 1: Item Limit
Inoreader `n` parameter caps at 1000 items per call.

**Impact**: If you have >1000 items in a month, older items won't be fetched
**Solution**: Use `continuation` token for pagination (adds 1 call per ~1000 items)

Example:
```typescript
// Fetch first 1000
const resp1 = await client.getStreamContents(streamId, { n: 1000 });

// Fetch next 1000 using continuation
const resp2 = await client.getStreamContents(streamId, {
  n: 1000,
  continuation: resp1.continuation
});
```

### Limitation 2: Item Freshness
Returned items are ordered by most recent first, but all items are from subscriptions.

**Impact**: Very old items might not be relevant
**Solution**: Filter by `publishedAt` date in pipeline if needed

### Limitation 3: Rate Limit Still Applies
100 calls/day is a hard limit per account.

**Impact**: Can't use unlimited syncs + other Inoreader features
**Solution**: Budget calls carefully (see scheduling recommendations above)

## Migration from Original Sync

### Old Code
```typescript
import { syncAllCategories, syncCategory } from '@/src/lib/sync/inoreader-sync';

const result = await syncAllCategories();  // 30+ API calls
```

### New Code
```typescript
import { syncAllCategoriesOptimized } from '@/src/lib/sync/inoreader-sync-optimized';

const result = await syncAllCategoriesOptimized();  // 1 API call!
```

### Update API Endpoint
Old: `POST /api/admin/sync/all`
New: `POST /api/admin/sync-optimized/all`

Both work, but optimized version is recommended.

## Future Enhancements

### 1. Incremental Sync with Continuation
```typescript
// Save continuation token
const lastContinuation = await getLastContinuation();

// Resume from that point
const response = await client.getStreamContents(streamId, {
  n: 100,
  continuation: lastContinuation
});

// Save for next time
await saveContinuation(response.continuation);
```

### 2. Filter by Time Window
```typescript
// Only fetch items from last 30 days
const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
const recentItems = items.filter(i => i.publishedAt >= thirtyDaysAgo);
```

### 3. Selective Category Sync
```typescript
// Sync only high-priority categories more frequently
const priorities = {
  'ai_news': 'daily',      // Fetch daily (1 call/day)
  'product_news': 'weekly', // Fetch weekly (1 call/week)
  'research': 'weekly'      // Fetch weekly (1 call/week)
};
```

### 4. Smart Continuation
```typescript
// Keep track of which items we've seen
// Only fetch new items since last sync
const lastSyncTime = await getLastSyncTime();
const newItems = response.items.filter(i => i.publishedAt > lastSyncTime);
```

## Summary

**Original approach**: 30+ API calls per sync → rate limit quickly
**Optimized approach**: 1 API call per sync → 99+ calls remaining

With this optimization, your 100 calls/day budget means:
- ✅ Daily syncs (1 call)
- ✅ Remaining 99 calls for other features
- ✅ Can scale to multiple syncs per day if needed
- ✅ Room for user-initiated syncs or other API usage

**Recommended action**: Use `/api/admin/sync-optimized/all` instead of the old endpoint.
