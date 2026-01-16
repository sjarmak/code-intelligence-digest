'use client';

import { useEffect, useState, useCallback } from 'react';
import ItemCard from '@/src/components/feeds/item-card';
import { FolderHeart, RefreshCw } from 'lucide-react';

interface SavedItemsViewProps {
  selectedItemIds?: Set<string>;
  onSelectionChange?: (selectedIds: Set<string>) => void;
  showCheckboxes?: boolean;
}

export function SavedItemsView({ selectedItemIds: externalSelectedIds, onSelectionChange, showCheckboxes = false }: SavedItemsViewProps = {}) {

interface SavedItem {
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

  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(externalSelectedIds || new Set());

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Add cache-busting timestamp to ensure fresh data
      const response = await fetch(`/api/saved-items?t=${Date.now()}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch saved items');
      }

      const data = await response.json();
      const fetchedItems = data.items || [];

      // Transform items to match ItemCard format
      const transformedItems: SavedItem[] = fetchedItems.map((item: any) => ({
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
    const handleSavedItemsChange = () => {
      fetchItems();
    };

    // Listen for custom events
    window.addEventListener('saved-items-changed', handleSavedItemsChange);
    window.addEventListener('digest-items-changed', handleSavedItemsChange);

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
      window.removeEventListener('saved-items-changed', handleSavedItemsChange);
      window.removeEventListener('digest-items-changed', handleSavedItemsChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchItems]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchItems();
  };

  // Sync with external selectedItemIds if provided
  useEffect(() => {
    if (externalSelectedIds) {
      setInternalSelectedIds(externalSelectedIds);
    }
  }, [externalSelectedIds]);

  const handleToggleSelection = (itemId: string) => {
    const newSelection = new Set(internalSelectedIds);
    if (newSelection.has(itemId)) {
      newSelection.delete(itemId);
    } else {
      newSelection.add(itemId);
    }
    setInternalSelectedIds(newSelection);
    onSelectionChange?.(newSelection);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted">Loading saved items...</p>
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
        <FolderHeart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-muted">No items in saved items library yet.</p>
        <p className="text-sm text-muted mt-2">
          Add items to your saved items library from the Resources or Search views.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 w-full">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-black">
            Saved Items ({items.length})
          </h3>
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors bg-white border border-gray-300 text-black hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
            title="Refresh saved items"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        <p className="text-sm text-muted">
          {showCheckboxes 
            ? `Select items from your saved items library (${internalSelectedIds.size} selected).`
            : 'Your saved items library. Select items from here when generating newsletters or podcasts in Manual mode.'}
        </p>
      </div>
      {items.map((item, index) => (
        <div key={item.id} className="flex items-start gap-3">
          {showCheckboxes && (
            <input
              type="checkbox"
              checked={internalSelectedIds.has(item.id)}
              onChange={() => handleToggleSelection(item.id)}
              className="mt-4 rounded border-surface-border accent-black focus:ring-black bg-surface"
            />
          )}
          <div className="flex-1">
            <ItemCard item={item} rank={showCheckboxes ? undefined : index + 1} />
          </div>
        </div>
      ))}
    </div>
  );
}
