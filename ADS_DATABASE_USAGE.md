# ADS Database Operations Reference

## Overview
The `src/lib/db/ads-papers.ts` module provides all functions for storing and retrieving cached ADS paper data locally.

## Function Reference

### Initialization
```typescript
import { initializeADSTables } from '@/src/lib/db/ads-papers';

// Creates tables if they don't exist
initializeADSTables();
```

### Storing Papers

#### Single Paper
```typescript
import { storePaper } from '@/src/lib/db/ads-papers';

storePaper({
  bibcode: '2025arXiv251212730D',
  title: 'Paper Title',
  authors: JSON.stringify(['Author One', 'Author Two']),
  pubdate: '2025-12-27',
  abstract: 'Abstract text...',
  body: 'Full paper text here...',
  adsUrl: 'https://ui.adsabs.harvard.edu/abs/2025arXiv251212730D',
  arxivUrl: 'https://arxiv.org/abs/2512.12730',
  fulltextSource: 'ads_api',
});
```

#### Batch Insert (Faster)
```typescript
import { storePapersBatch } from '@/src/lib/db/ads-papers';

const papers = [
  {
    bibcode: '2025arXiv251212730D',
    title: 'Paper 1',
    body: '...',
    // ... other fields
  },
  {
    bibcode: '2024ApJ...969...88M',
    title: 'Paper 2',
    body: '...',
    // ... other fields
  },
];

storePapersBatch(papers);
```

### Retrieving Papers

#### Get Single Paper
```typescript
import { getPaper } from '@/src/lib/db/ads-papers';

const paper = getPaper('2025arXiv251212730D');
if (paper) {
  console.log(paper.title);
  console.log(paper.body); // Full text
  console.log(paper.abstract);
}
```

#### Get Papers in a Library
```typescript
import { getLibraryPapers } from '@/src/lib/db/ads-papers';

const papers = getLibraryPapers('library-id', limit = 100, offset = 0);
// Returns most recently fetched papers first
papers.forEach(p => {
  console.log(p.title);
});
```

#### Search Papers
```typescript
import { searchPapers } from '@/src/lib/db/ads-papers';

// Full-text search in title, abstract, authors
const results = searchPapers('black hole', limit = 50);
results.forEach(p => {
  console.log(`${p.title} by ${p.authors}`);
});
```

### Linking Papers to Libraries

#### Single Link
```typescript
import { linkPaperToLibrary } from '@/src/lib/db/ads-papers';

linkPaperToLibrary('library-id', '2025arXiv251212730D');
```

#### Batch Link
```typescript
import { linkPapersToLibraryBatch } from '@/src/lib/db/ads-papers';

const bibcodes = ['2025arXiv251212730D', '2024ApJ...969...88M'];
linkPapersToLibraryBatch('library-id', bibcodes);
```

### Checking Full Text Cache

#### Has Full Text?
```typescript
import { hasCachedFullText } from '@/src/lib/db/ads-papers';

if (hasCachedFullText('2025arXiv251212730D')) {
  console.log('Full text is available in database');
} else {
  console.log('Only metadata is cached');
}
```

#### Get Papers Missing Full Text
```typescript
import { getPapersMissingFullText } from '@/src/lib/db/ads-papers';

const incomplete = getPapersMissingFullText(limit = 50);
incomplete.forEach(p => {
  console.log(`${p.bibcode}: missing full text`);
});
```

## Data Structure

### ADSPaperRecord
```typescript
interface ADSPaperRecord {
  bibcode: string;              // Primary key
  title?: string;               // Paper title
  authors?: string;             // JSON stringified array
  pubdate?: string;             // e.g., "2025-12-27"
  abstract?: string;            // Paper abstract
  body?: string;                // **FULL TEXT** from ADS API
  year?: number;                // Publication year
  journal?: string;             // Journal abbreviation
  adsUrl?: string;              // ADS abstract page URL
  arxivUrl?: string | null;     // arXiv URL if available
  fulltextSource?: string;      // "ads_api" or other source
}
```

## Practical Examples

### Example 1: Store Fetched Papers
```typescript
import { storePapersBatch, linkPapersToLibraryBatch } from '@/src/lib/db/ads-papers';

async function saveFetchedPapers(libraryId: string, metadata: any) {
  const papers = Object.entries(metadata).map(([bibcode, data]: [string, any]) => ({
    bibcode,
    title: data.title,
    authors: JSON.stringify(data.authors),
    abstract: data.abstract,
    body: data.body, // Full text from API
    pubdate: data.pubdate,
    adsUrl: `https://ui.adsabs.harvard.edu/abs/${bibcode}`,
    fulltextSource: data.body ? 'ads_api' : undefined,
  }));

  // Store all papers
  storePapersBatch(papers);
  
  // Link to library
  linkPapersToLibraryBatch(libraryId, Object.keys(metadata));
}
```

### Example 2: Find Relevant Papers
```typescript
import { searchPapers, getPaper } from '@/src/lib/db/ads-papers';

function findRelevantPapers(topic: string) {
  const papers = searchPapers(topic, limit = 20);
  
  return papers
    .filter(p => p.body && p.body.length > 1000) // Has substantial full text
    .map(p => ({
      bibcode: p.bibcode,
      title: p.title,
      hasFullText: !!p.body,
      link: p.arxivUrl || p.adsUrl,
    }));
}
```

### Example 3: LLM Processing
```typescript
import { getPapersMissingFullText, hasCachedFullText } from '@/src/lib/db/ads-papers';

async function prepareForLLM() {
  // Get papers with full text
  const allPapers = getPaper('some-bibcode');
  
  if (allPapers?.body) {
    // Send to LLM for summarization
    const summary = await llm.summarize(allPapers.body);
    console.log(summary);
  }
}
```

## Database Schema

### ads_papers table
- `bibcode` (TEXT PRIMARY KEY) - Unique identifier
- `title` (TEXT) - Paper title
- `authors` (TEXT) - JSON array of authors
- `pubdate` (TEXT) - Publication date
- `abstract` (TEXT) - Paper abstract
- `body` (TEXT) - **Full paper text from ADS**
- `year` (INTEGER) - Publication year
- `journal` (TEXT) - Journal name
- `ads_url` (TEXT) - ADS abstract page
- `arxiv_url` (TEXT) - arXiv link if applicable
- `fulltext_source` (TEXT) - Source of full text ("ads_api", etc.)
- `fetched_at` (INTEGER) - When metadata was fetched
- `created_at` (INTEGER) - When record was created
- `updated_at` (INTEGER) - When record was last updated

### ads_library_papers table
- `library_id` (TEXT) - Which library
- `bibcode` (TEXT) - Which paper (FK to ads_papers)
- `added_at` (INTEGER) - When added to library
- Primary key: `(library_id, bibcode)`

### ads_libraries table
- `id` (TEXT PRIMARY KEY) - Library ID from ADS
- `name` (TEXT) - Library name
- `description` (TEXT) - Library description
- `num_documents` (INTEGER) - Number of papers
- `is_public` (INTEGER) - 0 or 1
- `fetched_at` (INTEGER) - Last time list was fetched
- `created_at` (INTEGER) - Record creation time
- `updated_at` (INTEGER) - Last update time

## Tips

1. **Authors are JSON**: Parse with `JSON.parse(paper.authors)`
2. **Body is large**: Use carefully in memory - consider streaming for very large papers
3. **Automatic indexing**: Queries are indexed on year, journal, and foreign keys
4. **Transactions**: Batch operations use transactions for efficiency
5. **Graceful degradation**: All functions handle errors gracefully and log warnings
6. **Full text first load**: First fetch of a library will store all full text automatically

## Troubleshooting

### No results from search?
- Check that papers are actually stored: `getPaper(bibcode)`
- Search works on title, abstract, and authors - check query terms
- Result limit defaults to 50 - increase `limit` parameter

### Missing full text?
- Check `fulltextSource` field
- Use `hasCachedFullText()` to verify
- Use `getPapersMissingFullText()` to find incomplete papers

### Performance issues?
- Use `storePapersBatch()` instead of multiple `storePaper()` calls
- Index queries by year or journal for filtering
- Consider pagination for large result sets

## Future Enhancements

- [ ] Full-text indexing with FTS5
- [ ] Citation tracking and graph analysis
- [ ] Relevance ranking based on custom scoring
- [ ] Integration with embedding models
- [ ] Periodic refresh of paper metadata
