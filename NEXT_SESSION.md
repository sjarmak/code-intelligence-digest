# Next Session: Database Infrastructure & Search

## Focus

Implement persistent database layer to replace file-based caching and enable semantic search/Q&A capabilities.

## Recommended Approach

1. **Add SQLite with Drizzle ORM** (or Prisma)
   - Schema: feeds, items, scores, search_history
   - Maintain: feed_id, item_id, published_at, category, final_score, ranking_history

2. **Migrate from file cache to database**
   - Load feeds from DB instead of `.cache/feeds.json`
   - Keep in-memory cache for performance
   - Add cache invalidation logic

3. **Persistence layer for ranking**
   - Store all scored items, not just final selection
   - Track algorithm changes over time
   - Enable A/B testing of scoring weights

4. **Add embeddings & semantic search** (optional for this session)
   - Generate embeddings for items using Claude's embedding API
   - Build FAISS/SQLite vector index
   - Implement `GET /api/search?q=...` endpoint

5. **Add LLM Q&A endpoint** (stretch goal)
   - `POST /api/qa` - answer questions about digest items
   - Use Claude to synthesize answers from relevant items
   - Cache answers to avoid repeated LLM calls

## Beads to Pick Up

- **code-intel-digest-g66**: Set up SQLite database (HIGH PRIORITY)
- **code-intel-digest-bkx**: Add cache expiration strategy
- **code-intel-digest-qr4**: Ranking persistence layer
- **code-intel-digest-mop**: Search & Q&A endpoints

## Testing Checklist

- [ ] Database schema created and migrations working
- [ ] Feed discovery still works (reads from DB)
- [ ] Item ranking and selection unchanged
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] UI still shows proper categories and content

## Rate Limit Handling

Once DB is in place:
1. Store last refresh timestamp
2. Only refresh subscriptions if > 6 hours old (Inoreader limit: ~100 req/day)
3. Always read items from cache first
4. Fall back to API only when cache miss

Good luck! 🚀
