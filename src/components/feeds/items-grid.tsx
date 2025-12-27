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
        setItems(data.items || []);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        setItems([]);
      } finally {
        setLoading(false);
      }
    };

    fetchItems();
  }, [category, period, customDateRange]);

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
    </div>
  );
}
