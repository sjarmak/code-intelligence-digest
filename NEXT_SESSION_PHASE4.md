# Next Session: Phase 4 - Diversity Selection

**Date**: December 7, 2025  
**Bead**: code-intel-digest-8hc  
**Estimated Time**: 1.5-2 hours  
**Difficulty**: Medium

## Overview

The ranking pipeline is complete (Phase 3). Now implement per-source diversity caps to ensure the digest doesn't over-represent single sources. This is the final step before UI/digest rendering.

## Goal

Implement a greedy selection algorithm that:
1. Takes ranked items per category
2. Enforces per-source caps (max 2-3 items per source per category)
3. Returns final digest items in ranked order
4. Records which items made the final digest

## Architecture

```
Ranked Items (from /api/items)
       ↓
┌──────────────────────┐
│ Diversity Selection  │
│ - Track per source   │
│ - Enforce caps       │
│ - Greedy selection   │
└─────────┬────────────┘
          ↓
Final Digest Items
(ready for UI rendering)
```

## Implementation Plan

### 1. Create src/lib/pipeline/select.ts (80-100 lines)

```typescript
import { RankedItem, Category } from "../model";
import { getCategoryConfig } from "../../config/categories";
import { logger } from "../logger";

interface SelectionResult {
  selectedItems: RankedItem[];
  reason: string;
}

export function selectDiverseItems(
  rankedItems: RankedItem[],
  category: Category,
  period: "week" | "month" | "all"
): SelectionResult[] {
  // Determine per-source cap based on period
  const CAP_BY_PERIOD = {
    week: 2,
    month: 3,
    all: 4,
  };
  
  const config = getCategoryConfig(category);
  const maxItems = config.maxItems;
  const perSourceCap = CAP_BY_PERIOD[period];
  
  // Track items per source
  const sourceCount = new Map<string, number>();
  const selected: RankedItem[] = [];
  const reasons: string[] = [];
  
  for (const item of rankedItems) {
    const source = item.sourceTitle;
    const currentCount = sourceCount.get(source) || 0;
    
    if (currentCount >= perSourceCap) {
      // Skip - source cap exceeded
      reasons.push(`${item.title}: Source cap (${source} has ${currentCount}/${perSourceCap})`);
      continue;
    }
    
    if (selected.length >= maxItems) {
      // Reached category max
      break;
    }
    
    // Accept item
    selected.push(item);
    sourceCount.set(source, currentCount + 1);
    reasons.push(`${item.title}: Selected (rank ${selected.length})`);
  }
  
  logger.info(
    `Selected ${selected.length}/${rankedItems.length} items for ${category} (${period})`
  );
  
  return selected;
}
```

### 2. Update app/api/items/route.ts (add selection)

Add to GET handler after ranking:

```typescript
// Apply diversity selection
const selectedItems = selectDiverseItems(rankedItems, category, period as "week" | "month" | "all");
```

### 3. Create scripts/test-diversity.ts (60-80 lines)

```typescript
import { loadItemsByCategory } from "../src/lib/db/items";
import { rankCategory } from "../src/lib/pipeline/rank";
import { selectDiverseItems } from "../src/lib/pipeline/select";
import { Category } from "../src/lib/model";
import { logger } from "../src/lib/logger";

async function testDiversity() {
  logger.info("Testing diversity selection...");
  
  const category: Category = "tech_articles";
  const period = "week" as const;
  
  // Load and rank
  const items = await loadItemsByCategory(category, 7);
  const rankedItems = await rankCategory(items, category, 7);
  
  // Apply diversity selection
  const selectedItems = selectDiverseItems(rankedItems, category, period);
  
  // Analyze source distribution
  const sourceCount = new Map<string, number>();
  for (const item of selectedItems) {
    const count = sourceCount.get(item.sourceTitle) || 0;
    sourceCount.set(item.sourceTitle, count + 1);
  }
  
  console.log(`\nSelected ${selectedItems.length} items from ${rankedItems.length} ranked`);
  console.log("\nSource distribution:");
  
  const sorted = Array.from(sourceCount.entries())
    .sort((a, b) => b[1] - a[1]);
  
  for (const [source, count] of sorted) {
    console.log(`  ${source}: ${count} items`);
  }
  
  // Verify caps enforced
  const maxCount = Math.max(...Array.from(sourceCount.values()));
  console.log(`\nMax items per source: ${maxCount} (cap: 2)`);
  
  if (maxCount <= 2) {
    console.log("✅ Per-source cap enforced");
  } else {
    console.log("❌ Per-source cap exceeded");
  }
}

testDiversity();
```

## Key Implementation Details

### Per-Source Caps

- Weekly digest: max 2 items per source per category
- Monthly digest: max 3 items per source per category
- All-time: max 4 items per source per category

### Greedy Algorithm

1. Start with ranked items (sorted by finalScore)
2. For each item:
   - Check if source is at cap
   - If at cap, skip to next item
   - If not at cap, add to selected
   - Stop when category maxItems reached

### Benefits

- Prevents newsletter domination (e.g., "Pointer" newsletter)
- Ensures diversity of perspectives
- Keeps top-ranked items if possible
- Transparent filtering (can explain why items excluded)

## Testing Strategy

### Unit Test

```bash
npx tsx scripts/test-diversity.ts
```

Expected output:
```
Selected 6 items from 281 ranked
Source distribution:
  JetBrains Company Blog: 2 items
  AINews with Smol.ai: 2 items
  Pragmatic Engineer: 1 item
  ... (other sources with 1 item each)

Max items per source: 2 (cap: 2)
✅ Per-source cap enforced
```

### Integration Test

Update test-api-items.ts to include diversity filtering and verify response.

## Database Integration

After diversity selection, optionally store to `digest_selections` table:

```sql
INSERT INTO digest_selections 
(id, item_id, category, period, rank, diversity_reason, selected_at)
VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
```

## Quality Gates

- [ ] src/lib/pipeline/select.ts created and correct types
- [ ] app/api/items/route.ts updated with selection
- [ ] scripts/test-diversity.ts validates per-source caps
- [ ] Per-source caps never exceeded (automated check)
- [ ] Top items still selected when below cap
- [ ] Category maxItems respected
- [ ] npm run typecheck passes
- [ ] npm run lint passes

## Expected Results

**Before Diversity Selection** (tech_articles, weekly):
- 281 ranked items
- Top source has 8+ items
- Heavy concentration in few sources

**After Diversity Selection**:
- 6 final items (maxItems config for tech_articles)
- No source has >2 items
- Balanced across sources
- Top items still mostly included
- Clear reason for each selection

## Related Files

- `src/config/categories.ts` - maxItems per category
- `src/lib/model.ts` - RankedItem type
- `app/api/items/route.ts` - API endpoint
- `scripts/test-ranking.ts` - Existing ranking test

## Success Criteria

✅ Per-source cap never exceeded  
✅ Category maxItems respected  
✅ Greedy selection algorithm works  
✅ API endpoint returns selected items only  
✅ Tests pass: diversity validation  
✅ All linting/typing checks pass  

## After This Phase

Once diversity selection is complete, you're ready for:
1. **Phase 5**: UI components (ItemCard, CategoryTabs, etc.)
2. **Phase 6**: Digest rendering (weekly/monthly views)
3. **Phase 7**: Polish & edge cases (caching, performance, etc.)

## Commands to Run

```bash
# Start work
bd update code-intel-digest-8hc --status in_progress

# Test after implementation
npx tsx scripts/test-diversity.ts

# Verify API includes selection
npx tsx scripts/test-api-items.ts

# Quality gates
npm run typecheck
npm run lint

# Finish
bd close code-intel-digest-8hc --reason "Diversity selection with per-source caps implemented"
```
