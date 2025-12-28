'use client';

import { useEffect, useState } from 'react';
import ItemCard from './item-card';

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
}

import { DateRange } from '@/src/components/common/date-range-picker';

interface ItemsGridProps {
  category: string;
  period: 'day' | 'week' | 'month' | 'all' | 'custom';
  customDateRange?: DateRange | null;
}

export default function ItemsGrid({ category, period, customDateRange }: ItemsGridProps) {
  const [items, setItems] = useState<RankedItemResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(10); // Start with 10 items
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const fetchItems = async () => {
      // Don't fetch if custom range is selected but not yet configured
      if (period === 'custom' && !customDateRange) {
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
          limit: limit.toString(),
        });

        if (period === 'custom' && customDateRange) {
          params.append('startDate', customDateRange.startDate);
          params.append('endDate', customDateRange.endDate);
        }

        const response = await fetch(`/api/items?${params.toString()}`);

        if (!response.ok) {
          throw new Error('Failed to fetch items');
        }

        const data = await response.json();
        const fetchedItems = data.items || [];
        // If limit > 10, we're loading more - append to existing items
        // Otherwise, replace items (initial load or category/period change)
        if (limit > 10) {
          setItems(prev => {
            // Deduplicate by ID to avoid duplicates
            const existingIds = new Set(prev.map(item => item.id));
            const newItems = fetchedItems.filter(item => !existingIds.has(item.id));
            return [...prev, ...newItems];
          });
        } else {
          setItems(fetchedItems);
        }
        // Use hasMore from API response, or check if we got exactly the limit
        setHasMore(data.hasMore !== undefined ? data.hasMore : fetchedItems.length === limit);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        setItems([]);
      } finally {
        setLoading(false);
      }
    };

    // Reset limit when category or period changes
    setLimit(10);
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, period, customDateRange, limit]);

  const handleLoadMore = () => {
    setLimit(prev => prev + 10);
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
        <p className="text-muted">No items found for this category and period.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 w-full">
      {items.map((item, index) => (
        <ItemCard key={item.id} item={item} rank={index + 1} period={period} />
      ))}
      {hasMore && (
        <div className="text-center pt-4">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Loading...' : 'Load 10 More'}
          </button>
        </div>
      )}
    </div>
  );
}
