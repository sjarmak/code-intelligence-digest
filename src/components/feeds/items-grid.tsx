'use client';

import { useEffect, useState } from 'react';
import ItemCard from './item-card';

interface RankedItemResponse {
  id: string;
  title: string;
  url: string;
  sourceTitle: string;
  publishedAt: string;
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

interface ItemsGridProps {
  category: string;
  period: 'day' | 'week' | 'month' | 'all';
}

export default function ItemsGrid({ category, period }: ItemsGridProps) {
  const [items, setItems] = useState<RankedItemResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchItems = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/items?category=${category}&period=${period}`
        );

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
  }, [category, period]);

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
    <div className="space-y-3 max-w-4xl">
      {items.map((item, index) => (
        <ItemCard key={item.id} item={item} rank={index + 1} />
      ))}
    </div>
  );
}
