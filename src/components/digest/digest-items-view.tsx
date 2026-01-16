'use client';

import { useEffect, useState, useCallback } from 'react';
import ItemCard from '@/src/components/feeds/item-card';
import { FileHeart, RefreshCw } from 'lucide-react';

interface DigestItem {
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
  llmScore: {
    relevance: number;
    usefulness: number;
    tags: string[];
  };
  finalScore: number;
  reasoning: string;
  diversityReason?: string;
}

export function DigestItemsView() {
  const [items, setItems] = useState<DigestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Add cache-busting timestamp to ensure fresh data
      const response = await fetch(`/api/digest-items?t=${Date.now()}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch digest items');
      }

      const data = await response.json();
      const fetchedItems = data.items || [];

      // Transform items to match ItemCard format
      const transformedItems: DigestItem[] = fetchedItems.map((item: any) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        sourceTitle: item.sourceTitle,
        publishedAt: item.publishedAt,
        createdAt: item.createdAt,
        summary: item.summary,
        contentSnippet: item.contentSnippet,
        categories: item.categories,
        category: item.category,
        llmScore: {
          relevance: 0,
          usefulness: 0,
          tags: [],
        },
        finalScore: 0,
        reasoning: '',
      }));

      setItems(transformedItems);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Listen for custom events when items are added/removed
  useEffect(() => {
    const handleDigestItemsChange = () => {
      fetchItems();
    };

    // Listen for custom events
    window.addEventListener('digest-items-changed', handleDigestItemsChange);
    window.addEventListener('saved-items-changed', handleDigestItemsChange);

    // Also refresh when page becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchItems();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Also refresh on window focus as a fallback
    const handleFocus = () => {
      fetchItems();
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('digest-items-changed', handleDigestItemsChange);
      window.removeEventListener('saved-items-changed', handleDigestItemsChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchItems]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchItems();
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted">Loading digest items...</p>
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
        <FileHeart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-muted">No items in digest library yet.</p>
        <p className="text-sm text-muted mt-2">
          Add items to your digest library from the Resources or Search views.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 w-full">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-black">
            Digest Items ({items.length})
          </h3>
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors bg-white border border-gray-300 text-black hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
            title="Refresh digest items"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <p className="text-sm text-muted">
          Items in your digest library will be used when generating newsletters or podcasts in Auto mode.
        </p>
      </div>
      {items.map((item, index) => (
        <ItemCard key={item.id} item={item} rank={index + 1} />
      ))}
    </div>
  );
}
