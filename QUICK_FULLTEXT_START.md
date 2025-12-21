# Quick Full Text Population Start Guide

## TL;DR Status

✅ **Research population running** (arXiv via ADS) - 53.8% complete (2,682 / 4,985)
🔴 **7,181 items never attempted** - these need full text fetched
⚠️ **Need to run population scripts** on remaining items

---

## Commands You Need (Copy/Paste Ready)

### 1️⃣ Monitor Research Progress (LIVE)
```bash
bash scripts/monitor-fulltext.sh
# Refreshes every 5 seconds
# Shows: total cached, per-category stats, cache size
# Ctrl+C to exit
```

### 2️⃣ Diagnose What's Missing
```bash
npx tsx scripts/diagnose-fulltext-failures.ts
# Detailed breakdown of low-coverage categories
# Shows why items failed
# Gives recommendations
```

### 3️⃣ Populate Tech Articles + Community (After Research Done)
```bash
npx tsx scripts/populate-fulltext-fast.ts
# Parallel web scraping of 7+ categories
# Time: 1-2 hours depending on concurrency
# Returns to prompt when done
```

### 4️⃣ Check Final Stats
```bash
sqlite3 .data/digest.db "
  SELECT
    category,
    COUNT(*) as total,
    SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) as cached,
    ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as pct
  FROM items
  GROUP BY category
  ORDER BY pct DESC;
"
```

---

## Current Situation

| Category | Status | Action |
|----------|--------|--------|
| newsletters | ✅ 97.2% | Done |
| ai_news | ✅ 92.3% | Done |
| **research** | 🔄 **53.8%** | **Monitor** (ADS script running) |
| tech_articles | 🟠 27.5% (1,491 missing) | Run populate script |
| community | 🔴 9.6% (2,618 missing) | Run populate script |
| product_news | 🔴 6% (758 missing) | Run populate script |
| podcasts | 🟠 32% (17 missing) | Lower priority |

**Total coverage**: 30% (~3,400 / 11,431 items)
**Never-attempted**: 7,181 items (61%)

---

## 3 Steps to Get to 50%+ Coverage

### Step 1: Wait for Research (10 min)
```bash
# Monitor in background
bash scripts/monitor-fulltext.sh &

# Watch until research hits 90%+
# Should take 10-15 minutes
```

### Step 2: Run Other Categories (1-2 hours)
```bash
# When research is done, run web population
npx tsx scripts/populate-fulltext-fast.ts

# This will:
# - tech_articles: 1,491 items (~30 min)
# - community: 2,618 items (~60 min)
# - product_news: 758 items (~20 min)
```

### Step 3: Check Final Status
```bash
# See new coverage
sqlite3 .data/digest.db "
  SELECT category, COUNT(*), SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) as cached
  FROM items GROUP BY category ORDER BY category;
"
# Expected: research ~4500+, tech ~800+, community ~300+
```

---

## Root Causes (Why So Much Missing?)

### 1. Research (53.8% missing = 2,303)
- ✅ **Being fixed**: ADS script is running now
- arXiv papers need special handling
- Expected to reach 95%+ when complete

### 2. Tech Articles (72.5% missing = 1,491)
- Never ran population script on full set
- Population script exists but not automatic
- Most sites are scrapeable (no paywalls)

### 3. Community (90.4% missing = 2,618)
- All Reddit posts (low value for digest)
- Never attempted population
- Rate limiting makes it slow

### 4. Product News (94% missing = 758)
- High error rate (22% fail due to paywalls)
- Many from Google News (hard to scrape)
- Some success from GitHub/changelogs

---

## Key Insight

**Root cause**: Population is not automatic.
- When daily sync runs, new items are added
- But full text is not fetched at sync time
- Need to run population scripts separately

**Solution**: Use new endpoint after sync
```bash
# Call this after sync completes
curl -X POST http://localhost:3002/api/admin/fulltext-after-sync

# Or use shell script
bash scripts/sync-and-populate-fulltext.sh
```

---

## Files to Know

**Monitoring**:
- `scripts/monitor-fulltext.sh` - Live progress (NEW)
- `scripts/diagnose-fulltext-failures.ts` - Detailed analysis (NEW)

**Population**:
- `scripts/populate-fulltext-fast.ts` - Parallel web scraping
- `scripts/populate-research-fulltext.ts` - arXiv via ADS (running now)

**API**:
- `app/api/admin/fulltext/fetch` - General fetch endpoint
- `app/api/admin/fulltext-after-sync` - Post-sync population (NEW)

**Docs**:
- `FULLTEXT_POPULATION_GUIDE.md` - Detailed guide (NEW)

---

## Next Steps in Order

1. **Now**: Run monitor in background
   ```bash
   bash scripts/monitor-fulltext.sh &
   ```

2. **In 15 min**: Check if research is near 90%+

3. **When research done**: Run population script
   ```bash
   npx tsx scripts/populate-fulltext-fast.ts
   ```

4. **In 2 hours**: Verify coverage improved
   ```bash
   bash scripts/monitor-fulltext.sh
   ```

5. **Later**: Setup automated post-sync
   ```bash
   # Add to your sync cron job:
   bash scripts/sync-and-populate-fulltext.sh
   ```

---

## Estimates

| Task | Time | Impact |
|------|------|--------|
| Monitor research | 15 min | Understand progress |
| Tech articles population | 30 min | +200 items (27% → 35%) |
| Community population | 60 min | +300 items (9% → 19%) |
| Product population | 30 min | +150 items (6% → 16%) |
| **Total time** | **2 hours** | **Overall: 30% → 45%** |

---

## Questions?

- **Is research still running?** → Check with monitor
- **Why are items missing?** → Run diagnose script
- **How do I retry failed items?** → Set `skip_cached=false` in API call
- **Can I make this automatic?** → Use new post-sync endpoint

See `FULLTEXT_POPULATION_GUIDE.md` for full details.
