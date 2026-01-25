# Product Filtering UI Implementation Plan

## Overview

Add product filtering capabilities to the Code Intelligence Digest UI, allowing users to:
1. Filter items by specific products mentioned (e.g., Cursor, Copilot, Claude Code)
2. Toggle "Competitors only" to focus on competitor product mentions
3. Toggle "Exclude Sourcegraph" to hide own-product references
4. View product mention badges on item cards

## Current State

### Backend (Already Implemented)
- `src/config/products.ts`: 45+ products across 7 categories with `findProductMentions()`, `getCompetitorProducts()`, etc.
- `app/api/items/route.ts`: Supports 4 query params: `products`, `excludeProducts`, `competitorsOnly`, `excludeOwn`
- `src/lib/model.ts`: `RankedItem.productMentions?: string[]` field
- API response includes `productsMentioned` array with `{id, name, category}` for filter UI

### Frontend (Needs Implementation)
- `items-grid.tsx`: Fetches items but doesn't pass product filter params
- `item-card.tsx`: Interface missing `productMentions` field, no product badges displayed
- `app/page.tsx`: Has category/period filters but no product filters

---

## Implementation Plan

### Phase 1: Create ProductFilter Component

**File**: `src/components/filters/product-filter.tsx`

Create a reusable product filter component with:

```typescript
interface ProductFilterState {
  selectedProducts: Set<string>;     // Filter TO these products
  excludedProducts: Set<string>;     // Filter OUT these products  
  competitorsOnly: boolean;          // Only show items with competitor mentions
  excludeOwn: boolean;               // Exclude Sourcegraph/Cody mentions
}

interface ProductFilterProps {
  value: ProductFilterState;
  onChange: (state: ProductFilterState) => void;
  availableProducts?: Array<{id: string; name: string; category: string}>;
  disabled?: boolean;
}
```

**Features**:
- Collapsible filter panel (collapsed by default)
- Multi-select dropdown for "Include products" 
- Multi-select dropdown for "Exclude products"
- Toggle switches for "Competitors only" and "Exclude Sourcegraph"
- "Clear filters" button
- Badge showing active filter count

**UI Design** (following existing patterns):
- Desktop: Inline with period filters, collapsible panel
- Mobile: Full-width dropdown in mobile filter section
- Styling: Black/white theme, `border-surface-border`, `bg-surface`

---

### Phase 2: Create ProductBadge Component

**File**: `src/components/common/product-badge.tsx`

Display product mentions on item cards:

```typescript
interface ProductBadgeProps {
  productId: string;
  productName: string;
  category: string;
  isCompetitor?: boolean;
  isOwnProduct?: boolean;
  onClick?: (productId: string) => void; // Optional: click to filter
}
```

**Styling**:
- Competitor products: `bg-blue-50 text-blue-700 border-blue-200`
- Own products: `bg-purple-50 text-purple-700 border-purple-200`
- Other (frameworks, etc.): `bg-gray-100 text-gray-700 border-gray-300`
- Small text (`text-xs`), rounded, inline-block
- Optional hover state to filter by product

---

### Phase 3: Update ItemCard Component

**File**: `src/components/feeds/item-card.tsx`

1. **Update interface** to include `productMentions`:
```typescript
interface ItemCardProps {
  item: {
    // ... existing fields ...
    productMentions?: string[]; // Add this
  };
  rank?: number;
  period?: 'day' | 'week' | 'month' | 'all' | 'custom';
  onProductClick?: (productId: string) => void; // Optional filter callback
}
```

2. **Add product badges section** below tags:
```tsx
{/* Product mentions */}
{item.productMentions && item.productMentions.length > 0 && (
  <div className="flex flex-wrap gap-1 mt-1">
    {item.productMentions.slice(0, 3).map((productId) => (
      <ProductBadge
        key={productId}
        productId={productId}
        productName={getProductName(productId)}
        category={getProductCategory(productId)}
        onClick={onProductClick}
      />
    ))}
    {item.productMentions.length > 3 && (
      <span className="text-xs text-muted">+{item.productMentions.length - 3}</span>
    )}
  </div>
)}
```

---

### Phase 4: Update ItemsGrid Component

**File**: `src/components/feeds/items-grid.tsx`

1. **Update interface** to accept product filter props:
```typescript
interface ItemsGridProps {
  category: string;
  period: 'day' | 'week' | 'month' | 'all' | 'custom';
  customDateRange?: DateRange | null;
  // New product filter props:
  productFilter?: ProductFilterState;
  onAvailableProductsChange?: (products: Array<{id: string; name: string; category: string}>) => void;
}
```

2. **Update fetch logic** to include product params:
```typescript
// Build query params
const params = new URLSearchParams({
  category,
  period,
  limit: '10',
});

// Add product filter params
if (productFilter) {
  if (productFilter.selectedProducts.size > 0) {
    params.append('products', Array.from(productFilter.selectedProducts).join(','));
  }
  if (productFilter.excludedProducts.size > 0) {
    params.append('excludeProducts', Array.from(productFilter.excludedProducts).join(','));
  }
  if (productFilter.competitorsOnly) {
    params.append('competitorsOnly', 'true');
  }
  if (productFilter.excludeOwn) {
    params.append('excludeOwn', 'true');
  }
}
```

3. **Update RankedItemResponse interface** to include productMentions:
```typescript
interface RankedItemResponse {
  // ... existing fields ...
  productMentions?: string[];
}
```

4. **Pass productMentions to ItemCard**:
```tsx
<ItemCard 
  key={item.id} 
  item={item} 
  rank={index + 1} 
  period={period}
  onProductClick={handleProductFilter} // Optional quick filter
/>
```

5. **Expose available products** from API response:
```typescript
// In fetch handler, after receiving response:
if (data.productsMentioned && onAvailableProductsChange) {
  onAvailableProductsChange(data.productsMentioned);
}
```

---

### Phase 5: Update Main Page

**File**: `app/page.tsx`

1. **Add product filter state**:
```typescript
const [productFilter, setProductFilter] = useState<ProductFilterState>({
  selectedProducts: new Set(),
  excludedProducts: new Set(),
  competitorsOnly: false,
  excludeOwn: false,
});
const [availableProducts, setAvailableProducts] = useState<Array<{id: string; name: string; category: string}>>([]);
```

2. **Add ProductFilter component** to filter section:
```tsx
{/* Desktop: After period buttons */}
<div className="hidden md:block bg-surface sticky top-[169px] z-10 py-4 w-full">
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div className="flex flex-wrap gap-2 items-center">
      {/* Period buttons */}
      {periods.map((p) => (/* existing code */))}
      
      {/* Product filter */}
      <div className="ml-auto">
        <ProductFilter
          value={productFilter}
          onChange={setProductFilter}
          availableProducts={availableProducts}
        />
      </div>
    </div>
  </div>
</div>

{/* Mobile: Add to mobile filter section */}
```

3. **Pass filter state to ItemsGrid**:
```tsx
<ItemsGrid 
  category={activeCategory} 
  period={period}
  customDateRange={customDateRange}
  productFilter={productFilter}
  onAvailableProductsChange={setAvailableProducts}
/>
```

4. **Reset product filter when category changes** (optional):
```typescript
useEffect(() => {
  // Reset product filter when switching categories
  setProductFilter({
    selectedProducts: new Set(),
    excludedProducts: new Set(),
    competitorsOnly: false,
    excludeOwn: false,
  });
}, [activeCategory]);
```

---

### Phase 6: Create Product Lookup Hook

**File**: `src/hooks/useProducts.ts`

Create a hook to access product data client-side:

```typescript
import { PRODUCTS, getProductById, getCompetitorProducts, getOwnProducts } from '@/src/config/products';

export function useProducts() {
  const getProductName = (id: string): string => {
    return getProductById(id)?.name || id;
  };

  const getProductCategory = (id: string): string => {
    return getProductById(id)?.category || 'unknown';
  };

  const isCompetitor = (id: string): boolean => {
    return getProductById(id)?.isCompetitor === true;
  };

  const isOwnProduct = (id: string): boolean => {
    return getProductById(id)?.isOwnProduct === true;
  };

  return {
    products: PRODUCTS,
    competitors: getCompetitorProducts(),
    ownProducts: getOwnProducts(),
    getProductName,
    getProductCategory,
    isCompetitor,
    isOwnProduct,
  };
}
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/components/filters/product-filter.tsx` | Create | Product filter component with multi-select, toggles |
| `src/components/common/product-badge.tsx` | Create | Product mention badge component |
| `src/hooks/useProducts.ts` | Create | Hook for product data access |
| `src/components/feeds/item-card.tsx` | Modify | Add productMentions to interface, display badges |
| `src/components/feeds/items-grid.tsx` | Modify | Add product filter props, update fetch logic |
| `app/page.tsx` | Modify | Add product filter state and component |

---

## UI Mockups

### Desktop Filter Panel (Collapsed)
```
[Daily] [Weekly] [Monthly] [All-time] [Custom Range]    [Filter by Product v] (1 active)
```

### Desktop Filter Panel (Expanded)
```
[Daily] [Weekly] [Monthly] [All-time] [Custom Range]    [Filter by Product ^]
                                                        
+--------------------------------------------------+
| Include products:  [Select products...]          |
| Exclude products:  [Select products...]          |
|                                                  |
| [ ] Competitors only  [ ] Exclude Sourcegraph   |
|                                                  |
| [Clear filters]                                  |
+--------------------------------------------------+
```

### Item Card with Product Badges
```
+----------------------------------------------------------+
| 1  0.85  How Cursor is Changing Code Editing             |
|          TechCrunch • AI News, Coding • 2 days ago       |
|          [Cursor] [Copilot] [Windsurf]                   |
+----------------------------------------------------------+
```

### Mobile Filter Section
```
+------------------+ +------------------+
| Newsletters    v | | Weekly         v |
+------------------+ +------------------+
+--------------------------------------+
| Product Filters (1 active)         v |
+--------------------------------------+
```

---

## Testing Checklist

- [ ] Product filter dropdown opens/closes correctly
- [ ] Multi-select adds/removes products from filter
- [ ] "Competitors only" toggle works
- [ ] "Exclude Sourcegraph" toggle works
- [ ] Filter state persists during session
- [ ] Filter resets when category changes
- [ ] Product badges display correctly on items
- [ ] Click-to-filter on badges works (optional)
- [ ] Mobile responsive design works
- [ ] "Load More" pagination works with filters
- [ ] Empty state shows when no items match filters
- [ ] Available products updates based on category

---

## Implementation Order

1. **Phase 6**: Create `useProducts` hook (enables other phases)
2. **Phase 2**: Create `ProductBadge` component (simple, isolated)
3. **Phase 1**: Create `ProductFilter` component (core functionality)
4. **Phase 3**: Update `ItemCard` (display badges)
5. **Phase 4**: Update `ItemsGrid` (wire up API calls)
6. **Phase 5**: Update `app/page.tsx` (integrate everything)

---

## Notes

- Product data is static (defined in `src/config/products.ts`), so no API needed for product list
- Available products from API response helps show only relevant options
- Consider URL persistence for filters (future enhancement)
- Consider localStorage for filter preferences (future enhancement)
