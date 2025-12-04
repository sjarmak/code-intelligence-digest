# Next Session: Claude API Integration & Polish

## Context

Just completed UI components for search and Q&A (code-intel-digest-l1z):
- ✅ Full search interface with semantic similarity scoring
- ✅ Q&A interface with answer generation and source citations  
- ✅ Main dashboard now has Digest/Search/Ask tabs
- ✅ All code passes TypeScript strict + ESLint zero warnings
- ✅ Components follow existing design patterns

## Current State

**What Works:**
- `/api/search` returns real semantic search results ✅
- `/api/ask` returns template-based answers (MVP) ⚠️
- UI components fully implemented ✅
- Database has embeddings table with caching ✅
- Scoring system complete ✅

**What's Needed:**
- Replace template answers with real Claude responses
- Integrate Claude API for LLM scoring (currently hardcoded mocks)
- Stream long answers for better UX
- Pre-warm embeddings for new items

## Primary: Claude API Integration (code-intel-digest-5d3, P2)

### 1. LLM Answer Generation (`app/api/ask/route.ts`)

Current: Template-based answer
```typescript
const answer = `Based on the code intelligence digest, here's what I found...`;
```

Target: Real Claude response
```typescript
import Anthropic from '@anthropic-ai/sdk';

async function generateAnswerWithClaude(
  question: string,
  sourceItems: Array<{ title: string; summary?: string; sourceTitle: string }>
): Promise<string> {
  const client = new Anthropic();
  
  const sourceText = sourceItems
    .map((item, i) => `${i + 1}. "${item.title}" (${item.sourceTitle})\n${item.summary || ''}`)
    .join('\n\n');
    
  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    system: `You are an expert assistant for a code intelligence digest. 
Answer questions using ONLY the provided sources. Be concise and technical.`,
    messages: [{
      role: 'user',
      content: `Based on these sources, answer the question:\n\nSources:\n${sourceText}\n\nQuestion: ${question}`
    }]
  });
  
  return response.content[0].type === 'text' ? response.content[0].text : '';
}
```

### 2. LLM Scoring in Ranking Pipeline (`src/lib/pipeline/llmScore.ts`)

Currently mocked (returns fixed scores). Need real integration:

```typescript
export async function scoreBatch(items: FeedItem[]): Promise<LLMScoreResult[]> {
  const client = new Anthropic();
  
  // Batch 10 items per request to avoid token limits
  const batches = chunk(items, 10);
  const results: LLMScoreResult[] = [];
  
  for (const batch of batches) {
    const itemText = batch
      .map(item => `ID: ${item.id}\nTitle: ${item.title}\nSummary: ${item.summary}`)
      .join('\n---\n');
      
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 500,
      system: `Score items for relevance to code intelligence topics...`,
      messages: [{
        role: 'user',
        content: `Score these items:\n${itemText}\n\nRespond with JSON: [{id, relevance (0-10), usefulness (0-10), tags: [...]}]`
      }]
    });
    
    // Parse JSON response and add to results
  }
  
  return results;
}
```

### 3. Setup

Add to `package.json`:
```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.20.0"
}
```

Add env var:
```
ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Error Handling

Wrap calls with retry logic:
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      const delay = 1000 * Math.pow(2, i); // Exponential backoff
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Max retries exceeded');
}
```

Handle gracefully when API fails:
- Fall back to template answers
- Use cached scores if available
- Log errors for monitoring

## Secondary: Cache Warming (code-intel-digest-yab, P2)

Pre-compute embeddings and scores when items are added:
- Hook into `/api/items` after saving
- Generate embeddings batch for new items
- Cache in database before returning

```typescript
// In /api/items/route.ts after saving items
const newItemIds = newItems.map(i => i.id);
const embeddings = await generateEmbeddingsBatch(
  newItems.map(i => `${i.title} ${i.summary || ''}`)
);
await saveEmbeddingsBatch(embeddings.map((e, i) => ({
  itemId: newItemIds[i],
  embedding: e
})));
```

## Tertiary: Score Experimentation (code-intel-digest-d2d, P2)

Dashboard to tune hybrid scoring weights:
- Add `/api/experiments` to save score configurations
- Add `GET /api/items?experiment=<id>` to apply config
- Frontend component to adjust weights and see results live

## Testing Checklist

- [ ] Claude API connected (check env var)
- [ ] Answer generation works end-to-end
- [ ] Scoring returns valid 0-10 values
- [ ] Retry logic handles transient failures
- [ ] Fallback to templates on API failure
- [ ] All TypeScript and ESLint pass
- [ ] No console errors in browser dev tools

## Git Workflow

```bash
bd update code-intel-digest-5d3 --status in_progress

# Implement Claude integration...

npm run typecheck && npm run lint  # Verify

bd close code-intel-digest-5d3 --reason "Integrated Claude API for answer generation and LLM scoring"

# Repeat for other beads as needed
```

## References

- **Claude API docs**: https://docs.anthropic.com/
- **Integration patterns**: See `src/lib/inoreader/client.ts` for HTTP retry patterns
- **Error handling**: Check `src/lib/logger.ts` for logging conventions
- **Scoring**: `src/lib/pipeline/llmScore.ts` has the structure to fill in

## Quick Start

1. Check `npm run typecheck && npm run lint` ✅
2. Install Claude SDK: `npm install @anthropic-ai/sdk`
3. Update env var `ANTHROPIC_API_KEY`
4. Implement in order: Answer generation → LLM scoring → Streaming
5. Test with curl: `curl "http://localhost:3000/api/ask?question=..."`
6. Verify database: Check `item_scores` table has new scores

Good luck! 🚀
