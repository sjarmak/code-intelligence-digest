# Next Session: Phase 5 - UI Components

**Date**: December 7, 2025  
**Bead**: code-intel-digest-htm  
**Estimated Time**: 2-3 hours  
**Difficulty**: Medium-High (React component design)

## Overview

The ranking pipeline is complete (Phases 1-4). Now build React components to render the digest in a modern, responsive UI. Components will consume the `/api/items` endpoint and display items with filtering, sorting, and metadata.

## Goal

Build a working digest dashboard that:
1. Displays items from `/api/items` endpoint
2. Allows filtering by category (tabs)
3. Allows selecting time period (weekly/monthly/all)
4. Shows item cards with metadata (scores, source, date, tags)
5. Responsive design with shadcn components

## Architecture

```
┌─────────────────────────────────┐
│    app/page.tsx (Dashboard)     │
│  ┌────────────────────────────┐ │
│  │ DigestHeader               │ │
│  │ "Code Intelligence Digest" │ │
│  └────────────────────────────┘ │
│  ┌────────────────────────────┐ │
│  │ PeriodSelector             │ │
│  │ [Weekly] [Monthly] [All]   │ │
│  └────────────────────────────┘ │
│  ┌────────────────────────────┐ │
│  │ CategoryTabs               │ │
│  │ [Newsletters][Tech][News]  │ │
│  └────────────────────────────┘ │
│  ┌────────────────────────────┐ │
│  │ ItemsGrid (async)          │ │
│  │ Fetches /api/items?category= │
│  │ & period=                  │ │
│  │  ┌────────────────────────┐│ │
│  │  │ ItemCard               ││ │
│  │  │ [Title]                ││ │
│  │  │ Source | Date | Score  ││ │
│  │  │ [Tags]                 ││ │
│  │  └────────────────────────┘│ │
│  │  ... more cards            │ │
│  └────────────────────────────┘ │
└─────────────────────────────────┘
```

## Implementation Plan

### 1. Create app/components/digest/item-card.tsx (100-120 lines)

```typescript
import { RankedItem } from "@/src/lib/model";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";

export interface ItemCardProps {
  item: {
    id: string;
    title: string;
    url: string;
    sourceTitle: string;
    publishedAt: string;
    summary?: string;
    llmScore?: {
      relevance: number;
      usefulness: number;
      tags: string[];
    };
    bm25Score?: number;
    finalScore?: number;
    diversityReason?: string;
  };
}

export function ItemCard({ item }: ItemCardProps) {
  const ageInDays = Math.round(
    (Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 hover:text-blue-600"
          >
            <h3 className="text-lg font-semibold line-clamp-2">
              {item.title}
            </h3>
          </a>
          <ExternalLink className="w-4 h-4 flex-shrink-0 text-gray-400" />
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium">{item.sourceTitle}</span>
          <span>•</span>
          <span>{ageInDays}d ago</span>
        </div>

        {item.summary && (
          <p className="text-sm text-gray-700 line-clamp-2">
            {item.summary}
          </p>
        )}

        <div className="flex flex-wrap gap-1">
          {item.llmScore?.tags.slice(0, 4).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>

        {/* Score breakdown (optional tooltip) */}
        <div className="text-xs text-gray-500 space-y-1">
          {item.llmScore && (
            <div>
              LLM: {item.llmScore.relevance}/10 relevance
            </div>
          )}
          {item.finalScore !== undefined && (
            <div>
              Final Score: {(item.finalScore * 100).toFixed(0)}%
            </div>
          )}
          {item.diversityReason && (
            <div className="text-blue-600">
              ✓ {item.diversityReason}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

### 2. Create app/components/digest/items-grid.tsx (80-100 lines)

```typescript
'use client';

import { useEffect, useState } from 'react';
import { Category } from '@/src/lib/model';
import { ItemCard } from './item-card';
import { Skeleton } from '@/components/ui/skeleton';

export interface ItemsGridProps {
  category: Category;
  period: 'week' | 'month' | 'all';
}

export function ItemsGrid({ category, period }: ItemsGridProps) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchItems = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/items?category=${category}&period=${period}`
        );
        
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        setItems(data.items);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load items'
        );
        setItems([]);
      } finally {
        setLoading(false);
      }
    };

    fetchItems();
  }, [category, period]);

  if (error) {
    return (
      <div className="text-center py-8 text-red-600">
        Error: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-64" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No items found for {category} in the {period}.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {items.map((item) => (
        <ItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}
```

### 3. Create app/components/digest/category-tabs.tsx (60-80 lines)

```typescript
'use client';

import { Category } from '@/src/lib/model';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ItemsGrid } from './items-grid';

export interface CategoryTabsProps {
  period: 'week' | 'month' | 'all';
}

const CATEGORIES: Array<{ id: Category; label: string; description: string }> = [
  { id: 'newsletters', label: 'Newsletters', description: 'Curated newsletters' },
  { id: 'podcasts', label: 'Podcasts', description: 'Audio content' },
  { id: 'tech_articles', label: 'Tech Articles', description: 'Blog posts & essays' },
  { id: 'ai_news', label: 'AI News', description: 'Model releases & research' },
  { id: 'product_news', label: 'Product News', description: 'Releases & features' },
  { id: 'community', label: 'Community', description: 'Reddit & forums' },
  { id: 'research', label: 'Research', description: 'Academic papers' },
];

export function CategoryTabs({ period }: CategoryTabsProps) {
  return (
    <Tabs defaultValue="tech_articles" className="w-full">
      <TabsList className="grid w-full grid-cols-7 mb-4">
        {CATEGORIES.map(({ id, label }) => (
          <TabsTrigger key={id} value={id} className="text-xs sm:text-sm">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>

      {CATEGORIES.map(({ id, label, description }) => (
        <TabsContent key={id} value={id} className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold">{label}</h2>
            <p className="text-gray-600">{description}</p>
          </div>
          <ItemsGrid category={id} period={period} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
```

### 4. Create app/components/digest/period-selector.tsx (50-70 lines)

```typescript
'use client';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export interface PeriodSelectorProps {
  value: 'week' | 'month' | 'all';
  onValueChange: (value: 'week' | 'month' | 'all') => void;
}

export function PeriodSelector({ value, onValueChange }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-4">
      <span className="font-medium text-gray-700">Time Period:</span>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onValueChange(v as 'week' | 'month' | 'all')}
      >
        <ToggleGroupItem value="week" aria-label="Weekly">
          Weekly (7 days)
        </ToggleGroupItem>
        <ToggleGroupItem value="month" aria-label="Monthly">
          Monthly (30 days)
        </ToggleGroupItem>
        <ToggleGroupItem value="all" aria-label="All-time">
          All-time (90 days)
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
```

### 5. Update app/page.tsx (150-180 lines)

```typescript
'use client';

import { useState } from 'react';
import { CategoryTabs } from '@/app/components/digest/category-tabs';
import { PeriodSelector } from '@/app/components/digest/period-selector';
import { Container } from '@/components/ui/container';

export default function Home() {
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('week');

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <Container className="py-12">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="text-5xl font-bold mb-2">
            📚 Code Intelligence Digest
          </h1>
          <p className="text-xl text-gray-600">
            Curated insights on code search, AI agents, and developer tools
          </p>
        </div>

        {/* Period Selector */}
        <div className="mb-8">
          <PeriodSelector value={period} onValueChange={setPeriod} />
        </div>

        {/* Category Tabs and Items */}
        <CategoryTabs period={period} />
      </Container>
    </main>
  );
}
```

## Key Implementation Details

### Client Components
- Use 'use client' directive for interactive features
- ItemsGrid fetches from `/api/items` when category/period changes
- Show skeleton loaders while fetching

### Styling
- Use shadcn/ui components (Tabs, Card, Badge, Button, etc.)
- Tailwind for responsive layout (grid, gap, line-clamp)
- Smooth transitions and hover effects

### Accessibility
- Proper ARIA labels
- Keyboard navigation for tabs
- Semantic HTML (links open in new tab)

### Performance
- Memoize components to avoid unnecessary re-renders
- Lazy load images if added later
- Cache API responses if needed

## Testing Strategy

### Component Tests
```bash
# Manual testing in browser
npm run dev
# Navigate to http://localhost:3000
# Test:
# - Click category tabs, verify items load
# - Switch time periods
# - Hover over items, check tooltips
# - Click item links (open in new tab)
```

### Visual Tests
- [ ] Desktop layout (1920px): 2-column grid
- [ ] Tablet layout (1024px): 2-column grid
- [ ] Mobile layout (375px): 1-column grid
- [ ] Dark mode (if using)
- [ ] Loading states
- [ ] Empty states

## Quality Gates

- [ ] TypeScript strict mode passes (npm run typecheck)
- [ ] ESLint passes (npm run lint)
- [ ] Components render without errors
- [ ] API integration works (items load)
- [ ] All tabs functional
- [ ] Period selector works
- [ ] Responsive design verified

## Expected Output

### Homepage (Weekly view)
- Title: "📚 Code Intelligence Digest"
- Period selector: [Weekly] [Monthly] [All-time]
- Category tabs: [Newsletters][Podcasts][Tech Articles][AI News][Product News][Community][Research]
- Default tab: Tech Articles
- Item cards in responsive grid
- Each card shows: title, source, date, tags, scores

### Item Card Layout
```
╔════════════════════════════════════╗
║ Java Annotated Monthly – Dec 2025  ║
║                              [↗]   ║
║ JetBrains Company Blog • 2d ago    ║
║ This month brings significant...   ║
║ [agent] [devex] [devops] [enter... ║
║ LLM: 10/10 relevance               ║
║ Final Score: 84%                   ║
║ ✓ Selected at rank 1               ║
╚════════════════════════════════════╝
```

## File Structure

```
app/
  page.tsx                    (main dashboard)
  api/
    items/
      route.ts               (existing)
  components/
    digest/
      item-card.tsx          (NEW)
      items-grid.tsx         (NEW)
      category-tabs.tsx      (NEW)
      period-selector.tsx    (NEW)
    layout/
      top-nav.tsx            (optional, for header nav)
```

## Dependencies

All from existing project setup:
- Next.js 16.0
- React 18
- Tailwind CSS
- shadcn/ui components
- TypeScript

## Success Criteria

✅ Components render without errors  
✅ API endpoint `/api/items` successfully consumed  
✅ Category tabs work (all 7 categories load)  
✅ Period selector works (week/month/all views)  
✅ Items display in responsive grid  
✅ TypeScript strict mode passes  
✅ ESLint passes  
✅ Responsive design verified (desktop/tablet/mobile)  

## Commands to Run

```bash
# Start work
bd update code-intel-digest-htm --status in_progress

# Dev server (for manual testing)
npm run dev
# Visit http://localhost:3000

# Quality gates during development
npm run typecheck
npm run lint

# Finish
bd close code-intel-digest-htm --reason "UI components implemented and tested"
```

## Notes

- Use existing app/layout.tsx and app/globals.css
- Install any new shadcn components with: `npx shadcn-ui@latest add <component>`
- Test API endpoint with: `npx tsx scripts/test-api-items.ts`
- Remember: No `npm run dev` in final submission, only manual testing

## After This Phase

Once UI components are complete:

1. **Phase 6**: Polish & refinement
   - Add animations/transitions
   - Implement dark mode
   - Archive/favorites features

2. **Phase 7**: Deployment & monitoring
   - Deploy to Vercel
   - Set up monitoring/logging
   - Email subscription feature (optional)

---

**Estimated completion**: 2-3 hours
**Complexity**: Medium (React component patterns, API integration)
**Blocker risks**: None (API is ready, test cases passed)
