# Relevance Tuning UI Implementation

Complete implementation of the relevance tuning interface, allowing users to manage source relevance and rate items directly from the UI.

## What Was Built

### Components

**1. SourceRelevanceDropdown** (`src/components/tuning/source-relevance-dropdown.tsx`)
- Dropdown selector for 0-3 relevance ratings
- Shows current rating and multiplier effect
- Color-coded options (red for ignore, yellow for relevant, green for highly relevant)
- Handles API calls directly or via callback

**2. ItemRelevanceBadge** (`src/components/tuning/item-relevance-badge.tsx`)
- Star icon button for rating individual items
- Displays current rating and category tags
- Optional notes field for detailed feedback
- Independent per-item, supports multi-category awareness

**3. SourcesPanel** (`src/components/tuning/sources-panel.tsx`)
- Dashboard showing all feed sources
- Filter by category
- Real-time update of ratings
- Fetch and display source list with current scores

**4. StarredItemsPanel** (`src/components/tuning/starred-items-panel.tsx`)
- Lists starred items from Inoreader
- Sync button to pull new starred items
- Filter to show only unrated items
- Real-time rating with optional notes
- Display stats (total/unrated counts)

**5. Admin Page** (`app/admin/page.tsx`)
- Two-tab interface: Sources and Starred Items
- Token-based authentication (session-only)
- Full admin tuning workflow in one place

### Features

**Source Relevance Management**
- Dropdown menu next to each source
- Four-level rating system (0-3)
- Real-time DB updates via API
- Category filtering
- Multiplier display (1.0x to 1.6x)

**Item Rating**
- Star badge on every digest item
- Rate without leaving digest view
- Category information shown
- Optional notes for context
- Independent ratings per item

**Starred Items Curation**
- Sync from Inoreader with one click
- View and rate starred items
- Track rating status (unrated count)
- Add notes explaining relevance
- Shows item details and summary

**Admin Dashboard**
- `/admin` route with authentication
- Two main sections: Sources and Starred Items
- Token validation (browser session only)
- Clean, organized interface

### Integration Points

**Main Home Page**
- ⚙️ Tuning button in header links to `/admin`
- ⚡ icon next to each source links to admin (for quick access)
- Each item has ⭐ Rate button inline

**Item Cards**
- ItemRelevanceBadge component integrated
- Shows categories when rating
- Supports starred/unstarred status
- Can pass in existing ratings

**Database Integration**
- Source relevance stored in `feeds.source_relevance` column
- Item ratings stored in `starred_items.relevance_rating` column
- Notes stored in `starred_items.notes`
- Timestamps tracked for audit trail

## User Experience Flow

### For Source Management
1. User clicks ⚙️ Tuning → Opens `/admin`
2. Authenticates with ADMIN_API_TOKEN (stored in session only)
3. Sources tab shows all feeds
4. User clicks dropdown next to feed → selects rating (0-3)
5. Changes saved immediately to DB
6. Can filter by category to focus on specific areas

### For Item Rating
1. User views digest items
2. Sees ⭐ Rate button on each item
3. Clicks button → rating dialog opens
4. Selects rating, optionally adds notes
5. Rating saved to DB
6. Badge updates to show current rating

### For Starred Items Curation
1. User clicks Starred Items tab in admin
2. Clicks "Sync from Inoreader" to pull new starred items
3. System fetches all starred items from Inoreader
4. Filters to show "unrated" by default
5. User clicks ⭐ on each item to rate
6. Can toggle to see all (rated + unrated)
7. Stats show progress

## Technical Architecture

### Database Schema
```sql
-- Source relevance (added to feeds table)
ALTER TABLE feeds ADD COLUMN source_relevance INTEGER DEFAULT 1;

-- Starred items (new table)
CREATE TABLE starred_items (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE,
  inoreader_item_id TEXT NOT NULL UNIQUE,
  relevance_rating INTEGER,  -- 0-3 or NULL
  notes TEXT,
  starred_at INTEGER NOT NULL,
  rated_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- Indexes for performance
CREATE INDEX idx_starred_items_item_id ON starred_items(item_id);
CREATE INDEX idx_starred_items_inoreader_id ON starred_items(inoreader_item_id);
CREATE INDEX idx_starred_items_rating ON starred_items(relevance_rating);
```

### API Endpoints Used

**GET /api/admin/source-relevance**
- Fetches all sources with current ratings
- No auth required for read (but recommended)

**POST /api/admin/source-relevance**
- Updates a source's relevance rating
- Requires: ADMIN_API_TOKEN
- Body: `{streamId, relevance}`

**GET /api/admin/starred**
- Lists starred items with optional filters
- Query params: onlyUnrated, limit, offset
- Returns: items[], total, unrated

**PATCH /api/admin/starred/:inoreaderItemId**
- Rate a starred item
- Requires: ADMIN_API_TOKEN
- Body: `{rating, notes?}`

**POST /api/admin/sync-starred**
- Pull all starred items from Inoreader
- Requires: ADMIN_API_TOKEN
- Returns: stats on sync operation

### Components Tree
```
app/page.tsx
├── ⚙️ Tuning link
└── ItemCard
    ├── ⚡ admin link (next to source)
    └── ItemRelevanceBadge (⭐ Rating button)

app/admin/page.tsx
├── Token auth form
├── Tabs (Sources | Starred Items)
├── SourcesPanel
│   ├── Filter buttons
│   └── SourceRelevanceDropdown (per source)
└── StarredItemsPanel
    ├── Sync button
    ├── Filter button
    └── ItemRelevanceBadge (per item)
```

## Styling

All components use Tailwind CSS with the existing design system:
- Color scheme: dark/black background with blue accents
- Consistent padding/spacing with existing components
- Hover states for interactivity
- Loading/disabled states handled
- Responsive design (mobile-friendly)

### Color Coding
- **Red** (text-red-400): Ignore (0)
- **Gray** (text-gray-400): Neutral (1)
- **Yellow** (text-yellow-400): Relevant (2)
- **Green** (text-green-400): Highly Relevant (3)

## Security

**Token Authentication**
- No persistent storage of admin token
- Token only kept in browser memory (lost on refresh/close)
- Required for write operations (POST, PATCH)
- Passed via Authorization header as Bearer token

**API Protection**
- All admin endpoints check ADMIN_API_TOKEN environment variable
- Unauthorized requests return 401 status
- Token comparison is straightforward string match

## Performance Considerations

**Optimizations**
- Source list fetched once on page load (not per dropdown)
- Starred items paginated (50 at a time by default)
- Database indexes on common query columns
- Dropdown menus use client-side state (no extra API calls)

**Potential Future Improvements**
- Debounce rapid rating changes
- Batch update API for multiple items
- Caching of source list
- Offline support with sync

## Files Added

```
src/components/tuning/
├── source-relevance-dropdown.tsx      # Source rating dropdown
├── item-relevance-badge.tsx          # Item rating badge  
├── sources-panel.tsx                 # Sources management panel
└── starred-items-panel.tsx           # Starred items curation

app/
└── admin/
    └── page.tsx                      # Admin dashboard

Documentation/
├── RELEVANCE_TUNING.md              # API docs (existing)
└── UI_TUNING_GUIDE.md               # User guide (new)
```

## Updated Files

```
src/components/feeds/item-card.tsx     # Added ItemRelevanceBadge + source link
app/page.tsx                            # Added ⚙️ Tuning button
src/lib/db/index.ts                    # Added schema migrations
AGENTS.md                               # Added relevance tuning commands
```

## Testing Checklist

- [ ] Source relevance dropdown opens/closes
- [ ] Source rating changes save to DB
- [ ] Category filter works in Sources panel
- [ ] Item rating badge appears in digest
- [ ] Item rating dialog opens and closes
- [ ] Item ratings save with notes
- [ ] Starred items sync pulls from Inoreader
- [ ] Unrated filter shows only unrated items
- [ ] Stats update correctly after rating
- [ ] Admin page requires auth token
- [ ] Token validation works
- [ ] "Sign Out" clears token
- [ ] Multiple rating changes don't cause errors
- [ ] Category tags display in rating dialog

## Future Enhancements

1. **Visualization**
   - Chart showing source rating distribution
   - Item rating histogram
   - Starred items history timeline

2. **Analytics**
   - Show which sources have highest ratings
   - Identify consistently relevant categories
   - Track rating patterns over time

3. **Automation**
   - Auto-adjust source relevance based on ratings
   - ML feedback loop: ratings → LLM prompt tuning
   - Suggest relevance scores for new sources

4. **Integration**
   - Category-specific relevance (feed rated differently per category)
   - Item quality signals from ratings
   - Feedback for digest ranking algorithm

5. **UX Improvements**
   - Bulk operations (rate multiple items)
   - Save rating presets
   - Keyboard shortcuts
   - Export ratings as CSV

## Conclusion

The UI implementation provides a complete, user-friendly interface for managing source and item relevance. Users can now:
- Adjust source quality ratings with a simple dropdown
- Rate individual items inline while browsing
- Curate starred items from Inoreader
- See immediate feedback in the database

The system is ready for manual tuning and can serve as the foundation for ML feedback loops in the future.
