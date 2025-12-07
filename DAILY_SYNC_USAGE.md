# Daily Sync: Setup & Usage

## Quick Start

**Run the daily sync:**
```bash
curl -X POST http://localhost:3002/api/admin/sync-daily
```

**Check sync status:**
```bash
curl http://localhost:3002/api/admin/sync-daily
```

## What It Does

1. Fetches items from Inoreader (last 30 days)
2. Normalizes and categorizes them
3. Filters to 30-day window (client-side)
4. Saves to SQLite database by category
5. Resumes automatically from continuation token if interrupted

## Behavior

**First run**: 
- Fetches all unread items from last 30 days
- ~5-10 API calls
- ~100-500 items added

**Subsequent runs**:
- Resumes from continuation token
- ~5-10 API calls per run
- Fetches next batch of items

**Rate limit (100 calls/day)**:
- Automatically pauses at 95 calls
- Resumes next day with stored continuation token
- No data loss on interruption

## Database Augmentation

- **INSERT OR REPLACE**: Duplicate item IDs update existing records
- **By category**: Items saved separately by category (newsletters, tech_articles, etc.)
- **Date filter**: Items older than 30 days are automatically filtered client-side
- **Indexes**: Created for fast lookups (stream_id, category, published_at)

## Status Response

**Idle (no sync in progress):**
```json
{
  "status": "idle",
  "message": "No active sync"
}
```

**Paused (needs resume):**
```json
{
  "status": "paused",
  "reason": "Rate limit approaching. Will resume tomorrow.",
  "itemsProcessed": 1203,
  "callsUsed": 95,
  "resumable": true
}
```

**Completed:**
```json
{
  "status": "completed",
  "itemsProcessed": 8000,
  "callsUsed": 45
}
```

## Schedule Daily Sync

Choose one approach:

### Option 1: cron-job.org (Cloud, No Setup)

1. Go to https://cron-job.org/en/
2. Click "Create cronjob"
3. **URL**: `https://your-domain.com/api/admin/sync-daily` (POST)
4. **Schedule**: `0 2 * * *` (2am UTC daily)
5. **Save**

Response will be logged in cron-job.org dashboard.

### Option 2: GitHub Actions (CI/CD)

Create `.github/workflows/daily-sync.yml`:

```yaml
name: Daily Digest Sync

on:
  schedule:
    - cron: '0 2 * * *'  # 2am UTC daily

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Daily Sync
        run: |
          curl -X POST https://your-domain.com/api/admin/sync-daily
```

### Option 3: Node.js Cron (Local Dev)

```bash
npm install node-cron
```

Create `scripts/daily-sync-cron.ts`:

```typescript
import cron from 'node-cron';

// Run at 2am UTC daily
cron.schedule('0 2 * * *', async () => {
  console.log('Running daily sync...');
  const res = await fetch('http://localhost:3002/api/admin/sync-daily', {
    method: 'POST',
  });
  const data = await res.json();
  console.log(data);
});

console.log('Cron job scheduled. Press Ctrl+C to stop.');
```

Run with: `npm ts-node scripts/daily-sync-cron.ts`

## API Budget

**Total**: 100 calls/day from Inoreader

| Task | Calls | Remaining |
|------|-------|-----------|
| Daily sync | 5-10 | ~90 |
| Batch scoring | ~20 | ~70 |
| Testing/search | ~20 | ~50 |
| Buffer | | 50+ |

## Troubleshooting

**"Rate limit reached" error:**
- Check status: `curl http://localhost:3002/api/admin/sync-daily`
- If paused, resume tomorrow or manually: `curl -X POST http://localhost:3002/api/admin/sync-daily`

**"Could not determine user ID" error:**
- Check Inoreader credentials in `.env`
- Verify `INOREADER_CLIENT_ID`, `INOREADER_CLIENT_SECRET`, `INOREADER_REFRESH_TOKEN`

**Items not appearing in database:**
- Check database: `node -e "const db = require('better-sqlite3')('.data/digest.db'); console.log(db.prepare('SELECT COUNT(*) as count FROM items').get());"`
- Check sync logs: `curl http://localhost:3002/api/admin/sync-daily`

**Old items still in database:**
- Clean up: `node -e "const db = require('better-sqlite3')('.data/digest.db'); const deleted = db.prepare('DELETE FROM items WHERE published_at < ?').run(Math.floor((Date.now() - 30*24*60*60*1000)/1000)).changes; console.log('Deleted', deleted, 'old items');"`

## Current Database

```bash
# Check totals
node -e "
const db = require('better-sqlite3')('.data/digest.db');
const stats = db.prepare('SELECT COUNT(*) as count FROM items').get();
const byCat = db.prepare('SELECT category, COUNT(*) as count FROM items GROUP BY category ORDER BY count DESC').all();
console.log('Total:', stats.count);
console.log('By category:');
byCat.forEach(c => console.log(\`  \${c.category}: \${c.count}\`));
"
```

## Next: Implement Ranking

Once cached data is clean and sync is running daily:

1. Implement BM25 ranking (domain term queries)
2. Implement LLM scoring (Claude API)
3. Combine scores into final ranking
4. Build `/api/items` endpoint
5. Build UI components

See `LANDING_SESSION.md` for detailed plan.
