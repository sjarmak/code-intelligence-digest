"use client";

import { useEffect, useState } from "react";
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
  productMentions?: string[];
  rank?: number;
}

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalCount: number;
  offset: number;
  hasMore: boolean;
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
  productFilter?: ProductFilterState;
  /** Research only: "indexed" = when synced from ADS; "published" = paper publication date */
  researchDateFilter?: "indexed" | "published";
  onAvailableProductsChange?: (products: AvailableProduct[]) => void;
  onProductClick?: (productId: string) => void;
}

const PAGE_SIZE = 10;

export default function ItemsGrid({
  category,
  period,
  customDateRange,
  productFilter,
  researchDateFilter,
  onAvailableProductsChange,
  onProductClick,
}: ItemsGridProps) {
  const [items, setItems] = useState<RankedItemResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [category, period, customDateRange, productFilter, researchDateFilter]);

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
        const offset = (currentPage - 1) * PAGE_SIZE;
        const params = new URLSearchParams({
          category,
          period,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });

        if (period === "custom" && customDateRange) {
          params.append("startDate", customDateRange.startDate);
          params.append("endDate", customDateRange.endDate);
        }

        // Research only: date filter (indexed vs published)
        if (category === "research" && researchDateFilter) {
          params.append("researchDateFilter", researchDateFilter);
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

        const response = await fetch(`/api/items?${params.toString()}`, {
          credentials: "include",
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const msg =
            (data?.message as string) ||
            (data?.error as string) ||
            "Failed to fetch items";
          throw new Error(msg);
        }
        const fetchedItems = data.items || [];

        setItems(fetchedItems);
        setPagination(data.pagination || null);

        // Notify parent about available products for filter UI
        if (onAvailableProductsChange && data.productsMentioned) {
          onAvailableProductsChange(data.productsMentioned);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        setItems([]);
        setPagination(null);
      } finally {
        setLoading(false);
      }
    };

    fetchItems();
  }, [
    category,
    period,
    customDateRange,
    currentPage,
    productFilter,
    researchDateFilter,
    onAvailableProductsChange,
  ]);

  const goToPage = (page: number) => {
    if (page >= 1 && (!pagination || page <= pagination.totalPages)) {
      setCurrentPage(page);
      // Scroll to top of the list
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
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

  // Calculate display range
  const startItem = pagination ? pagination.offset + 1 : 1;
  const endItem = pagination ? pagination.offset + items.length : items.length;
  const totalCount = pagination?.totalCount || items.length;

  return (
    <div className="space-y-3 w-full">
      {/* Items list */}
      {items.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          rank={item.rank || 0}
          period={period}
          onProductClick={onProductClick}
        />
      ))}

      {/* Pagination controls */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-gray-200">
          {/* Page info */}
          <p className="text-sm text-muted">
            Showing {startItem}-{endItem} of {totalCount} items
          </p>

          {/* Page navigation */}
          <div className="flex items-center gap-2">
            {/* Previous button */}
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-3 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous page"
            >
              Previous
            </button>

            {/* Page numbers */}
            <div className="flex items-center gap-1">
              {generatePageNumbers(currentPage, pagination.totalPages).map(
                (page, index) =>
                  page === "..." ? (
                    <span
                      key={`ellipsis-${index}`}
                      className="px-2 py-1 text-muted"
                    >
                      ...
                    </span>
                  ) : (
                    <button
                      key={page}
                      onClick={() => goToPage(page as number)}
                      className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        currentPage === page
                          ? "bg-black text-white"
                          : "border border-gray-300 bg-white hover:bg-gray-50"
                      }`}
                      aria-label={`Page ${page}`}
                      aria-current={currentPage === page ? "page" : undefined}
                    >
                      {page}
                    </button>
                  ),
              )}
            </div>

            {/* Next button */}
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === pagination.totalPages}
              className="px-3 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Next page"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* No more items message */}
      {pagination && pagination.totalPages <= 1 && items.length > 0 && (
        <div className="text-center pt-4">
          <p className="text-muted text-sm">
            {totalCount === items.length
              ? "All items shown."
              : "No more items available that meet the relevance threshold."}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Generate page numbers to display with ellipsis for large page counts
 * Shows: first page, last page, current page, and 1-2 pages around current
 */
function generatePageNumbers(
  currentPage: number,
  totalPages: number,
): (number | "...")[] {
  if (totalPages <= 7) {
    // Show all pages if 7 or fewer
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: (number | "...")[] = [];

  // Always show first page
  pages.push(1);

  if (currentPage > 3) {
    pages.push("...");
  }

  // Pages around current
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  for (let i = start; i <= end; i++) {
    if (!pages.includes(i)) {
      pages.push(i);
    }
  }

  if (currentPage < totalPages - 2) {
    pages.push("...");
  }

  // Always show last page
  if (!pages.includes(totalPages)) {
    pages.push(totalPages);
  }

  return pages;
}
