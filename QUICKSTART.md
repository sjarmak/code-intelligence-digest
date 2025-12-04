# Code Intelligence Digest - Quick Start

## 1. Get Your Inoreader OAuth2 Credentials

1. Register your app at: https://www.inoreader.com/oauth/accounts/login?redirect_url=/oauth/register
2. Note your **Client ID** and **Client Secret**
3. Follow the OAuth2 flow to get your **Refresh Token**
   - Or use an existing refresh token from research-agent if available

## 2. Configure Environment

Edit `.env.local`:
```bash
INOREADER_CLIENT_ID=<your_client_id>
INOREADER_CLIENT_SECRET=<your_client_secret>
INOREADER_REFRESH_TOKEN=<your_refresh_token>
```

## 3. Add Your Feeds

Edit `src/config/feeds.ts` and add your Inoreader stream IDs:

```typescript
export const FEEDS: FeedConfig[] = [
  {
    streamId: "feed/https://your-feed-url/feed.xml",
    canonicalName: "Your Feed Name",
    defaultCategory: "newsletters",
    tags: ["tag1", "tag2"],
  },
  // Add more feeds...
];
```

### Finding Your Stream IDs

**From research-agent project:**
- Check `/Users/sjarmak/research-agent/INOREADER_SUBSCRIPTIONS.md` if available

**From Inoreader API:**
```bash
curl -H "Authorization: Bearer <YOUR_TOKEN>" \
  https://www.inoreader.com/reader/api/0/user-info | jq .subscriptions
```

Stream IDs look like:
- `feed/https://example.com/feed.xml` (RSS feeds)
- `user/[id]/label/[label-name]` (labels/folders)

## 4. Run the Dev Server

```bash
npm run dev
```

Visit http://localhost:3000

## 5. Configure Scoring (Optional)

Adjust scoring weights and half-lives in `src/config/categories.ts`:

```typescript
export const CATEGORY_CONFIG: Record<Category, CategoryConfig> = {
  newsletters: {
    name: "Newsletters",
    query: "code search agents devtools",  // ← Edit BM25 query
    halfLifeDays: 3,                       // ← Adjust recency decay
    maxItems: 5,
    weights: {
      llm: 0.45,      // ← Adjust LLM weight
      bm25: 0.35,     // ← Adjust term weight
      recency: 0.2,   // ← Adjust recency weight
    },
  },
  // ... other categories
};
```

## 6. View the Digest

- Frontend: http://localhost:3000
- API: http://localhost:3000/api/items?category=newsletters&period=week

## Testing with Demo Data

If you don't have Inoreader configured, the API will return an error. Check:

```bash
curl http://localhost:3000/api/items?category=newsletters&period=week
```

## Production Deployment

```bash
npm run build
npm start
```

See README.md for full documentation.
