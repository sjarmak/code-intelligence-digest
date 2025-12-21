# Full Text Population Guide

**Last Updated**: 2025-12-21

## Current Status

### Real-time Research Progress
```bash
# Monitor research population in real-time
bash scripts/monitor-fulltext.sh
```

**Current Research Coverage**: 53.8% (2,682 / 4,985) ✅ ADS script is working!

---

## Why Coverage is Low: Root Cause Analysis

### The Issue: Never-Attempted Items (7,181 items)

Most low-coverage items were **never attempted** - they still have `full_text_source = NULL`. This means:

1. **Initial population scripts only ran once** on a subset of items
2. **New items from daily sync** don't automatically get full text fetched
3. **Population scripts need to be run manually** after each sync

### Coverage Breakdown

| Category | Total | Cached | Coverage | Status | Never Attempted |
|----------|-------|--------|----------|--------|-----------------|
| newsletters | 288 | 280 | 97.2% | ✅ Done | 8 |
| ai_news | 26 | 24 | 92.3% | ✅ Done | 2 |
| research | 4,985 | 2,682 | **53.8%** | 🔄 Running (ADS) | 2,303 |
| podcasts | 25 | 8 | 32% | 🟠 Low | 1 |
| tech_articles | 2,131 | 586 | 27.5% | 🟠 Low | 1,491 |
| community | 2,918 | 280 | 9.6% | 🔴 Very Low | 2,618 |
| product_news | 1,058 | 64 | 6% | 🔴 Very Low | 758 |

**Total never-attempted**: 7,181 items (63% of all items)

### Why Specific Categories Have Low Coverage

#### 1. **Research (arXiv)** - 53.8% (2,303 remaining)
- ✅ ADS script is currently running in background
- Extracts arXiv papers via NASA ADS API
- Expected to reach 95%+ when complete
- **Action**: Wait for `populate-research-fulltext.ts` to complete (10-15 min)

#### 2. **Tech Articles** - 27.5% (1,491 never-attempted)
- Mostly from Hacker News, blogs, tech sites
- Never run web scraping population on full set
- Most sites: text-extractable (no paywalls)
- **Estimated time to populate**: 30-45 min (parallel web scraping)
- **Action**: Run `populate-fulltext-fast.ts`

#### 3. **Community** - 9.6% (2,618 never-attempted)
- Mostly Reddit posts (77% of uncached items)
- Reddit requires headers/rate limiting
- Low value for digest (already summarized in snippet)
- **Estimated time**: 60+ min (slow due to rate limits)
- **Action**: Can defer, lower priority

#### 4. **Product News** - 6% (758 never-attempted)
- High error rate (22% of attempts fail)
- Many from paywalled sources (Google News, newsletters)
- Some success from GitHub/changelogs
- **Estimated time**: 20-30 min (many will fail)
- **Action**: Run but expect modest gains

#### 5. **Podcasts** - 32% (16 errors on 25 items)
- Mostly YouTube/Spotify links
- Web scraping can't extract transcript
- **Action**: Low priority, skip for now

---

## Solutions: 3-Level Approach

### ✅ Level 1: Monitor Research (IN PROGRESS)

Currently running `scripts/populate-research-fulltext.ts`:
- Fetches arXiv papers via ADS API
- Expected completion: 10-15 minutes
- Will reach 95%+ coverage for research

**Monitor progress**:
```bash
bash scripts/monitor-fulltext.sh
# Refreshes every 5 seconds with live coverage stats
```

### 🔄 Level 2: Populate Tech Articles + Community (NEXT)

After research completes, populate high-value categories:

```bash
# Option A: Use fast parallel population script (Recommended)
npx tsx scripts/populate-fulltext-fast.ts
# Categories: tech_articles (1,491), community (2,618), product_news (758)
# Time: 45-90 min depending on concurrency
# Success: ~70% (some paywalls will fail)

# Option B: Use API endpoint (more control)
curl -X POST http://localhost:3002/api/admin/fulltext/fetch \
  -H "Content-Type: application/json" \
  -d '{
    "category": "tech_articles",
    "limit": 500,
    "skip_cached": true
  }'

# Repeat for each category
```

### 📅 Level 3: Integrate with Daily Sync (NEW)

**Problem**: Every time daily sync runs, new items get added without full text.

**Solution**: Create post-sync full text fetching:

```bash
# Combined sync + population (NEW SCRIPT)
bash scripts/sync-and-populate-fulltext.sh
# Runs: daily sync → research population → other categories population

# Or use API endpoint (NEW ENDPOINT)
POST /api/admin/fulltext-after-sync
# Smart population of high-value categories
```

---

## Quick Start: Multi-Step Recovery Plan

### Step 1: Check Research Progress (NOW)
```bash
bash scripts/monitor-fulltext.sh
# Wait for research to finish (2682 → 4700+)
# Ctrl+C to exit monitor
```

### Step 2: Diagnose Issues (Optional)
```bash
npx tsx scripts/diagnose-fulltext-failures.ts
# Detailed breakdown of what's missing and why
```

### Step 3: Populate Other Categories (AFTER RESEARCH DONE)
```bash
# Fast parallel population (recommended)
npx tsx scripts/populate-fulltext-fast.ts

# This will:
# 1. tech_articles: 1,491 items (~30 min)
# 2. community: 2,618 items (~60 min)  
# 3. product_news: 758 items (~20 min)
# 4. podcasts: 17 items (quick)
# Total: ~2 hours

# Check progress
bash scripts/monitor-fulltext.sh
```

### Step 4: Setup Automated Post-Sync Population (FUTURE)
```bash
# After daily sync completes, automatically populate full text
curl -X POST http://localhost:3002/api/admin/fulltext-after-sync

# Or in cron job after sync:
bash scripts/sync-and-populate-fulltext.sh
```

---

## API Endpoints

### Endpoint 1: Full Text Fetch (Existing)
```bash
POST /api/admin/fulltext/fetch
{
  "category": "tech_articles",  // optional, if empty: all categories
  "limit": 50,                  // max items to fetch (default: 10)
  "skip_cached": true           // if false, retry failed items
}

# Response:
{
  "status": "ok",
  "itemsToFetch": 50,
  "itemsFetched": 48,
  "successful": 40,
  "failed": 8,
  "duration": "2.5s",
  "cache": { "total": 11431, "cached": 1542 }
}
```

### Endpoint 2: Research Full Text via ADS (NEW)
```bash
POST /api/admin/fulltext-after-sync
{
  "adsToken": "your-ads-token",  // optional, uses env var if not provided
  "skipResearch": false,
  "skipWeb": false
}

# Response:
{
  "status": "ok",
  "results": [
    { "category": "research", "fetched": 500, "successful": 480 },
    { "category": "tech_articles", "fetched": 100, "successful": 85 }
  ],
  "stats": { "total": 11431, "cached": 3000 }
}
```

### Endpoint 3: Status Check
```bash
GET /api/admin/fulltext/status
# Returns current cache stats

GET /api/admin/fulltext-after-sync
# Shows if API is ready
```

---

## Files & Scripts

### New Scripts Created

1. **`scripts/monitor-fulltext.sh`** - Real-time progress monitoring
   - Refreshes every 5 seconds
   - Shows per-category stats
   - Use while population is running

2. **`scripts/sync-and-populate-fulltext.sh`** - Combined sync + population
   - Runs daily sync
   - Then populates research (ADS)
   - Then populates other categories (web)
   - Options: `fast` (research only), `skip` (no fulltext)

3. **`scripts/diagnose-fulltext-failures.ts`** - Detailed issue analysis
   - Shows what's never-attempted vs. errored
   - Breaks down by source
   - Provides recommendations

### New API Endpoint

**`app/api/admin/fulltext-after-sync/route.ts`** - Smart post-sync population
- Runs research population (ADS API)
- Runs web scraping population
- Returns detailed stats
- Can be called after sync

### Existing Infrastructure

- `scripts/populate-fulltext-fast.ts` - Parallel web scraping (8 concurrent)
- `scripts/populate-research-fulltext.ts` - arXiv via ADS (50-item batches)
- `app/api/admin/fulltext/route.ts` - General fetch endpoint
- `src/lib/pipeline/fulltext.ts` - Core fetching logic

---

## Coverage Goals

### Phase 1: Research (TODAY) ✅
- Target: 95% of 4,985 = 4,700 items
- Current: 2,682 (53.8%)
- Remaining: 2,303
- Time: 10-15 min (ADS script running)
- Method: NASA ADS API

### Phase 2: High-Value Categories (THIS WEEK)
- **Tech Articles**: 27.5% → 60% (run population script)
  - 2,131 items, 1,491 never-attempted
  - Time: 30 min
- **Product News**: 6% → 25% (run, expect 50% success)
  - 1,058 items, 758 never-attempted
  - Time: 30 min, 50% success rate

**Expected overall**: 13.5% → 40%+ coverage

### Phase 3: Complete Coverage (NEXT MONTH)
- **Community**: 9.6% → 20% (low priority, slow)
  - 2,918 Reddit items, slow rate limiting
  - Time: 90+ min
  
- **Podcasts**: 32% → Skip (can't extract transcripts)

**Expected overall**: 40% → 50%+ coverage

---

## Troubleshooting

### Research Stuck at 53.8%?
```bash
# Check if script is still running
ps aux | grep populate-research

# Monitor progress
bash scripts/monitor-fulltext.sh

# Check for errors
tail -f .data/logs.txt | grep "ADS\|arxiv"

# Re-run from where it left off (safe to re-run)
set -a && source .env.local && set +a
npx tsx scripts/populate-research-fulltext.ts
```

### Other Categories Not Populating?
```bash
# Diagnose what's missing
npx tsx scripts/diagnose-fulltext-failures.ts

# See which items failed
sqlite3 .data/digest.db "
  SELECT category, COUNT(*) FROM items
  WHERE full_text IS NULL AND full_text_source IS NULL
  GROUP BY category
"

# Re-run population for specific category
curl -X POST http://localhost:3002/api/admin/fulltext/fetch \
  -H "Content-Type: application/json" \
  -d '{"category": "tech_articles", "limit": 100}'
```

### API Returns 500 Error?
```bash
# Check logs
tail -f .data/logs.txt

# Verify ADS token (if research population)
grep ADS_API_TOKEN .env.local

# Make sure database exists
ls -la .data/digest.db
```

---

## Summary

**Current Status**:
- Research: 53.8% (2,682/4,985) - **ADS script running** ✅
- Overall: 30% (estimate after research completes)

**Next Actions** (in order):
1. Monitor research with `bash scripts/monitor-fulltext.sh`
2. Wait for research to reach 90%+ (10-15 min)
3. Run `npx tsx scripts/populate-fulltext-fast.ts` for tech_articles + community
4. Setup automated post-sync with `bash scripts/sync-and-populate-fulltext.sh`

**Expected Timeline**:
- Research complete: Today (~30 min)
- Tech + community: Today (2 hours)
- Overall coverage: 40-50% by end of day
- Full coverage: Next month (lower priority categories)

The infrastructure is in place. We just need to run the population scripts systematically.
