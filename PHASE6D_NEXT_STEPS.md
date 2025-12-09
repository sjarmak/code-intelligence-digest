# Phase 6D: Digest Page (Optional Polish)

**Status**: Not Started (Recommended for next session)  
**Bead**: `code-intel-digest-byv`  
**Effort**: 4-5 hours  
**Priority**: P2 (Nice-to-have, not critical for core functionality)

---

## Overview

Create a `/digest` page that provides a high-level summary and highlights of the current week/month/day's top content. This is a "recap" page that gives users quick insights without browsing the full category lists.

---

## What to Build

### 1. New Route: `/digest`

**File to create**: `app/digest/page.tsx`

```typescript
'use client';

import { useState } from 'react';
import DigestPage from '@/src/components/digest/digest-page';

type Period = 'day' | 'week' | 'month';

export default function Digest() {
  const [period, setPeriod] = useState<Period>('week');

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header with period selector */}
      <DigestPage period={period} onPeriodChange={setPeriod} />
    </div>
  );
}
```

### 2. API Endpoint: `/api/digest`

**File to create**: `app/api/digest/route.ts`

```typescript
/**
 * GET /api/digest?period=week
 * Returns AI summary + highlights + themes for a digest period
 */

interface DigestResponse {
  period: 'day' | 'week' | 'month';
  dateRange: { start: string; end: string };
  summary: string; // AI-generated summary
  themes: string[]; // Key themes/topics
  itemCount: number;
  highlights: {
    newsletters: RankedItem[];
    podcasts: RankedItem[];
    tech_articles: RankedItem[];
    ai_news: RankedItem[];
    product_news: RankedItem[];
    community: RankedItem[];
    research: RankedItem[];
  };
}
```

**Logic**:
1. Load top items for each category (period-filtered)
2. Extract top 3-5 per category
3. Analyze all items to find common themes
4. Generate summary using theme analysis

### 3. Components

Create directory: `src/components/digest/`

#### a. `digest-page.tsx`
- Main page component
- Shows period selector (daily/weekly/monthly)
- Renders summary section
- Renders highlights section
- Shows theme chips

#### b. `digest-summary.tsx`
- Displays AI-generated summary (200-300 words)
- Shows date range
- Shows item count

#### c. `digest-highlights.tsx`
- Shows top 3-5 items per category
- Uses compact list format
- Links to full category digests

#### d. `digest-trends.tsx`
- Displays identified themes/trends
- Shows frequency count
- Clickable theme chips

---

## Implementation Steps

### Step 1: Create API Endpoint

1. Create `app/api/digest/route.ts`
2. Implement GET handler:
   - Map period to days (1/7/30)
   - Load items from each category
   - Extract top items per category
   - Analyze themes
   - Generate summary text
   - Return JSON response

### Step 2: Create Components

1. Create `src/components/digest/digest-page.tsx`
   - Period selector buttons
   - Layout for summary + highlights
   - Suspense boundaries for loading states

2. Create `src/components/digest/digest-summary.tsx`
   - Display summary text
   - Show date range
   - Show item count

3. Create `src/components/digest/digest-highlights.tsx`
   - Category tabs or sections
   - Compact item list (reuse item-card but minimal mode)
   - Link to full category

4. Create `src/components/digest/digest-trends.tsx`
   - Theme chips/badges
   - Frequency indicators

### Step 3: Create Route

1. Create `app/digest/page.tsx`
2. Add to main navigation (if desired)
3. Link from main page

---

## Summary Generation Logic

### Template-Based (Current Approach)
```typescript
function generateDigestSummary(themes: string[], itemCount: number, period: string): string {
  const themeList = themes.slice(0, 5).join(', ');
  return `
This week in Code Intelligence:
${itemCount} new items covering key themes: ${themeList}.

Top focus areas include semantic search improvements, AI agent frameworks, 
and advanced context management techniques. The community continues to 
prioritize developer experience and tooling across enterprise codebases.

Key recommendations:
- Review top items in ${themes[0]} category for latest advances
- Check research category for academic perspectives
- Explore community discussions for practical insights
`;
}
```

### LLM-Based (Future Enhancement)
```typescript
async function generateDigestSummary(
  themes: string[],
  topItems: RankedItem[],
  period: string
): Promise<string> {
  const client = new Anthropic();
  
  const prompt = `
Summarize this week's code intelligence content in 200-300 words:
Themes: ${themes.join(', ')}
Top items: ${topItems.map(i => i.title).join(', ')}

Focus on: insights, trends, actionable takeaways for senior engineers.
`;

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}
```

---

## Theme Extraction Algorithm

```typescript
function extractThemes(items: RankedItem[]): Map<string, number> {
  const themes = new Map<string, number>();

  // Domain terms (from AGENTS.md)
  const domainTerms = {
    'code search': 1.6,
    'semantic search': 1.5,
    'agents': 1.4,
    'context management': 1.5,
    'embeddings': 1.5,
    // ... etc
  };

  for (const item of items) {
    const text = `${item.title} ${item.summary || ''}`.toLowerCase();
    
    for (const [term, weight] of Object.entries(domainTerms)) {
      if (text.includes(term)) {
        themes.set(term, (themes.get(term) || 0) + weight);
      }
    }

    // Also count from LLM tags
    for (const tag of item.llmScore.tags) {
      themes.set(tag, (themes.get(tag) || 0) + 1);
    }
  }

  // Return top N themes sorted by frequency
  return new Map(
    [...themes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  );
}
```

---

## Example Digest Response

```json
{
  "period": "week",
  "dateRange": {
    "start": "2025-12-01",
    "end": "2025-12-07"
  },
  "summary": "This week's code intelligence digest highlights advances in semantic search and agentic workflows. The community is focused on context management techniques for large language models, with particular emphasis on token budgeting and hierarchical summarization. Key themes include embeddings-based retrieval, code navigation improvements, and enterprise-scale monorepo management.",
  "themes": [
    "semantic search",
    "agents",
    "context management",
    "embeddings",
    "code search",
    "devtools",
    "llm",
    "monorepo",
    "refactoring",
    "code review"
  ],
  "itemCount": 47,
  "highlights": {
    "newsletters": [
      { "id": "...", "title": "...", "finalScore": 0.85 },
      { "id": "...", "title": "...", "finalScore": 0.82 },
      { "id": "...", "title": "...", "finalScore": 0.78 }
    ],
    "ai_news": [
      { "id": "...", "title": "...", "finalScore": 0.83 },
      ...
    ],
    ...
  }
}
```

---

## Navigation Integration

### Option 1: New Top-Level Route
- Add `/digest` link to main nav
- Appears alongside `/search` and `/ask`

### Option 2: Part of Main Page
- Add digest tab next to Digest/Search/Ask tabs
- Reuse same layout

### Recommended: Option 1
- Cleaner separation of concerns
- `/` = browse by category
- `/digest` = high-level recap
- `/search` = semantic search
- `/ask` = Q&A

---

## Styling Considerations

- Use same dark theme as main page
- Theme chips with background colors (similar to category badges)
- Summary as prominent card/section
- Highlights in compact list format
- Responsive grid for category sections (2 cols on desktop, 1 on mobile)

---

## Testing

```typescript
// tests/digest.test.ts

describe('Digest Page', () => {
  test('loads digest for week period', async () => {
    const res = await fetch('/api/digest?period=week');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.period).toBe('week');
    expect(data.summary).toBeTruthy();
    expect(data.themes).toHaveLength(10);
  });

  test('theme extraction works correctly', () => {
    const themes = extractThemes(mockItems);
    expect(themes.size).toBeGreaterThan(0);
    expect(themes.get('semantic search')).toBeGreaterThan(0);
  });

  test('highlights per category limited', async () => {
    const res = await fetch('/api/digest?period=week');
    const data = await res.json();
    expect(data.highlights.newsletters.length).toBeLessThanOrEqual(5);
  });
});
```

---

## Cost Estimation

**Without LLM**: <$0.01 per digest (template-based)  
**With LLM** (Claude Haiku): ~$0.006 per digest (daily = $2.20/year)

---

## Timeline

**If doing next session**:
- 1 hour: API endpoint
- 2 hours: Components
- 1 hour: Styling & responsive
- 1 hour: Testing

**Total**: 4-5 hours

---

## Success Criteria

✅ Digest page loads and displays  
✅ Period selector works (daily/week/month)  
✅ Summary is coherent and insightful  
✅ Highlights show top items per category  
✅ Themes extracted and displayed  
✅ Links work (navigate to full category)  
✅ Responsive on mobile/desktop  
✅ Zero TypeScript/ESLint errors  

---

## Future Enhancements

1. **Email Digest**: Send daily/weekly email with summary
2. **LLM Summary**: Replace template with Claude-generated prose
3. **Custom Themes**: Let users select themes to focus on
4. **Export**: PDF/Markdown export of digest
5. **Trending**: Show trending themes over time
6. **Personalization**: User preferences for categories/themes

---

**Note**: This is completely optional for Phase 6. Core functionality is 100% complete without it.
