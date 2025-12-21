# ADS Libraries Integration Guide

This guide explains how to set up and use the NASA ADS (Astrophysics Data System) Libraries integration with the Code Intelligence Digest.

## Setup

### 1. Get Your ADS API Token

1. Go to https://ui.adsabs.harvard.edu/settings/token
2. Create an account if you don't have one
3. Generate a new token
4. Copy the token value

### 2. Configure Environment Variable

Add to your `.env.local` file:

```bash
ADS_API_TOKEN=<your-token-here>
```

### 3. Test the Integration

Run the test script to verify your token works:

```bash
npx tsx scripts/test-ads-api.ts
```

You should see:
- List of all your libraries
- Details about the "Benchmarks" library
- First 10 items in the Benchmarks library
- Metadata for the first 3 items

## Using the Libraries View

### Access the UI

1. Navigate to http://localhost:3000/research
2. Or click the **📚 Libraries** button in the header

### Features

- **Browse Libraries**: View papers from your ADS library
- **Pagination**: Navigate through items 20 at a time
- **Metadata Display**: See titles, authors, publication dates, and abstracts
- **Responsive Design**: Works on mobile and desktop

## API Endpoints

### GET /api/libraries

Fetch items from a library.

**Query Parameters:**
- `library` (string, default: "Benchmarks") - Library name
- `rows` (number, default: 20) - Items per page
- `start` (number, default: 0) - Pagination offset
- `metadata` (boolean, default: false) - Include full metadata (slower)

**Example:**

```bash
curl "http://localhost:3000/api/libraries?library=Benchmarks&rows=10&start=0&metadata=true"
```

**Response:**

```json
{
  "library": {
    "id": "library-id",
    "name": "Benchmarks",
    "numPapers": 42
  },
  "items": [
    {
      "bibcode": "2024...",
      "title": "Paper Title",
      "authors": ["Author One", "Author Two"],
      "pubdate": "2024-01-15",
      "abstract": "Paper abstract..."
    }
  ],
  "pagination": {
    "start": 0,
    "rows": 10,
    "total": 42,
    "hasMore": true
  }
}
```

### POST /api/libraries

List all available libraries.

**Example:**

```bash
curl -X POST http://localhost:3000/api/libraries
```

**Response:**

```json
{
  "libraries": [
    {
      "id": "library-id",
      "name": "Benchmarks",
      "numPapers": 42,
      "description": "...",
      "public": false
    }
  ]
}
```

## Implementation Details

### ADS Client (`src/lib/ads/client.ts`)

Core functions for interacting with the ADS API:

- `listLibraries(token)` - Fetch all libraries
- `getLibraryByName(name, token)` - Find a library by name
- `getLibraryItems(libraryId, token, options)` - Get paginated items
- `getBibcodeMetadata(bibcodes, token)` - Fetch detailed metadata for papers

All functions include automatic retry with exponential backoff.

### UI Component (`src/components/libraries/libraries-view.tsx`)

React component that:
- Fetches library items on mount
- Handles pagination
- Displays items in a card layout
- Shows error states

### API Route (`app/api/libraries/route.ts`)

Next.js API route that:
- Validates ADS_API_TOKEN environment variable
- Handles GET requests for library items
- Handles POST requests to list libraries
- Returns proper error responses

## Troubleshooting

### "ADS_API_TOKEN not configured"

Make sure you've added the token to `.env.local` and restarted the server.

### "Library not found"

Check that your library name matches exactly (case-sensitive). Run:

```bash
npx tsx scripts/test-ads-api.ts
```

to see available libraries.

### Rate Limiting

ADS API has rate limits. The client uses exponential backoff, but if you're hitting limits:
1. Check your token's remaining requests in the ADS UI
2. Wait for the rate limit window to reset
3. Contact ADS support if you need higher limits

## Future Enhancements

Potential improvements:
- [ ] Library selector dropdown instead of hardcoded "Benchmarks"
- [ ] Full-text search within libraries
- [ ] Export selected papers to other formats
- [ ] Integration with main digest scoring system
- [ ] Caching of library metadata
- [ ] Bookmarking/starring papers
