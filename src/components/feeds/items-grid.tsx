"use client";

import { useEffect, useState, useRef } from "react";
import ItemCard from "./item-card";
import { DateRange } from "@/src/components/common/date-range-picker";
import { ProductFilterState } from "@/src/components/filters/product-filter";

interface RankedItemResponse {
  id: string;
  title: string;
  url: string;
  sourceTitle: string;
  publishedAt: string;
  createdAt?: string | null;
  summary?: string;
  contentSnippet?: string;
  categories?: string[];
  category?: string;
  bm25Score: number;
  llmScore: {
    relevance: number;
    usefulness: number;
    tags: string[];
  };
  recencyScore: number;
  finalScore: number;
  reasoning: string;
  diversityReason?: string;
  /** Product IDs mentioned in the content */
  productMentions?: string[];
}

/** Product info from API response */
export interface AvailableProduct {
  id: string;
  name: string;
  category: string;
}

interface ItemsGridProps {
  category: string;
  period: "day" | "week" | "month" | "all" | "custom";
  customDateRange?: DateRange | null;
  /** Product filter state */
  productFilter?: ProductFilterState;
  /** Callback when available products are loaded from API */
  onAvailableProductsChange?: (products: AvailableProduct[]) => void;
  /** Callback when a product badge is clicked (for quick filtering) */
  onProductClick?: (productId: string) => void;
}

export default function ItemsGrid({
  category,
  period,
  customDateRange,
  productFilter,
  onAvailableProductsChange,
  onProductClick,
}: ItemsGridProps) {
  const [items, setItems] = useState<RankedItemResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreCount, setLoadMoreCount] = useState(0); // Track how many times "Load More" was clicked
  const [hasMore, setHasMore] = useState(false);
  const itemsRef = useRef<RankedItemResponse[]>([]); // Ref to track current items for excludeIds

  // Reset loadMoreCount when filters change
  useEffect(() => {
    setLoadMoreCount(0);
    itemsRef.current = [];
  }, [category, period, customDateRange, productFilter]);

  useEffect(() => {
    const fetchItems = async () => {
      // Don't fetch if custom range is selected but not yet configured
      if (period === "custom" && !customDateRange) {
        setLoading(false);
        setItems([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          category,
          period,
          limit: "10", // Always fetch 10 more items
        });

        if (period === "custom" && customDateRange) {
          params.append("startDate", customDateRange.startDate);
          params.append("endDate", customDateRange.endDate);
        }

        // Add product filter params
        if (productFilter) {
          if (productFilter.selectedProducts.size > 0) {
            params.append(
              "products",
              Array.from(productFilter.selectedProducts).join(","),
            );
          }
          if (productFilter.excludedProducts.size > 0) {
            params.append(
              "excludeProducts",
              Array.from(productFilter.excludedProducts).join(","),
            );
          }
          if (productFilter.competitorsOnly) {
            params.append("competitorsOnly", "true");
          }
          if (productFilter.excludeOwn) {
            params.append("excludeOwn", "true");
          }
        }

        // If loading more, exclude already-loaded items
        if (loadMoreCount > 0 && itemsRef.current.length > 0) {
          const excludeIds = itemsRef.current.map((item) => item.id).join(",");
          params.append("excludeIds", excludeIds);
        }

        const response = await fetch(`/api/items?${params.toString()}`);

        if (!response.ok) {
          throw new Error("Failed to fetch items");
        }

        const data = await response.json();
        const fetchedItems = data.items || [];

        console.log(
          `[ItemsGrid] Fetched ${fetchedItems.length} items for ${category}/${period}`,
        );

        // If loading more (loadMoreCount > 0), append new items
        // Otherwise, replace items (initial load or category/period change)
        if (loadMoreCount > 0) {
          setItems((prev) => {
            // Deduplicate by ID to avoid duplicates
            const existingIds = new Set(
              prev.map((item: RankedItemResponse) => item.id),
            );
            const newItems = fetchedItems.filter(
              (item: RankedItemResponse) => !existingIds.has(item.id),
            );
            const updated = [...prev, ...newItems];
            itemsRef.current = updated; // Update ref
            return updated;
          });
        } else {
          setItems(fetchedItems);
          itemsRef.current = fetchedItems; // Update ref
        }

        // Use hasMore from API response
        setHasMore(data.hasMore === true);

        // Notify parent about available products for filter UI
        if (onAvailableProductsChange && data.productsMentioned) {
          onAvailableProductsChange(data.productsMentioned);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        setItems([]);
        itemsRef.current = []; // Reset ref on error
      } finally {
        setLoading(false);
      }
    };

    fetchItems();
  }, [
    category,
    period,
    customDateRange,
    loadMoreCount,
    productFilter,
    onAvailableProductsChange,
  ]);

  const handleLoadMore = () => {
    setLoadMoreCount((prev) => prev + 1);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted">Loading items...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4">
        <p className="text-red-900">Error: {error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted">
          No items found for this category and period.
        </p>
      </div>
    );
  }

  console.log(
    `[ItemsGrid] Rendering ${items.length} items for ${category}/${period}`,
  );

  return (
    <div className="space-y-3 w-full">
      {items.map((item, index) => {
        console.log(
          `[ItemsGrid] Rendering ItemCard ${index + 1}: ${item.id} - ${item.title.substring(0, 40)}...`,
        );
        return (
          <ItemCard
            key={item.id}
            item={item}
            rank={index + 1}
            period={period}
            onProductClick={onProductClick}
          />
        );
      })}
      {hasMore ? (
        <div className="text-center pt-4">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Loading..." : "Load 10 More"}
          </button>
        </div>
      ) : items.length > 0 ? (
        <div className="text-center pt-4">
          <p className="text-muted text-sm">
            No more items available that meet the relevance threshold.
          </p>
        </div>
      ) : null}
    </div>
  );
}
