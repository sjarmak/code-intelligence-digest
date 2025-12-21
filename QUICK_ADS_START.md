# Quick Start: ADS Libraries

## 1-Minute Setup

```bash
# Get token from https://ui.adsabs.harvard.edu/settings/token
# Add to .env.local:
ADS_API_TOKEN=your-token-here

# Test it works:
npx tsx scripts/test-ads-api.ts

# Access at:
# http://localhost:3000/research
# or click "📚 Libraries" button
```

## What This Does

- **Fetches papers** from your NASA ADS libraries (e.g., Benchmarks)
- **Displays them** in a paginated, searchable format
- **Shows metadata** like authors, publication date, abstract
- **Integrates** into the Code Intelligence Digest UI

## API

```bash
# Get items from Benchmarks library
curl "http://localhost:3000/api/libraries?library=Benchmarks&rows=20&metadata=true"

# List all your libraries
curl -X POST http://localhost:3000/api/libraries
```

## Files

- **Frontend**: `src/components/libraries/libraries-view.tsx`
- **API**: `app/api/libraries/route.ts`
- **Client**: `src/lib/ads/client.ts`
- **Test**: `scripts/test-ads-api.ts`
- **Guide**: `ADS_LIBRARIES_GUIDE.md`

## Troubleshooting

**"ADS_API_TOKEN not configured"**
→ Add token to `.env.local` and restart

**"Library not found"**
→ Run test script to see available libraries

**Rate limiting**
→ Exponential backoff handles this automatically
