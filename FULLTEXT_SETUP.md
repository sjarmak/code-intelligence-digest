# Full Text Fetching Setup

## Overview

The system now supports fetching and caching complete article text from sources for enhanced newsletter and podcast generation. This allows the LLM to work with full content instead of just summaries.

## What's New

### Database Schema Updates

Added to `items` table:
```sql
full_text TEXT              -- Cached full article text
full_text_fetched_at INT    -- When text was fetched (Unix timestamp)
full_text_source TEXT       -- Source: "web_scrape" | "arxiv" | "error"
```

### New Modules

**`src/lib/pipeline/fulltext.ts`**
- `fetchFullText(item)` — Fetch full text from a single item
- `fetchFullTextBatch(items, maxConcurrent)` — Fetch multiple with rate limiting
- `hasCachedFullText(item)` — Check if full text is cached
- `enrichItemsWithFullText(items, fullTextMap)` — Merge full text into items

**`app/api/admin/fulltext/route.ts`**
- `GET /api/admin/fulltext/status` — View cache statistics
- `POST /api/admin/fulltext/fetch` — Trigger fetching for items

### New Scripts

**`scripts/migrate-add-fulltext.ts`**
- Adds full_text columns to existing database
- Idempotent (safe to run multiple times)

## Setup Instructions

### 1. Run Migration

```bash
npx tsx scripts/migrate-add-fulltext.ts
```

Adds `full_text`, `full_text_fetched_at`, `full_text_source` columns to items table.

### 2. Check Cache Status

```bash
curl http://localhost:3000/api/admin/fulltext/status
```

Response:
```json
{
  "status": "ok",
  "cache": {
    "total": 11421,
    "cached": 0,
    "bySource": {}
  },
  "percentCached": 0
}
```

### 3. Start Fetching Full Text

Fetch full text for recent items:

```bash
curl -X POST http://localhost:3000/api/admin/fulltext/fetch \
  -H "Content-Type: application/json" \
  -d '{
    "category": "tech_articles",
    "limit": 10,
    "skip_cached": true
  }'
```

Parameters:
- `category` (optional): Fetch from specific category (or all if omitted)
- `limit` (optional): Max items to fetch (default: 10, max: 50)
- `skip_cached` (optional): Skip items that already have full text (default: true)

Response:
```json
{
  "status": "ok",
  "itemsToFetch": 10,
  "itemsFetched": 10,
  "successful": 9,
  "failed": 1,
  "duration": "12.5s",
  "cache": {
    "total": 11421,
    "cached": 9,
    "bySource": {
      "web_scrape": 8,
      "arxiv": 1
    }
  }
}
```

## How It Works

### Fetching Strategy

1. **arXiv Detection**: If URL contains `arxiv.org`, uses arXiv API to fetch summary
2. **Web Scraping**: Falls back to fetching HTML and extracting text
3. **Error Handling**: Retries up to 3 times with exponential backoff
4. **Rate Limiting**: Max 1 request per 500ms per domain to respect rate limits

### Content Extraction

**Web Pages**:
- Removes scripts and styles
- Strips HTML tags
- Decodes HTML entities
- Cleans whitespace
- Returns plain text

**arXiv Papers**:
- Fetches via official arXiv API
- Extracts abstract/summary from XML response
- More reliable than scraping PDFs

### Caching

- Full text stored in database (encrypted at rest if desired)
- `full_text_source` tracks how it was fetched
- Timestamp recorded for cache invalidation
- Safe to re-fetch (skips cached items by default)

## Rate Limiting & Performance

**Limits**:
- 1 request per 500ms per domain (2 requests/second max)
- 10-second timeout per request
- 3 retries with exponential backoff (1s, 2s, 4s)
- 3 parallel requests by default (configurable)

**Expected Performance**:
- 10 items: ~15-30 seconds (depending on domain speed)
- 50 items: ~60-120 seconds
- 1,000 items: ~2-4 hours (best done overnight)

## Best Practices

### Initial Population

For production, fetch full text in batches:

```bash
# Fetch recent tech articles
curl -X POST http://localhost:3000/api/admin/fulltext/fetch \
  -H "Content-Type: application/json" \
  -d '{ "category": "tech_articles", "limit": 50 }'

# Then other categories
curl -X POST http://localhost:3000/api/admin/fulltext/fetch \
  -H "Content-Type: application/json" \
  -d '{ "category": "newsletters", "limit": 50 }'
```

### Regular Updates

Schedule periodic fetching for new items (e.g., in daily sync):

```typescript
// In daily sync script
const newItems = await loadNewItems(1); // Last day
const results = await fetchFullTextBatch(newItems, 3);

// Save results
for (const [itemId, result] of results) {
  await saveFullText(itemId, result.text, result.source);
}
```

### Monitoring Cache

Check cache stats regularly:

```bash
# Check cache status
curl http://localhost:3000/api/admin/fulltext/status | jq .

# Expected output
{
  "status": "ok",
  "cache": {
    "total": 11421,
    "cached": 8500,
    "bySource": {
      "web_scrape": 7200,
      "arxiv": 1300
    }
  },
  "percentCached": 74
}
```

## Error Handling

If fetching fails for an item:
- Stores `full_text_source = "error"` 
- Newsletter/podcast generation falls back to summary
- Item is still usable (no blocking failures)

Check failed items:
```bash
sqlite3 .data/digest.db "
  SELECT COUNT(*), full_text_source 
  FROM items 
  GROUP BY full_text_source
"
```

## Integration with Newsletter/Podcast Generation

When generating newsletter/podcast with full text:

```typescript
// Newsletter generation
const items = await loadItemsByCategory(category, 7);

// Fetch full text for top items
const topItems = items.slice(0, 20);
const fullTextMap = await fetchFullTextBatch(topItems, 3);
const enriched = enrichItemsWithFullText(topItems, fullTextMap);

// Generate with full text
const newsletter = await generateNewsletter(enriched, {
  categories,
  period,
  limit,
  prompt,
  useFullText: true  // Use full_text if available, fall back to summary
});
```

## Database Queries

### Check full text cache

```sql
-- Count by source
SELECT full_text_source, COUNT(*) 
FROM items 
WHERE full_text IS NOT NULL 
GROUP BY full_text_source;

-- Recent full text
SELECT title, full_text_source, full_text_fetched_at 
FROM items 
WHERE full_text IS NOT NULL 
ORDER BY full_text_fetched_at DESC 
LIMIT 10;

-- Items without full text
SELECT COUNT(*) 
FROM items 
WHERE full_text IS NULL;

-- Cache size (MB)
SELECT ROUND(SUM(LENGTH(full_text)) / 1024.0 / 1024.0, 2) as cache_size_mb
FROM items
WHERE full_text IS NOT NULL;
```

### Clear cache (if needed)

```sql
-- Clear all full text
UPDATE items SET full_text = NULL, full_text_source = NULL, full_text_fetched_at = NULL;

-- Clear only failed attempts
UPDATE items SET full_text = NULL, full_text_source = NULL 
WHERE full_text_source = 'error';

-- Clear old cache (older than 30 days)
UPDATE items SET full_text = NULL, full_text_source = NULL
WHERE full_text_fetched_at < strftime('%s', 'now') - (30 * 86400);
```

## Troubleshooting

### Issue: Fetching is slow

**Solution**: Reduce limit and fetch in batches
```bash
curl -X POST http://localhost:3000/api/admin/fulltext/fetch \
  -H "Content-Type: application/json" \
  -d '{ "limit": 5 }'
```

### Issue: Many failures for a domain

**Solution**: Manually check URLs from that domain
```bash
sqlite3 .data/digest.db "
  SELECT DISTINCT source_title FROM items 
  WHERE full_text_source = 'error'
  LIMIT 10;
"
```

### Issue: Database growing too large

**Solution**: Clear old or failed cache
```bash
sqlite3 .data/digest.db "
  UPDATE items SET full_text = NULL, full_text_source = NULL
  WHERE full_text_source = 'error';
"
```

## Next Steps

1. ✅ Run migration
2. ✅ Check cache status
3. ✅ Start fetching for key categories (tech_articles, research)
4. ✅ Integrate into newsletter/podcast generation
5. ✅ Monitor cache stats and iterate

All set! Full text fetching is ready to use. 🚀
