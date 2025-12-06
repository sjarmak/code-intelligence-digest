# Daily Sync Strategy

## Overview

The daily sync fetches only items from the **last 30 days**, reducing API calls from 156+ down to **5-10 per sync**.

This leaves **90+ calls/day** available for other uses.

## API Calls Cost

| Period | Items | API Calls | Daily Budget |
|--------|-------|-----------|--------------|
| Last 30 days | ~500-1000 | 5-10 | 100 ✓ |
| Last 7 days | ~100-200 | 1-2 | 100 ✓ |
| All-time | 10,000+ | 100+ | 100 ✗ |

## Resumable Syncs

If the sync is interrupted (rate limit, network error), it saves progress and can resume:

```bash
# Start sync
curl -X POST http://localhost:3002/api/admin/sync-daily

# Check status
curl http://localhost:3002/api/admin/sync-daily

# Resume if paused
curl -X POST http://localhost:3002/api/admin/sync-daily
```

The database tracks:
- Continuation token (pagination point)
- Items processed
- API calls used
- Error reason

## Schedule Daily Sync

### Option 1: cron-job.org (Easiest)

1. Go to https://cron-job.org/en/
2. Create new cron job
3. **URL**: `https://your-domain.com/api/admin/sync-daily` (POST)
4. **Schedule**: `0 2 * * *` (2am UTC daily)
5. **Save**

### Option 2: GitHub Actions

Create `.github/workflows/daily-sync.yml`:

```yaml
name: Daily Digest Sync

on:
  schedule:
    - cron: '0 2 * * *'  # 2am UTC

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Daily Sync
        run: |
          curl -X POST ${{ secrets.API_URL }}/api/admin/sync-daily \
            -H "Authorization: Bearer ${{ secrets.API_KEY }}"
```

### Option 3: Node.js Cron (Local)

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
```

## What Gets Synced

- **Time window**: Last 30 days
- **Items**: ~500-1000 per day
- **Categories**: All 7 (newsletters, tech_articles, podcasts, etc.)
- **Excludes**: Items already marked as read (if configured)

## Handling Pauses

If the sync pauses due to rate limits:

```bash
# Check status
curl http://localhost:3002/api/admin/sync-daily

# Response if paused:
{
  "status": "paused",
  "reason": "Rate limit approaching. Will resume tomorrow.",
  "itemsProcessed": 5000,
  "callsUsed": 95,
  "resumable": true
}

# Resume manually
curl -X POST http://localhost:3002/api/admin/sync-daily
```

Or wait until the next scheduled run (tomorrow 2am UTC).

## Monitoring

Check sync status anytime:

```bash
curl http://localhost:3002/api/admin/sync-daily
```

Response examples:

**Idle:**
```json
{
  "status": "idle",
  "message": "No active sync"
}
```

**In Progress:**
```json
{
  "status": "in_progress",
  "itemsProcessed": 1500,
  "callsUsed": 5
}
```

**Paused (needs resume):**
```json
{
  "status": "paused",
  "reason": "Rate limit approaching",
  "itemsProcessed": 5000,
  "callsUsed": 95
}
```

**Completed:**
```json
{
  "status": "completed",
  "itemsProcessed": 8500,
  "callsUsed": 9
}
```

## Recovery from Errors

If sync errors mid-way:

1. Check status: `GET /api/admin/sync-daily`
2. Fix the issue (network, auth, etc.)
3. Resume: `POST /api/admin/sync-daily`

The system remembers the continuation token and resumes where it left off.

## API Call Budget

**Daily budget: 100 calls**

- Daily sync: 5-10 calls
- Remaining: 90+ calls

Use the remaining calls for:
- Batch ranking/scoring
- Search indexing
- Manual syncs
- Testing

## Next Steps

Once data is synced daily:

1. Implement BM25 ranking
2. Implement LLM scoring
3. Implement diversity selection
4. Build digest rendering (weekly/monthly)
