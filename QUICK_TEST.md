# Quick Test Guide: Manual Verification

Run these commands to verify everything works end-to-end.

## Setup (First Time Only)

```bash
# Install dependencies
npm install

# Verify code quality
npm run typecheck   # Should pass
npm run lint        # Should pass

# Start dev server
npm run dev
# Server runs on http://localhost:3000
```

## Test 1: Database Initialization

```bash
# Check if database exists and has tables
sqlite3 .data/digest.db ".tables"

# Expected output:
# cache_metadata digest_selections feeds items item_embeddings
# item_scores

# Verify tables are empty (first run)
sqlite3 .data/digest.db "SELECT COUNT(*) FROM items;"
# Expected: 0 (or whatever number from previous sync)
```

## Test 2: Sync Data from Inoreader

```bash
# In a new terminal (while dev server is running), sync all categories
curl -X POST http://localhost:3000/api/admin/sync/all

# Expected response:
# {
#   "success": true,
#   "categoriesProcessed": ["newsletters", "podcasts", ...],
#   "itemsAdded": 427,
#   "errors": [],
#   "timestamp": "2025-12-04T15:30:00Z"
# }

# Check logs in dev terminal for [INFO] entries showing sync progress
```

## Test 3: Read Items via API

```bash
# Get items for a category
curl http://localhost:3000/api/items?category=newsletters&period=week

# Expected response:
# {
#   "items": [
#     {
#       "id": "...",
#       "title": "...",
#       "url": "...",
#       "sourceTitle": "...",
#       "category": "newsletters",
#       "finalScore": 0.85,
#       ...
#     }
#   ],
#   "category": "newsletters",
#   "period": "week",
#   "count": 15,
#   "source": "database_cache"
# }

# If empty cache, should suggest sync:
# {
#   "items": [],
#   "message": "No cached items for category: newsletters. Run POST /api/admin/sync to fetch from Inoreader.",
#   "hint": "curl -X POST http://localhost:3000/api/admin/sync/category?category=newsletters"
# }
```

## Test 4: Search

```bash
# Search for items
curl "http://localhost:3000/api/search?q=code+search&category=research&period=week&limit=5"

# Expected response:
# {
#   "query": "code search",
#   "category": "research",
#   "period": "week",
#   "itemsSearched": 142,
#   "resultsReturned": 5,
#   "results": [
#     {
#       "id": "...",
#       "title": "...",
#       "similarity": 0.847,
#       ...
#     }
#   ]
# }

# Note: First search will be slower (generates embeddings)
#       Subsequent searches will be instant (cached embeddings)
```

## Test 5: Ask a Question

```bash
# Ask a question
curl "http://localhost:3000/api/ask?question=What+is+semantic+search?&category=research&period=week"

# Expected response:
# {
#   "question": "What is semantic search?",
#   "answer": "Based on the code intelligence digest, here's what I found related to 'What is semantic search?':\n\nKey sources...",
#   "sources": [
#     {
#       "id": "...",
#       "title": "...",
#       "url": "...",
#       "sourceTitle": "...",
#       "relevance": 0.892
#     }
#   ],
#   "category": "research",
#   "period": "week",
#   "generatedAt": "2025-12-04T15:30:00Z"
# }

# Note: Answers are template-based (will be Claude API in next session)
```

## Test 6: Browse UI

Visit http://localhost:3000 in your browser and verify:

### Digest Tab ✅
- [ ] Shows list of items in grid
- [ ] Items have title, source, category badge, snippet
- [ ] Category tabs at top (Newsletters, Podcasts, Tech Articles, etc)
- [ ] Period selector (Weekly/Monthly)
- [ ] Clicking title opens link in new tab
- [ ] Items are ranked by final score

### Search Tab ✅
- [ ] Search box accepts queries
- [ ] Can filter by category (optional dropdown)
- [ ] Can select time period (week/month)
- [ ] Search button works
- [ ] Results show:
  - Title (clickable)
  - Source name
  - Publication date
  - Category badge
  - Similarity score with % and bar
  - Read more link

### Ask Tab ✅
- [ ] Question textarea accepts input
- [ ] Can filter by category (optional dropdown)
- [ ] Can select time period (week/month)
- [ ] Ask button works
- [ ] Results show:
  - Question at top
  - Answer text
  - Numbered source citations
  - Source name and relevance score
  - Links to sources

## Test 7: Performance Check

```bash
# Time the operations
time curl http://localhost:3000/api/items?category=newsletters

# Expected timing:
# - First call: ~100ms
# - Subsequent calls: ~50-100ms
# Should see "real 0.05s" or similar

# Compare with search (embeddings generated on first run)
time curl "http://localhost:3000/api/search?q=test&limit=1"

# First call: ~300-500ms (generates embeddings)
# Second call: ~100-200ms (uses cached embeddings)
```

## Test 8: Database Verification

```bash
# Check items count per category
sqlite3 .data/digest.db "
SELECT category, COUNT(*) as count 
FROM items 
GROUP BY category 
ORDER BY count DESC;
"

# Expected: One row per category with item counts

# Check embeddings cache
sqlite3 .data/digest.db "
SELECT COUNT(*) as cached_embeddings FROM item_embeddings;
"

# Should increase as you do searches

# Check scores stored
sqlite3 .data/digest.db "
SELECT COUNT(*) as stored_scores FROM item_scores;
"

# Should have scores for ranked items
```

## Test 9: Error Handling

```bash
# Try invalid category
curl http://localhost:3000/api/items?category=invalid

# Expected: 400 error with helpful message

# Try empty search
curl "http://localhost:3000/api/search?q="

# Expected: 400 error asking for search query

# Try empty question
curl "http://localhost:3000/api/ask?question="

# Expected: 400 error asking for question
```

## Test 10: Code Quality

```bash
# Verify TypeScript (should be instant)
npm run typecheck
# Expected: No errors

# Verify ESLint (should be instant)
npm run lint
# Expected: No warnings

# Note: Build may have Turbopack issue (Next.js 16 bug)
# but dev server works fine with: npm run dev
```

## Sync Testing

### Test Manual Sync

```bash
# Sync all categories
curl -X POST http://localhost:3000/api/admin/sync/all

# Watch logs in dev terminal for progress
# Should see: [INFO] messages for each category
```

### Test Category Sync

```bash
# Sync just one category
curl -X POST "http://localhost:3000/api/admin/sync/category?category=research"

# Should see similar progress but for single category only
```

### Test Incremental Sync

```bash
# Sync same category twice
curl -X POST "http://localhost:3000/api/admin/sync/category?category=newsletters"

# First time: Adds items
# Second time: Updates/merges items (database handles duplicates with UPSERT)

# Both should complete successfully
```

## Troubleshooting Failing Tests

### "No items found" after sync
- Check database: `sqlite3 .data/digest.db "SELECT COUNT(*) FROM items;"`
- If 0, Inoreader API may have hit rate limit
- Check logs for [ERROR] entries
- Try again in a few hours (rate limits reset daily)

### Search returns no results
- Make sure you synced data first
- Search generates embeddings on first run (slower)
- Try simpler query: `"test"` instead of `"complex query"`
- Check: `SELECT COUNT(*) FROM item_embeddings;`

### Database errors
- Try deleting database: `rm .data/digest.db`
- Restart dev server: `npm run dev`
- Database will auto-initialize on first request

### TypeScript/ESLint errors
- Run: `npm run typecheck`
- Run: `npm run lint`
- Check output for specific files
- See IMPLEMENTATION_GUIDE.md for common issues

## Success Checklist

- [ ] Database initializes (`.tables` shows tables)
- [ ] Sync completes without errors (itemsAdded > 0)
- [ ] GET /api/items returns ranked items
- [ ] GET /api/search returns results with similarity scores
- [ ] GET /api/ask returns answer with source citations
- [ ] UI tabs work (Digest/Search/Ask)
- [ ] UI search and ask forms are functional
- [ ] TypeScript passes (no errors)
- [ ] ESLint passes (no warnings)
- [ ] All timing is <500ms (database backed)

## Performance Baselines

These are expected timings on a modern machine:

| Operation | Uncached | Cached | 
|-----------|----------|--------|
| GET /api/items | 100ms | 50-100ms |
| GET /api/search (first query) | 300-500ms | - |
| GET /api/search (cached) | 100-200ms | - |
| GET /api/ask | 200-400ms | - |
| Full sync (all categories) | 15-30s | - |
| Single category sync | 2-5s | - |

If your times are significantly slower, check:
1. CPU/memory usage
2. Database size: `SELECT COUNT(*) FROM items;`
3. Network latency to Inoreader API
4. Check logs for warnings/errors

---

**Time to run all tests**: ~15 minutes
**Expected success rate**: 95%+ (Inoreader rate limits may cause failures)
**Main failure cause**: Inoreader daily rate limit (wait until next day)

See IMPLEMENTATION_GUIDE.md for more detailed troubleshooting.
