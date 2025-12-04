# Sync Strategy Comparison

## Original vs Optimized Sync

### Original Sync (Individual Streams)
`POST /api/admin/sync/all` or `POST /api/admin/sync/category`

```
Architecture: Fetch each stream individually
Cost per full sync: 30+ API calls
Cost per category: 3-5 API calls
Daily budget remaining: Limited
Scheduling: Once per day max
```

**Use case**: When you have unlimited API calls

### Optimized Sync (Bulk Fetch)
`POST /api/admin/sync-optimized/all` or `POST /api/admin/sync-optimized/category`

```
Architecture: Fetch all items in one call
Cost per full sync: 1 API call
Cost per category: 1 API call
Daily budget remaining: 99 calls
Scheduling: Multiple times per day possible
```

**Use case**: When you have a 100-call/day limit (like Inoreader)

## Side-by-Side Comparison

| Aspect | Original | Optimized |
|--------|----------|-----------|
| **API calls per full sync** | 30+ | 1 |
| **API calls per category** | 3-5 | 1 |
| **Time per full sync** | 10-30s | 5-10s |
| **Items fetched per call** | 100 | 1000 |
| **Categorization** | Per-stream | Bulk after fetch |
| **Database transactions** | Multiple | Single |
| **Error resilience** | Good (skip failed streams) | Fair (one failure = all fail) |
| **Items in last month** | ✅ Yes | ✅ Yes |
| **Support pagination** | ✅ Via continuation | ⚠️ Limited (1000 item max) |

## When to Use Each

### Use Original Sync If:
- [ ] You have unlimited API calls
- [ ] You want error resilience (fail gracefully per stream)
- [ ] You need to fetch >1000 items
- [ ] You want fine-grained control per stream

### Use Optimized Sync If:
- [x] You have Inoreader's 100-call/day limit
- [x] You want maximum efficiency
- [x] You want to sync multiple times per day
- [x] You need simple, fast syncing

## Monthly Cost Analysis

### Scenario: Daily Sync with Original Approach

```
Calls per day:    30
Calls per month:  900

Problem: 100-call limit
Solution: Can only sync ~3 times per month
         (and that's the ONLY thing you do)
```

### Scenario: Daily Sync with Optimized Approach

```
Calls per day:    1
Calls per month:  30

Available for:    - 70 other calls/month
                  - Multiple daily syncs
                  - User-initiated refreshes
                  - API experimentation
```

## Data Freshness Comparison

### Original Sync
- Frequency: Once per day (limited by API budget)
- Freshness: 1-day old data
- Staleness: 24 hours typical

### Optimized Sync
- Frequency: Can run multiple times per day
- Freshness: 2-4 hours typical
- Staleness: Could be <4 hours if run 4× daily

## Implementation Path

### Phase 1: Current State ✅
- Both sync methods available
- Original sync in `/api/admin/sync/`
- Optimized sync in `/api/admin/sync-optimized/`

### Phase 2: Transition (Recommended)
- Use `/api/admin/sync-optimized/all` for production
- Keep original as backup/fallback
- Schedule optimized sync daily at 2am

### Phase 3: Future
- If API limit changes, easy to switch strategies
- Code is modular, both can coexist
- No breaking changes to other systems

## Quick Decision Matrix

```
Do you have Inoreader?
│
├─ YES → Is your limit 100 calls/day?
│        │
│        ├─ YES → USE OPTIMIZED ✅
│        │        POST /api/admin/sync-optimized/all
│        │
│        └─ NO → USE ORIGINAL
│               POST /api/admin/sync/all
│
└─ NO → Use original or other strategy
```

## API Endpoint Reference

### Original (Per-Stream)
```bash
# Full sync
curl -X POST http://localhost:3000/api/admin/sync/all

# Single category
curl -X POST "http://localhost:3000/api/admin/sync/category?category=research"
```

### Optimized (Bulk)
```bash
# Full sync (1 call!)
curl -X POST http://localhost:3000/api/admin/sync-optimized/all

# Single category (1 call)
curl -X POST "http://localhost:3000/api/admin/sync-optimized/category?category=research"

# By label
curl -X POST "http://localhost:3000/api/admin/sync-optimized/label?labelId=user/123/label/Code_Intelligence"
```

## Scheduling Recommendation

Given your 100-call/day limit:

### Recommended: Use Optimized + Schedule Daily

```bash
# Schedule with cron-job.org or similar
# Run at 2am UTC daily
0 2 * * * curl -X POST https://your-domain.com/api/admin/sync-optimized/all

# Cost: 1 call/day
# Remaining: 99 calls/day for other uses
# Freshness: Data updates daily
```

### Alternative: Use Optimized + Multiple Daily

```bash
# Run 4 times daily for fresher data
0 2,8,14,20 * * * curl -X POST https://your-domain.com/api/admin/sync-optimized/all

# Cost: 4 calls/day
# Remaining: 96 calls/day for other uses
# Freshness: Data updates every 6 hours
```

### Not Recommended: Use Original

```bash
# This would cost 30+ calls per sync
# With 100-call limit, you can't sync more than 3× per month
# Not recommended
```

## Technical Details

### Original Sync Flow
```
For each category:
  For each stream in category:
    GET /stream/contents/{streamId}
    Normalize items
    Categorize items
    Save to database
```

**Result**: 30+ database transactions, 30+ API calls

### Optimized Sync Flow
```
GET /stream/contents/user/{userId}/state/com.google/all
Normalize items (all at once)
Categorize items (all at once)
Save to database (one transaction)
```

**Result**: 1 database transaction, 1 API call

## Error Handling

### Original Sync
If stream fails:
```
Fetch stream 1: ✅ Success
Fetch stream 2: ❌ Error (skip, log, continue)
Fetch stream 3: ✅ Success
...
Result: Partial sync, some items added
```

**Benefit**: Robust, missing one stream doesn't break everything

### Optimized Sync
If fetch fails:
```
Fetch all items: ❌ Error
Result: Nothing saved, full sync fails
```

**Drawback**: All-or-nothing, but rare (API either works or doesn't)

**Mitigation**: Detailed logging, error monitoring, easy retry

## Recommendation Summary

**For your situation (100-call/day Inoreader limit):**

✅ **Use Optimized Sync** 
- Cost: 1 call per daily sync
- Benefit: 99 calls remaining
- Schedule: Daily at 2am
- Result: Fresh data every morning + plenty of API budget

```bash
# One-time setup
POST /api/admin/sync-optimized/all

# Then schedule with cron-job.org:
0 2 * * * curl -X POST https://your-domain.com/api/admin/sync-optimized/all
```

This gives you:
- ✅ Daily fresh data
- ✅ 99 API calls/day for other features
- ✅ Simple, fast, reliable
- ✅ Can increase frequency later if needed
