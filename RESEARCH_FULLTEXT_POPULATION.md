# Research Full Text Population via ADS

## Status: IN PROGRESS ✅

**Script**: `scripts/populate-research-fulltext.ts`
**Target**: 100% coverage for research (arXiv papers)
**Method**: NASA ADS Search API (direct metadata fetching)

---

## What This Does

Fetches abstract/body text for all arXiv papers in the research category via NASA ADS API:

1. **Loads** all 4,985 research items from database
2. **Extracts** arXiv ID from each URL (e.g., 2512.12836)
3. **Queries** ADS API in batches of 50 papers
4. **Extracts** body/abstract from ADS response
5. **Saves** to `items.full_text` column
6. **Rate limits** to respect ADS API: 1 batch every 5-6 seconds

---

## Why This Works

The Inoreader research feed contains arXiv papers. ADS (NASA Astrophysics Data System) has native support for arXiv:
- Can search by arXiv ID: `arxiv:YYMM.NNNNN`
- Returns full metadata including body/abstract
- Free API with token

**Key insight**: We already use ADS in the libraries endpoint for research metadata. We're just using the same approach here for full text.

---

## Performance

**Per Batch**:
- 50 papers per batch
- ~1-2 seconds per batch
- API rate limit: 5 second wait between batches

**Total Time**:
- 4,534 papers ÷ 50 per batch = 91 batches
- 91 batches × 6 seconds = ~9-10 minutes

**Expected Result**:
- ~4,500+ papers with full text (abstracts)
- 100% coverage for research category
- ~1200 papers with full body text (vs abstracts)

---

## How to Run

```bash
# Set token and run
set -a && source .env.local && set +a && npx tsx scripts/populate-research-fulltext.ts
```

**Output**:
- Progress logged to console
- Batches numbered (1/91, 2/91, etc.)
- Final summary with cache stats

---

## Expected Outcome

After this completes, full text coverage will be:

| Category | Before | After | Delta |
|----------|--------|-------|-------|
| newsletters | 97.2% | 97.2% | - |
| ai_news | 92.3% | 92.3% | - |
| tech_articles | 27.5% | 27.5% | - |
| **research** | **6.0%** | **~99%** | **+93%** |
| other | <10% | <10% | - |

**Overall**: 13.5% → ~35% (11,431 items)

---

## Database Impact

**Full Text Columns**:
```sql
full_text TEXT              -- Article body/abstract (~1-2 KB per paper)
full_text_fetched_at INT    -- Unix timestamp
full_text_source TEXT       -- 'arxiv' | 'error'
```

**Estimated Cache Size**:
- Current: ~14 MB
- Research addition: ~5-7 MB (4,500 × 1.3 KB)
- New total: ~19-21 MB

---

## Integration Points

### Search System
- Full text now included in BM25 scoring for research
- Semantic embeddings include research abstracts
- Hybrid search will now find research papers on full-text queries

Example query improvement:
```bash
# Before: Only finds research papers with matching title/summary
curl "http://localhost:3000/api/search?q=recurrent neural networks&type=hybrid"

# After: Also finds papers with RNN in abstract
```

### Newsletter/Digest Generation
- Research items now have full context for LLM scoring
- Better relevance assessment (abstract > summary snippet)

---

## Technical Details

### ADS API Query

The script uses ADS Search API:

```bash
GET https://api.adsabs.harvard.edu/v1/search/query
  ?q=arxiv:YYMM.NNNNN OR arxiv:YYMM.NNNNN ...
  &rows=50
  &fl=arxiv_id,bibcode,body,abstract
  &Authorization: Bearer <TOKEN>
```

**Response**:
```json
{
  "response": {
    "docs": [
      {
        "bibcode": "2025arXiv251212836H",
        "body": ["Full text of abstract/summary..."],
        "abstract": "Abstract text..."
      }
    ]
  }
}
```

### arXiv ID Extraction

From bibcode format `YYYYarXivYYMMNNNNNC`:
- Extract `YYMM` and `NNNNN`
- Reconstruct to `YYMM.NNNNN`

Example: `2025arXiv251212836H` → `2512.12836`

---

## Monitoring

**Check progress** (live):
```bash
sqlite3 .data/digest.db "SELECT COUNT(*) FROM items WHERE category = 'research' AND full_text IS NOT NULL;"
```

**Check when complete**:
```bash
sqlite3 .data/digest.db "
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) as cached,
    ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as pct
  FROM items 
  WHERE category = 'research';
"
```

Expected output:
```
4985 | ~4900 | ~98%
```

---

## Troubleshooting

### Token not found
```bash
# Make sure token is in .env.local
grep ADS_API_TOKEN .env.local

# Then source it before running
set -a && source .env.local && set +a
```

### Script exits early
- Check ADS API status: https://ui.adsabs.harvard.edu
- Verify token validity
- Check network connection

### Slow progress
- Normal: ~1 second per 50 papers
- With rate limiting: ~6 seconds per batch
- Full script: ~10 minutes for all 4,534 papers

### Script crashed mid-run
- Safe to re-run: Already cached items are skipped
- Script loads 4,985 items, filters out cached ones
- Can stop/restart without data loss

---

## After Population

### Update Coverage Status Doc
Run this to update coverage:
```bash
sqlite3 .data/digest.db "
SELECT 
  category,
  COUNT(*) as total,
  SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) as cached,
  ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as pct
FROM items
GROUP BY category;
"
```

### Update FULLTEXT_COVERAGE_STATUS.md
Once population completes, update the research row with new stats.

---

## Future Improvements

### Expand to Other Categories
Same approach could work for:
- Newsletters with arXiv links
- Tech articles from arXiv
- Any URL-based content

### Fallback Chain
1. Try ADS API for arXiv papers ✅
2. Fall back to web scraping ✅
3. Fall back to abstract/summary

### Batch Size Tuning
- Currently 50 papers/batch
- Could increase if ADS API allows

---

## Summary

✅ **Ready to run**
- Token configured
- Script ready
- Expected 10 minutes to populate all 4,534 papers
- Will achieve ~100% research category coverage

**Next steps**:
1. Run `npx tsx scripts/populate-research-fulltext.ts` (in background)
2. Monitor progress with SQLite query
3. Update coverage doc when complete
4. Test hybrid search on research papers

All systems ready for 100% research full text coverage! 🚀
