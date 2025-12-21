# Global API Budget Tracking

**Problem solved:** The old system tracked API calls **per endpoint** (daily-sync, weekly-sync, etc), so running multiple syncs would hit the 95-call auto-pause even though each individually reported <5 calls.

**Solution:** Global counter that tracks **all** Inoreader API calls across all endpoints in a single day.

## Check Budget

```bash
curl http://localhost:3002/api/admin/api-budget
```

Returns:
```json
{
  "date": "2024-12-21",
  "callsUsed": 45,
  "remaining": 55,
  "quotaLimit": 100,
  "percentUsed": 45,
  "message": "✅ Plenty of budget remaining (55/100)"
}
```

## How It Works

1. **Global tracking table**: `global_api_budget(date, calls_used, quota_limit)`
   - One row per calendar day
   - Resets at midnight UTC
   - Tracks **total** calls from all syncs/endpoints

2. **Incremental updates**: Every API call increments counter
   ```
   incrementGlobalApiCalls(1)  // called after each Inoreader request
   ```

3. **Budget checks**:
   - Weekly sync checks: `if (budget.remaining <= 2) → pause`
   - Daily sync checks: `if (budget.remaining <= 1) → pause`
   - All endpoints respect the global limit

## Endpoints That Count Toward Budget

All Inoreader API calls:

- ✅ `POST /api/admin/sync-weekly` - 1-2 calls
- ✅ `POST /api/admin/sync-daily` - 1-3 calls
- ✅ `POST /api/admin/sync/all` - many calls (legacy)
- ✅ `POST /api/admin/sync-optimized/all` - 5-10 calls
- ✅ `POST /api/admin/sync-starred` - 1 call
- ✅ `POST /api/admin/refresh-feeds` - 1+ calls
- ✅ Any other direct Inoreader API calls

## Daily Budget

| Limit | Endpoint | Typical | Hard Pause At |
|-------|----------|---------|--------------|
| 100 | Inoreader/day | — | 100 |
| — | Weekly sync | 1-2 | <2 remaining |
| — | Daily sync | 1-3 | <1 remaining |
| — | Scoring (LLM) | ~0 | (uses OpenAI, not Inoreader) |
| — | Buffer | 95+ | Safe zone |

## Workflow

**Morning:**
```bash
# Check budget
curl http://localhost:3002/api/admin/api-budget

# If remaining > 10:
bash scripts/run-sync-weekly.sh
# Pulls 7 days, uses ~2 calls
# Budget: 2/100
```

**Throughout day:**
```bash
# All other work respects global counter
# If budget < 2, auto-pauses until tomorrow
```

## Reset

Budget resets automatically at **midnight UTC**. 

To manually reset (dev only):
```bash
node -e "
const db = require('better-sqlite3')('.data/digest.db');
const today = new Date().toISOString().split('T')[0];
db.prepare('DELETE FROM global_api_budget WHERE date = ?').run(today);
console.log('Reset budget for', today);
"
```

## Migration Notes

Old system:
- Tracked calls **per sync** (daily-sync, weekly-sync separate)
- Could report <5 calls but still hit pause if other syncs used calls
- Confusing UX

New system:
- Single global counter
- All syncs share 100-call budget
- Clear, accurate reporting
- Predictable behavior

## Testing

```bash
# Start fresh
curl http://localhost:3002/api/admin/api-budget

# Run sync
bash scripts/run-sync-weekly.sh

# Check updated budget
curl http://localhost:3002/api/admin/api-budget

# Should show calls_used = 2, remaining = 98
```
