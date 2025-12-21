# Update: Full Text Fetching Now Available

**Status**: ✅ Full text fetching infrastructure is now implemented and ready to use.

## What Changed

Full text fetching has been added to the system. The agent building newsletter/podcast generation can now use complete article text instead of just summaries.

## For the Agent

When building `POST /api/newsletter/generate` and `POST /api/podcast/generate`:

### Data Available

**Summaries** (Always available):
- Average 2,700 characters
- Extracted from Inoreader, HTML-stripped
- Sufficient for MVP generation

**Full Text** (Optional, cached):
- 5,000-20,000+ characters
- Fetched via web scraping or arXiv API
- Cached in database after first fetch
- Improve quality when available

### Usage in Code

```typescript
// Prefer full text, fall back to summary
const content = item.fullText || item.summary;

// Or use full text only for premium items
const topItems = rankedItems.slice(0, 10);
if (item.fullText) {
  // Use full text for generation (more context)
  useFullText = true;
} else {
  // Use summary for faster generation
  useFullText = false;
}
```

### Modules to Use

**Fetch full text**:
```typescript
import { fetchFullText, fetchFullTextBatch } from "@/src/lib/pipeline/fulltext";

// For single item
const result = await fetchFullText(item);

// For multiple items (with rate limiting)
const results = await fetchFullTextBatch(items, 3);
```

**Load from database**:
```typescript
import { loadFullText } from "@/src/lib/db/items";

const cached = await loadFullText(itemId);
if (cached) {
  const text = cached.text; // Full text
  const source = cached.source; // "web_scrape" | "arxiv" | "error"
}
```

## Implementation Details

See **FULLTEXT_SETUP.md** for:
- Database schema changes
- API endpoints for managing full text cache
- Rate limiting and performance expectations
- Best practices and troubleshooting

## For Newsletter/Podcast Generation

**Newsletter**:
- Use summaries for speed (baseline MVP)
- Enhance with full text for premium output
- Include source with full text attribution

**Podcast**:
- Use summaries for topic extraction (fast)
- Use full text for detailed segments (premium)
- Enable direct quotes from full text

## Setup Steps

1. **Run migration** (adds columns to database):
   ```bash
   npx tsx scripts/migrate-add-fulltext.ts
   ```

2. **Fetch full text for key items**:
   ```bash
   curl -X POST http://localhost:3000/api/admin/fulltext/fetch \
     -H "Content-Type: application/json" \
     -d '{ "category": "tech_articles", "limit": 50 }'
   ```

3. **Check cache status**:
   ```bash
   curl http://localhost:3000/api/admin/fulltext/status
   ```

## Agent Considerations

**Do NOT** block newsletter/podcast generation on full text fetching:
- Fall back to summaries if full text is unavailable
- Make full text an enhancement, not a requirement
- Handle fetch errors gracefully

**Example**:
```typescript
// Good: Fall back to summary
const content = item.fullText || item.summary;

// Bad: Wait for fetch
const fullText = await fetchFullText(item); // Blocks generation
```

## Timeline Impact

- Migration: <1 minute
- Fetching full text for 50 items: ~20-30 seconds
- Agent implementation: Same as before (optional enhancement)
- **No impact to agent deadline** (3 hours still realistic)

## Questions?

See **FULLTEXT_SETUP.md** for detailed documentation, or ask about:
- Integration patterns
- Rate limiting implications
- Database queries
- Troubleshooting

## Summary

✅ Full text infrastructure ready
✅ Web scraping + arXiv API working
✅ Caching implemented
✅ Admin API available
✅ Optional enhancement (doesn't block MVP)

Agent can use either summaries (fast MVP) or full text (premium quality) interchangeably.
