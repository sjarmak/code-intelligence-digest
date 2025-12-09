# Relevance Tuning System

Quick guide to the new relevance ranking and starred items curation system.

## Architecture

### Database Tables

**`feeds.source_relevance`** (new column)
- `0`: Ignore (filtered out, 0.0x multiplier)
- `1`: Neutral (default, no adjustment, 1.0x)
- `2`: Relevant (1.3x boost)
- `3`: Highly Relevant (1.6x boost)

**`starred_items`** (new table)
Tracks items marked as important in Inoreader for manual curation:
- `id`: Primary key
- `item_id`: Reference to items table
- `inoreader_item_id`: Original Inoreader ID
- `relevance_rating`: 0-3 rating (null = unrated)
- `notes`: Optional user notes
- `starred_at`: When marked starred in Inoreader
- `rated_at`: When relevance was assigned

### New Modules

**`src/lib/db/sourceRelevance.ts`**
- `setSourceRelevance(streamId, rating)` - Set source relevance
- `getSourceRelevance(streamId)` - Get rating for a source
- `getAllSourcesWithRelevance()` - List all sources with ratings
- `getRelevanceMultiplier(rating)` - Convert rating to scoring multiplier

**`src/lib/db/starredItems.ts`**
- `saveStarredItem(itemId, inoreaderItemId, starredAt)` - Save single starred item
- `saveStarredItems(items)` - Batch save
- `getStarredItems(options)` - Get all with optional filtering
- `rateStarredItem(inoreaderItemId, rating, notes)` - Rate a starred item
- `countStarredItems()` - Total starred count
- `countUnratedStarredItems()` - Unrated count

**`src/lib/inoreader/starred.ts`**
- `fetchStarredItems(limit, continuation)` - Fetch batch from Inoreader
- `fetchAllStarredItems(maxItems)` - Fetch all with pagination

## API Endpoints

All admin endpoints require `Authorization: Bearer $ADMIN_API_TOKEN` header.

### Sync Starred Items from Inoreader
**POST** `/api/admin/sync-starred`

Pulls all starred items from your Inoreader account and saves them to the database.

```bash
curl -X POST http://localhost:3002/api/admin/sync-starred \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

Response:
```json
{
  "success": true,
  "message": "Synced N starred items",
  "stats": {
    "fetched": N,
    "saved": N,
    "starred": N
  }
}
```

### Get Source Relevance Ratings
**GET** `/api/admin/source-relevance`

View all subscribed feeds with their current relevance scores.

```bash
curl http://localhost:3002/api/admin/source-relevance
```

Returns:
```json
{
  "success": true,
  "count": N,
  "sources": [
    {
      "streamId": "feed/https://...",
      "canonicalName": "Source Name",
      "sourceRelevance": 2,
      "relevanceLabel": "Relevant",
      "defaultCategory": "newsletters"
    }
  ]
}
```

### Set Source Relevance
**POST** `/api/admin/source-relevance`

Adjust how much a source contributes to scoring.

```bash
curl -X POST http://localhost:3002/api/admin/source-relevance \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "streamId": "feed/https://pragmaticengineer.com/feed/",
    "relevance": 2
  }'
```

### Get Starred Items
**GET** `/api/admin/starred`

Fetch starred items ready for curation and rating.

```bash
curl "http://localhost:3002/api/admin/starred?onlyUnrated=true&limit=20&offset=0"
```

Query parameters:
- `onlyUnrated=true`: Only unrated items (default: all)
- `limit=50`: Max items to return (default: 50)
- `offset=0`: Pagination offset (default: 0)

Returns:
```json
{
  "success": true,
  "count": N,
  "total": N,
  "unrated": N,
  "items": [
    {
      "id": "starred-...",
      "itemId": "item-...",
      "inoreaderItemId": "...",
      "title": "Article Title",
      "url": "https://...",
      "sourceTitle": "Source Name",
      "publishedAt": "2025-01-15T10:30:00.000Z",
      "summary": "...",
      "relevanceRating": null,
      "notes": null,
      "starredAt": "2025-01-15T10:30:00.000Z",
      "ratedAt": null
    }
  ]
}
```

### Rate a Starred Item
**PATCH** `/api/admin/starred/:inoreaderItemId`

Assign relevance ranking to a starred item.

```bash
curl -X PATCH http://localhost:3002/api/admin/starred/1234567890123456789 \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 2,
    "notes": "Great explanation of semantic search over code"
  }'
```

Rating scale:
- `0`: Not Relevant
- `1`: Somewhat Relevant
- `2`: Relevant
- `3`: Highly Relevant
- `null`: Clear rating

## Workflow

### 1. Syncing Starred Items from Inoreader

Star important articles in your Inoreader account, then sync them:

```bash
curl -X POST http://localhost:3002/api/admin/sync-starred \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

This:
1. Fetches all starred items from Inoreader
2. Creates entries in the database
3. Tracks them in the `starred_items` table for curation

### 2. Rating Starred Items

Browse unrated starred items and assign relevance ratings:

```bash
# Get 20 unrated items
curl "http://localhost:3002/api/admin/starred?onlyUnrated=true&limit=20"

# Rate each item
for item_id in ...; do
  curl -X PATCH http://localhost:3002/api/admin/starred/$item_id \
    -H "Authorization: Bearer $ADMIN_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"rating": 2, "notes": "..."}'
done
```

### 3. Tuning Source Relevance

Adjust how much each source is boosted based on past performance:

```bash
# View current ratings
curl http://localhost:3002/api/admin/source-relevance

# Boost a high-quality source
curl -X POST http://localhost:3002/api/admin/source-relevance \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"streamId": "feed/...", "relevance": 3}'

# Downgrade low-quality source
curl -X POST http://localhost:3002/api/admin/source-relevance \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"streamId": "feed/...", "relevance": 1}'
```

## Integration with Scoring

Once implemented in the ranking pipeline, both systems will apply:

1. **Source relevance multiplier**: Applied per-source during BM25/LLM scoring
   - Helps boost known good sources
   - Filters out irrelevant sources (0x = exclusion)

2. **Starred item feedback**: Use relevance ratings to:
   - Retrain LLM scoring prompts
   - Adjust category thresholds
   - Validate BM25 term weights

## Future Enhancements

- UI dashboard for viewing/rating starred items
- Integration with daily digest workflow
- Analytics on starred item patterns
- Automated source relevance adjustment based on ratings
- ML feedback loop: use ratings to improve LLM scoring
