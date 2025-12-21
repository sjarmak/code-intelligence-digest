# Weekly Sync: Setup & Usage

## Quick Start

**Run the weekly sync (pulls last 7 days in 1-2 calls):**
```bash
bash scripts/run-sync-weekly.sh
```

**Raw API call:**
```bash
curl -X POST http://localhost:3002/api/admin/sync-weekly
```

**Check sync status:**
```bash
curl http://localhost:3002/api/admin/sync-weekly
```

## What It Does

1. Fetches **all items from the last 7 days** (not just new since last sync)
2. Uses cached user ID (no lookup call)
3. Single `getStreamContents()` call with `n=1000`
4. Only uses continuation if >1000 items (rare for 7 days)
5. Normalizes and categorizes them
6. Saves to SQLite database by category
7. Resumes automatically from continuation token if interrupted

## API Efficiency

**First run:**
- 2 API calls (1 to get + cache user ID, 1 to fetch items)

**Subsequent runs:**
- **1 API call** (cached user ID, single items fetch)
- Designed to be minimal friction

**Worst case** (>1000 items in 7 days):
- Continuation kicks in
- 1-2 additional calls, still well under 100-call limit

## Behavior

**First run:**
- Fetches all items from 7 days ago
- ~1-2 API calls
- ~500-2000 items added (depends on subscription volume)

**Subsequent runs:**
- Same query fetches again (gets all 7-day window)
- Uses continuation token from previous incomplete batch
- ~1-2 API calls

**Rate limit (100 calls/day):**
- Automatically pauses at 95 calls
- Resumes next day with stored continuation token
- No data loss on interruption

## Database Augmentation

- **INSERT OR REPLACE**: Duplicate item IDs update existing records
- **By category**: Items saved separately by category (newsletters, tech_articles, etc.)
- **Date filter**: Client-side enforcement of 7-day window
- **Indexes**: Fast lookups (stream_id, category, published_at)

## Status Response

**Idle (no sync in progress):**
```json
{
  "status": "idle",
  "message": "No active sync",
  "nextSync": "POST /api/admin/sync-weekly to start"
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
  "callsUsed": 2
}
```

## Comparison: Daily vs Weekly

| Aspect | Daily Sync | Weekly Sync |
|--------|-----------|-----------|
| **Lookback** | 24h (or since last sync) | 7 days (fixed) |
| **API Calls** | 1-3 (incremental) | **1 call** (cached user ID) |
| **Use Case** | Continuous curation | Weekly digest pull |
| **Overhead** | Minimal (only new items) | **Minimal** (single call) |
| **Best For** | Daily updates | Optimal weekly pull |

## Scheduling Weekly Sync

### Option 1: Manual (One-off)
```bash
bash scripts/run-sync-weekly.sh
```

### Option 2: cron-job.org (Cloud, No Setup)
1. Go to https://cron-job.org/en/
2. Click "Create cronjob"
3. **URL**: `https://your-domain.com/api/admin/sync-weekly` (POST)
4. **Schedule**: `0 10 * * 1` (10am UTC every Monday)
5. **Save**

### Option 3: GitHub Actions (Weekly)
Create `.github/workflows/weekly-sync.yml`:

```yaml
name: Weekly Digest Sync

on:
  schedule:
    - cron: '0 10 * * 1'  # 10am UTC every Monday

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Weekly Sync
        run: |
          curl -X POST https://your-domain.com/api/admin/sync-weekly
```

### Option 4: Node.js Cron (Local Dev)
```bash
npm install node-cron
```

Create `scripts/weekly-sync-cron.ts`:

```typescript
import cron from 'node-cron';

// Run at 10am UTC every Monday
cron.schedule('0 10 * * 1', async () => {
  console.log('Running weekly sync...');
  const res = await fetch('http://localhost:3002/api/admin/sync-weekly', {
    method: 'POST',
  });
  const data = await res.json();
  console.log(data);
});

console.log('Weekly cron job scheduled. Press Ctrl+C to stop.');
```

Run with: `npx ts-node scripts/weekly-sync-cron.ts`

## API Budget

**Total**: 100 calls/day from Inoreader

| Task | Calls | Remaining |
|------|-------|-----------|
| Weekly sync | 1-2 | ~98-99 |
| Daily sync (if also running) | 1-3 | ~95-98 |
| Batch scoring | ~20 | ~75-95 |
| Testing/search | ~20 | ~55-75 |
| Buffer | | 55+ |

## Troubleshooting

**"Rate limit reached" error:**
- Check status: `curl http://localhost:3002/api/admin/sync-weekly`
- If paused, resume tomorrow or manually: `curl -X POST http://localhost:3002/api/admin/sync-weekly`

**"Could not determine user ID" error:**
- Check Inoreader credentials in `.env`
- Verify `INOREADER_CLIENT_ID`, `INOREADER_CLIENT_SECRET`, `INOREADER_REFRESH_TOKEN`

**Items not appearing in database:**
- Check database: `node -e "const db = require('better-sqlite3')('.data/digest.db'); console.log(db.prepare('SELECT COUNT(*) as count FROM items').get());"`
- Check sync logs: `curl http://localhost:3002/api/admin/sync-weekly`

**Too many items (>1000/week):**
- Continuation token will handle automatically
- No manual action needed, just observe additional API call

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
