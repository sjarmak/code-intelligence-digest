# UI Relevance Tuning Guide

Complete guide to using the new relevance tuning interface in the Code Intelligence Digest.

## Overview

The system now provides three ways to tune relevance:

1. **Source Relevance** - Adjust how much each feed contributes to scoring (0-3 scale)
2. **Item Ratings** - Mark individual items as not relevant, relevant, or highly relevant
3. **Starred Items** - Curate starred items from Inoreader with detailed feedback

## Accessing the Tuning Interface

### Main Page
Click the **⚙️ Tuning** button in the top-right corner of the home page.

### Direct URL
Navigate to `/admin` on your deployment.

### First-Time Authentication
On your first visit, you'll be asked to provide your `ADMIN_API_TOKEN`:
- Get your token from the server environment (`$ADMIN_API_TOKEN`)
- Paste it into the authentication dialog
- The token is stored only in your browser session and cleared when you close/refresh

## Tuning Sources (Feeds)

### Access
Click the **Sources** tab in the tuning admin panel.

### Features

**View All Sources**
- Shows all subscribed feeds grouped by category
- Current relevance rating displayed for each

**Filter by Category**
- Use the category filter buttons to see sources in specific categories
- "All" button shows complete list

**Set Source Relevance**
- Click the dropdown next to each source
- Choose a rating:
  - **0 - Ignore** (filtered out, 0.0x multiplier)
  - **1 - Neutral** (no boost, default, 1.0x multiplier)
  - **2 - Relevant** (good sources, 1.3x multiplier)
  - **3 - Highly Relevant** (excellent sources, 1.6x multiplier)

### Effects
- **Ignore (0)**: Items from this source won't appear in digest
- **Neutral (1)**: Normal scoring, no adjustment
- **Relevant (2)**: Final score boosted by 30%
- **Highly Relevant (3)**: Final score boosted by 60%

### Use Cases

**Boost a high-quality newsletter**
1. Go to Sources tab
2. Find "Pragmatic Engineer" or similar
3. Click dropdown → Select "Highly Relevant"
4. Items from that source will be boosted

**Filter out low-quality feeds**
1. Find problematic source
2. Click dropdown → Select "Ignore"
3. No items from that source will appear in digest

## Rating Items

### In Digest View
When viewing items in the main digest, each item has a **⭐ Rate** button:
- Click to open the rating dialog
- Select a rating: Not Relevant, Somewhat Relevant, Relevant, or Highly Relevant
- Optionally add notes explaining your rating
- Rating is saved immediately

### Rating Scale
- **0 - Not Relevant**: Item shouldn't be in digest
- **1 - Somewhat Relevant**: Borderline, might be useful
- **2 - Relevant**: Good match for the digest
- **3 - Highly Relevant**: Excellent, should prioritize

### Item Information
- Categories are shown (e.g., "tech_articles", "ai_news")
- Ratings are independent per item but may be used for category-level tuning
- Add notes about why an item is relevant/irrelevant for future reference

### Multi-Category Items
When an item appears across multiple categories:
- All categories are displayed in the rating dialog
- Single rating applies to the item globally
- However, scoring impacts may be different per category

## Curating Starred Items

### Access
1. Go to `/admin`
2. Click **Starred Items** tab

### Workflow

**Step 1: Sync from Inoreader**
- Click **Sync from Inoreader** button
- This pulls all items you marked as starred in your Inoreader account
- Items are saved locally for curation

**Step 2: View Unrated Items**
- By default, shows only unrated items
- Toggle "Show All" to see previously rated items too
- Shows count: Total starred, Unrated

**Step 3: Rate Each Item**
- Click the **⭐** badge on each item
- Select a rating (0-3)
- Add optional notes about why it's relevant
- Ratings are saved immediately

**Step 4: Monitor Progress**
- Stats at the top show unrated count
- Use filter to focus on unrated items
- Re-sync periodically to get new starred items

### Item Details
Each starred item shows:
- Title (clickable link to original)
- Source and publish date
- Summary/snippet
- Previous rating (if rated)
- Previous notes (if any)

### Use Cases

**Daily curation routine**
1. In Inoreader, star interesting articles throughout the week
2. Go to admin panel
3. Click "Sync from Inoreader"
4. Rate all unrated items
5. Notes explain your reasoning

**Improve LLM scoring**
1. Rate items (especially highly relevant ones)
2. System can learn patterns from your ratings
3. Future items get better scores based on feedback

**Source evaluation**
1. Rate items from specific sources
2. See which sources consistently rank highly/lowly
3. Adjust source relevance accordingly

## Advanced Features

### Independent Category Scoring
Items appearing in multiple categories will have:
- One global rating for the item
- But category-specific multipliers for source relevance
- Example: Pragmatic Engineer might be "Highly Relevant" for tech_articles (1.6x) but "Relevant" for newsletters (1.3x)

### Notes and Feedback
When rating items:
- **Add notes** to explain your rating
- Example notes:
  - "Great explanation of semantic search"
  - "Too generic, not specific to code tooling"
  - "Covers monorepo management well"
- Notes are stored and visible when reviewing ratings

### Filter Unrated
- Helps focus on items that need rating
- Unrated count displayed in stats
- Clearing ratings removes them from the database

## API Details (Advanced)

### Direct API Usage
If integrating with scripts or workflows:

**Set Source Relevance**
```bash
curl -X POST http://localhost:3002/api/admin/source-relevance \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"streamId": "feed/...", "relevance": 2}'
```

**Get All Sources**
```bash
curl http://localhost:3002/api/admin/source-relevance
```

**Get Starred Items**
```bash
curl "http://localhost:3002/api/admin/starred?onlyUnrated=true&limit=20"
```

**Rate a Starred Item**
```bash
curl -X PATCH http://localhost:3002/api/admin/starred/:inoreaderItemId \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rating": 2, "notes": "Great article"}'
```

**Sync Starred from Inoreader**
```bash
curl -X POST http://localhost:3002/api/admin/sync-starred \
  -H "Authorization: Bearer $ADMIN_API_TOKEN"
```

## Data Structure

### Source Relevance
```typescript
{
  streamId: string;        // Inoreader feed ID
  canonicalName: string;   // Feed name
  sourceRelevance: 0-3;    // Current rating
  defaultCategory: string; // Primary category
}
```

### Starred Items
```typescript
{
  id: string;
  itemId: string;
  inoreaderItemId: string;
  title: string;
  url: string;
  sourceTitle: string;
  relevanceRating: 0-3 | null;  // Rating
  notes: string | null;          // User notes
  ratedAt: string | null;        // When rated
  starredAt: string;             // When starred in Inoreader
}
```

## Troubleshooting

**"Invalid token" error**
- Check that `ADMIN_API_TOKEN` environment variable is set
- Make sure you copied the token completely
- Refresh page and try again

**Changes not saving**
- Check browser console for errors
- Verify token is still valid (re-authenticate if needed)
- Check network tab to see API response

**Sync shows 0 items**
- Did you star any items in Inoreader?
- Try syncing again (sometimes takes a moment)
- Check that Inoreader credentials are configured

**Can't access admin page**
- Ensure you're signed in with valid token
- Check that ADMIN_API_TOKEN is set on server
- Verify you have network access to API endpoints

## Tips and Best Practices

1. **Regular curation**
   - Set aside 15 minutes weekly to rate starred items
   - This trains the system to improve recommendations

2. **Be consistent**
   - Use same standards for ratings across sessions
   - Document your criteria in notes

3. **Combine approaches**
   - Rate individual items for feedback
   - Adjust source relevance for systemic improvements
   - Star items as you browse for weekly curation

4. **Monitor impact**
   - After rating 10+ items, next digest should show improvements
   - Check if highly-rated sources get boosted
   - Adjust thresholds based on results

5. **Use notes effectively**
   - Short notes explaining ratings help future review
   - Can identify patterns in what's relevant
   - Useful for evaluating source quality

## FAQ

**Can I change a rating later?**
Yes, just click the rating again and select a new one. Notes will be updated.

**How long until ratings affect the digest?**
Immediately for new digest requests. Existing cached digests won't update.

**Will ratings affect past items?**
No, ratings are stored with items but primarily influence future scoring logic.

**Can I remove a star?**
Not directly in the UI yet. You'd need to unstar in Inoreader and resync.

**What if I sync Inoreader multiple times?**
Duplicate items are ignored (prevented by unique constraint on inoreader_item_id).

**Are ratings shared?**
No, ratings are per-user, stored locally in your database. Not shared.
