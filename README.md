# Code Intelligence Digest

A focused application that aggregates content from Inoreader feeds and presents curated weekly/monthly digests of code intelligence, tools, and AI agents using hybrid LLM + BM25 + recency scoring.

## Features

- **Inoreader Integration**: Fetch items from configured Inoreader feeds and streams
- **Multi-Category Support**: 7 fixed digest categories:
  - Newsletters
  - Podcasts
  - Tech Articles
  - AI News
  - Product News
  - Community (Reddit, forums)
  - Research (academic papers)
- **Hybrid Scoring Pipeline**:
  - **LLM Evaluation**: Keyword-based heuristic scoring for relevance/usefulness
  - **BM25 Term Matching**: Domain-focused term relevance
  - **Recency**: Exponential decay with category-specific half-lives
  - **Diversity Constraints**: Per-source caps to ensure feed variety
- **Next.js Frontend**: Modern shadcn-style UI with tabbed navigation
- **Server-Side Ranking**: Fast, stateless HTTP API with on-demand computation

## Tech Stack

- **Framework**: Next.js 15+ (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS + custom components
- **Scoring**: BM25 (from-scratch implementation) + heuristic LLM
- **API**: RESTful JSON endpoint for frontend

## Project Structure

```
code-intel-digest/
├── app/
│   ├── api/
│   │   └── items/
│   │       └── route.ts          # GET /api/items?category=&period=
│   ├── layout.tsx
│   ├── page.tsx                  # Main dashboard
│   └── globals.css
├── src/
│   ├── config/
│   │   ├── feeds.ts              # FeedConfig[] mapping streamId → category
│   │   └── categories.ts         # CATEGORY_CONFIG with scoring params
│   ├── lib/
│   │   ├── inoreader/
│   │   │   ├── client.ts         # Inoreader API client
│   │   │   └── types.ts          # Type definitions
│   │   ├── pipeline/
│   │   │   ├── normalize.ts      # Raw → FeedItem
│   │   │   ├── categorize.ts     # Category assignment
│   │   │   ├── bm25.ts           # BM25 scoring
│   │   │   ├── llmScore.ts       # LLM evaluation
│   │   │   ├── rank.ts           # Combined ranking
│   │   │   └── select.ts         # Diversity selection
│   │   ├── model.ts              # Core TypeScript types
│   │   └── logger.ts             # Structured logging
│   └── components/
│       └── feeds/
│           ├── items-grid.tsx    # Grid layout with API fetch
│           └── item-card.tsx     # Individual item display
├── .env.local.example
├── package.json
└── README.md
```

## Setup & Installation

### Prerequisites

- Node.js 18+ and npm/yarn
- Inoreader account with API access token

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.local.example` to `.env.local` and fill in your Inoreader OAuth2 credentials:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
INOREADER_CLIENT_ID=your_client_id
INOREADER_CLIENT_SECRET=your_client_secret
INOREADER_REFRESH_TOKEN=your_refresh_token
```

**How to get these credentials:**

1. Register your app: https://www.inoreader.com/oauth/accounts/login?redirect_url=/oauth/register
2. You'll receive Client ID and Client Secret
3. Use the OAuth2 flow to obtain a Refresh Token
4. (Alternative) Copy from research-agent if you have existing credentials

### 3. Configure Feeds

Edit `src/config/feeds.ts` with your Inoreader stream IDs. Stream IDs can be:

- `feed/https://example.com/feed.xml` (RSS feeds)
- `user/[user-id]/label/[label-name]` (labels/folders)

To find your stream IDs:

1. Use INOREADER_SUBSCRIPTIONS.md from research-agent (if available)
2. Or call Inoreader API: `https://www.inoreader.com/reader/api/0/user-info` with your token
3. Parse the subscription list to extract stream IDs

Example configuration:

```typescript
export const FEEDS: FeedConfig[] = [
  {
    streamId: "feed/https://pragmaticengineer.com/feed/",
    canonicalName: "Pragmatic Engineer",
    defaultCategory: "newsletters",
    tags: ["eng-leadership"],
  },
  // Add more feeds...
];
```

### 4. Run Development Server

```bash
npm run dev
```

Visit http://localhost:3000 to see the digest.

## Build & Deployment

```bash
# Type-check
npm run typecheck

# Lint
npm run lint

# Production build (NODE_ENV must be unset!)
unset NODE_ENV && npm run build

# Start production server
npm start
```

> **Note:** If `NODE_ENV=development` is set, the build will fail. Always unset it before building.

### Deploy to Render

This project includes a `render.yaml` Blueprint for one-click deployment to [Render](https://render.com):

1. Fork/push to GitHub
2. In Render Dashboard, click "New" → "Blueprint"
3. Connect your repository
4. Render will auto-detect `render.yaml` and create:
   - Web Service (Next.js app)
   - PostgreSQL database (production)
5. Set required environment variables in Render:
   - `INOREADER_CLIENT_ID`
   - `INOREADER_CLIENT_SECRET`
   - `INOREADER_REFRESH_TOKEN`
   - `ADMIN_API_TOKEN` (required in production)
   - `OPENAI_API_KEY` (optional, for LLM scoring)

**Local Development:** Uses SQLite (`.data/digest.db`)
**Production:** Uses PostgreSQL (auto-configured by Render)

See [history/docs/RENDER_DEPLOYMENT.md](history/docs/RENDER_DEPLOYMENT.md) for full deployment guide.

## Audio Rendering System (NEW - Jan 2025)

Convert podcast transcripts to high-quality MP3/WAV audio files using multiple TTS providers:

- **OpenAI TTS** (tts-1, tts-1-hd) - Primary provider
- **ElevenLabs TTS** - High-quality synthesis
- **NeMo TTS** - NVIDIA Riva endpoint

**Features:**

- Automatic transcript sanitization (removes `[INTRO]`, `[PAUSE]`, etc.)
- Intelligent caching by transcript hash
- Multi-provider abstraction (easy to add more)
- Local file storage (swappable to S3/GCS/R2)
- Full error handling with timeouts

**Quick Start:**

```bash
export OPENAI_API_KEY=sk-...

curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Welcome to the show","provider":"openai"}'
```

**Documentation:**

- [Quick Reference](./AUDIO_QUICK_REFERENCE.md) - One-page cheat sheet
- [Complete Guide](./AUDIO_RENDERING_GUIDE.md) - Full technical details
- [Examples](./AUDIO_RENDERING_EXAMPLES.md) - Copy-paste examples
- [API Reference](./API_REFERENCE.md) - Full API documentation
- [Test Report](./TEST_EXECUTION_REPORT.md) - All 18 tests passing

## API Reference

### GET /api/items

Fetch ranked items for a category and time period.

**Query Parameters:**

- `category` (required): One of `newsletters`, `podcasts`, `tech_articles`, `ai_news`, `product_news`, `community`, `research`
- `period` (optional): `week` or `month` (default: `week`)

**Response:**

```json
{
  "items": [
    {
      "id": "item-id",
      "title": "Article Title",
      "url": "https://example.com/article",
      "sourceTitle": "Source Feed Name",
      "publishedAt": "2025-01-15T10:30:00Z",
      "summary": "Full article summary...",
      "contentSnippet": "First 500 chars...",
      "category": "newsletters",
      "bm25Score": 0.75,
      "llmScore": {
        "relevance": 8.5,
        "usefulness": 7.2,
        "tags": ["code-search", "agents"]
      },
      "recencyScore": 0.95,
      "finalScore": 0.82,
      "reasoning": "Score breakdown..."
    }
  ],
  "category": "newsletters",
  "period": "week",
  "count": 5
}
```

## Scoring System

### Overview

Each item is scored across multiple dimensions:

1. **LLM Evaluation** (45% weight):

   - Keyword-based heuristic matching against domain terms
   - Relevance score (0–10)
   - Usefulness score (0–10)
   - Domain tags (code-search, agents, context, etc.)

2. **BM25 Term Matching** (35% weight):

   - Category-specific query against document text
   - Normalized to [0, 1]

3. **Recency** (20% weight):
   - Exponential decay with category-specific half-lives
   - Formula: `2^(-ageDays / halfLifeDays)` clamped to [0.2, 1.0]
   - Weekly digest: 3-5 day half-lives
   - Monthly digest: 7-10 day half-lives

### Formula

```
finalScore = (llm_norm * 0.45) + (bm25_norm * 0.35) + (recency * 0.20)
```

### Filtering & Selection

- Remove items with relevance < minRelevance (per category)
- Remove items tagged as "off-topic" by heuristics
- Sort by finalScore descending
- Enforce per-source diversity cap (max 2 per source for weekly, max 3 for monthly)
- Return up to maxItems per category (4-6 depending on category)

## Domain Terms & Categories

The scoring system recognizes these domain concepts:

| Domain                    | Weight | Examples                                             |
| ------------------------- | ------ | ---------------------------------------------------- |
| **Code Search**           | 1.6x   | semantic search, indexing, symbols, cross-references |
| **Information Retrieval** | 1.5x   | embeddings, RAG, vector databases                    |
| **Context Management**    | 1.5x   | context window, token budget, compression            |
| **Agentic Workflows**     | 1.4x   | agents, planning, tool use, orchestration            |
| **Enterprise Codebases**  | 1.3x   | monorepo, dependency, scale, legacy                  |
| **Developer Tools**       | 1.2x   | IDE, debugging, refactoring, CI/CD                   |
| **LLM Architecture**      | 1.2x   | transformers, fine-tuning, reasoning                 |
| **SDLC Processes**        | 1.0x   | code review, testing, deployment                     |

## Logging

Structured logging is available via `src/lib/logger.ts`:

```typescript
import { logger } from "@/lib/logger";

logger.info("Pipeline started", { category: "newsletters" });
logger.error("Failed to fetch", error);
```

Enable debug output:

```bash
DEBUG=1 npm run dev
```

## Extending the System

### Add a New Feed

1. Find the stream ID from your Inoreader account
2. Add to `src/config/feeds.ts`:
   ```typescript
   {
     streamId: "feed/https://example.com/feed",
     canonicalName: "Example Feed",
     defaultCategory: "tech_articles",
     tags: ["my-tag"],
   }
   ```

### Customize Scoring Per Category

Edit `src/config/categories.ts`:

- Adjust `query` string (BM25 terms)
- Change `weights` (llm/bm25/recency proportions)
- Modify `halfLifeDays` (recency decay)
- Update `maxItems` and `minRelevance`

### Integrate Claude API

Replace heuristic scoring in `src/lib/pipeline/llmScore.ts`:

- Implement `scoreWithClaudeAPI()` function
- Call Claude to evaluate items in batch
- Parse response into `LLMScoreResult`

## Troubleshooting

### No items returned from API

1. Check `.env.local` has valid `INOREADER_CLIENT_ID`, `INOREADER_CLIENT_SECRET`, and `INOREADER_REFRESH_TOKEN`
2. Verify feeds are configured in `src/config/feeds.ts`
3. Check server logs: `npm run dev`

### Type errors during build

```bash
npm run typecheck  # Run TypeScript compiler
```

### Styling issues

- Verify Tailwind CSS is configured in `tailwind.config.ts`
- Clear `.next` cache: `rm -rf .next`
- Rebuild: `npm run build`

## Contributing

To improve the digest:

1. **Adjust scoring weights** in `src/config/categories.ts`
2. **Add domain terms** to keyword lists in `src/lib/pipeline/llmScore.ts`
3. **Test with real feeds**: Configure feeds and verify rankings
4. **Profile performance**: Check API response times with `DEBUG=1`

## Performance Notes

- **On-demand ranking**: Items are ranked at request time; no database needed
- **Memory usage**: Scales with items fetched from Inoreader (typically 100-500)
- **BM25 indexing**: O(n) for n items, negligible overhead
- **LLM scoring**: Heuristic (fast); Claude API integration would be async

## Future Enhancements

- [ ] Claude API integration for sophisticated LLM evaluation
- [ ] Persistent storage of scored items with caching
- [ ] Batch LLM scoring with rate limiting
- [ ] User preferences (favorite sources, category weights)
- [ ] Export to email, Slack, or Markdown
- [ ] Interactive ranking explanation UI
- [ ] A/B testing framework for scoring weights

## License

MIT

## References

- [Inoreader API Documentation](https://www.inoreader.com/reader/api/)
- [BM25 Algorithm](https://en.wikipedia.org/wiki/Okapi_BM25)
- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS](https://tailwindcss.com/)
