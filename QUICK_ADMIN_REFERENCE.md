# Quick Admin Reference

## Quick Start

1. **Access Admin Panel**
   - Home page: Click ⚙️ Tuning button
   - Direct: Go to `/admin`
   - Paste your `ADMIN_API_TOKEN`

2. **Manage Sources**
   - Click dropdown next to feed name
   - Select rating: 0 (Ignore), 1 (Neutral), 2 (Relevant), 3 (Highly Relevant)
   - Changes save immediately

3. **Rate Items in Digest**
   - Click ⭐ Rate button on any item
   - Select rating (0-3)
   - Add optional notes
   - Saves immediately

4. **Curate Starred Items**
   - Go to Starred Items tab
   - Click "Sync from Inoreader"
   - Rate unrated items
   - Repeat weekly

## Component Usage

### Use SourceRelevanceDropdown
```tsx
import SourceRelevanceDropdown from '@/src/components/tuning/source-relevance-dropdown';

<SourceRelevanceDropdown
  streamId="feed/..."
  sourceName="Example Feed"
  currentRelevance={2}
  onRelevanceChange={async (streamId, relevance) => {
    // Handle change
  }}
/>
```

### Use ItemRelevanceBadge
```tsx
import ItemRelevanceBadge from '@/src/components/tuning/item-relevance-badge';

<ItemRelevanceBadge
  itemId="item-123"
  inoreaderItemId="456789"
  currentRating={2}
  starred={true}
  categories={['tech_articles', 'ai_news']}
  onRatingChange={async (itemId, rating, notes) => {
    // Handle rating
  }}
/>
```

### Use SourcesPanel
```tsx
import SourcesPanel from '@/src/components/tuning/sources-panel';

<SourcesPanel 
  adminToken={token}
/>
```

### Use StarredItemsPanel
```tsx
import StarredItemsPanel from '@/src/components/tuning/starred-items-panel';

<StarredItemsPanel 
  adminToken={token}
/>
```

## API Endpoints

### Sources
```bash
# Get all sources with ratings
curl http://localhost:3002/api/admin/source-relevance

# Set source relevance
curl -X POST http://localhost:3002/api/admin/source-relevance \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"streamId": "feed/...", "relevance": 2}'
```

### Starred Items
```bash
# List starred items
curl "http://localhost:3002/api/admin/starred?onlyUnrated=true&limit=20"

# Rate a starred item
curl -X PATCH http://localhost:3002/api/admin/starred/:inoreaderItemId \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating": 2, "notes": "..."}'

# Sync from Inoreader
curl -X POST http://localhost:3002/api/admin/sync-starred \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

## Database

### Source Relevance Column
```sql
SELECT stream_id, canonical_name, source_relevance 
FROM feeds 
WHERE source_relevance > 1;
```

### Starred Items Table
```sql
SELECT * FROM starred_items 
WHERE relevance_rating IS NULL 
ORDER BY starred_at DESC 
LIMIT 10;
```

### Update Rating
```sql
UPDATE starred_items 
SET relevance_rating = 2, notes = '...' 
WHERE inoreader_item_id = '...';
```

## Configuration

### Environment Variables
```bash
# Required for API auth
ADMIN_API_TOKEN=your_secure_token_here

# Optional (defaults to http://localhost:3002)
NEXT_PUBLIC_ADMIN_URL=https://yourhost.com
```

## Rating Scale Quick Reference

| Rating | Label | Effect | When to Use |
|--------|-------|--------|------------|
| 0 | Ignore | 0.0x (filtered) | Low quality sources, spam |
| 1 | Neutral | 1.0x (no change) | Default, average quality |
| 2 | Relevant | 1.3x (30% boost) | Good sources you trust |
| 3 | Highly Relevant | 1.6x (60% boost) | Excellent sources, must-read |

## Common Tasks

### Boost a Great Source
1. Go to Sources tab
2. Find the feed (e.g., "Pragmatic Engineer")
3. Click dropdown → Select "Highly Relevant" (3)

### Filter Out Bad Source
1. Go to Sources tab
2. Find the feed
3. Click dropdown → Select "Ignore" (0)

### Rate Today's Articles
1. Click ⚙️ Tuning
2. Go to Starred Items
3. Click "Sync from Inoreader"
4. Rate items: click ⭐ on each
5. Select rating and optionally add notes

### Check Source Quality
1. Go to Sources tab
2. Filter by category (e.g., "newsletters")
3. Scan for sources with (2) or (3) rating
4. Those are your trusted feeds

### Find High-Rated Items
1. Starred Items tab
2. Click "Show All" (not just unrated)
3. Filter by rating in database:
```sql
SELECT title, source_title, relevance_rating 
FROM starred_items 
WHERE relevance_rating = 3 
ORDER BY rated_at DESC;
```

## Keyboard Shortcuts (Future)
```
/ = Focus search
? = Open help
r = Rate current item
e = Toggle starred
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Token not working | Refresh page, re-paste token from server env |
| Changes not saving | Check browser console, verify network tab |
| Sync shows 0 items | Star items in Inoreader first, try again |
| Dropdown not opening | Check for JavaScript errors, refresh page |
| Relevance not affecting digest | Restart digest generation or wait for cache clear |

## Performance Notes

- Source list cached in memory after first load
- Starred items paginated (50 at a time)
- Ratings save immediately (no batch delay)
- Changes don't retroactively affect old digests

## File Locations

| Component | Path |
|-----------|------|
| SourceRelevanceDropdown | `src/components/tuning/source-relevance-dropdown.tsx` |
| ItemRelevanceBadge | `src/components/tuning/item-relevance-badge.tsx` |
| SourcesPanel | `src/components/tuning/sources-panel.tsx` |
| StarredItemsPanel | `src/components/tuning/starred-items-panel.tsx` |
| Admin Page | `app/admin/page.tsx` |
| Database Functions | `src/lib/db/sourceRelevance.ts`, `src/lib/db/starredItems.ts` |
| Inoreader Functions | `src/lib/inoreader/starred.ts` |

## Next Steps

1. Set `ADMIN_API_TOKEN` environment variable
2. Test `/admin` page with token
3. Rate some sources in Sources tab
4. Add some items to Starred in Inoreader
5. Go to Starred Items tab and sync
6. Rate the starred items
7. Watch for impact on digest ranking

## Integration Points

- `app/page.tsx` - Added ⚙️ Tuning button
- `src/components/feeds/item-card.tsx` - Added ItemRelevanceBadge
- `src/lib/db/index.ts` - Schema migrations for new tables
- `AGENTS.md` - Added relevance commands documentation
