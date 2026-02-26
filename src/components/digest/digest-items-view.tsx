'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import ItemCard from '@/src/components/feeds/item-card';
import { FileHeart, RefreshCw, CheckSquare, Square, Trash2, X } from 'lucide-react';

interface DigestScores {
  relevance: number;
  usefulness: number;
  tags: string[];
}

interface DigestApiItem {
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
}

interface DigestItem extends DigestApiItem {
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
  llmScore: DigestScores;
  finalScore: number;
  reasoning: string;
  diversityReason?: string;
}

export function DigestItemsView() {
  const { status, data: session } = useSession();
  const lastUserId = useRef<string | null>(null);
  const [items, setItems] = useState<DigestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

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
      const fetchedItems: DigestApiItem[] = data.items || [];

      // Transform items to match ItemCard format
      const transformedItems: DigestItem[] = fetchedItems.map((item) => ({
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

  // Fetch on load and refetch when session/user changes (e.g. after login or account switch) so we show the correct user's items
  useEffect(() => {
    if (status === 'loading') return;
    const userId = session?.user?.id ?? null;
    if (userId !== lastUserId.current) {
      lastUserId.current = userId;
    }
    fetchItems();
  }, [status, session?.user?.id, fetchItems]);

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

  const handleToggleSelectMode = () => {
    setSelectMode(!selectMode);
    if (selectMode) {
      setSelectedIds(new Set());
    }
  };

  const handleToggleSelection = (itemId: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(itemId)) {
      newSelection.delete(itemId);
    } else {
      newSelection.add(itemId);
    }
    setSelectedIds(newSelection);
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(items.map(item => item.id)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;

    if (!confirm(`Are you sure you want to delete ${selectedIds.size} item(s) from the digest library?`)) {
      return;
    }

    setDeleting(true);
    try {
      const itemIdsArray = Array.from(selectedIds);
      const response = await fetch('/api/digest-items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: itemIdsArray }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete items');
      }

      // Refresh items and clear selection
      setSelectedIds(new Set());
      await fetchItems();

      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent('digest-items-changed'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete items';
      setError(message);
    } finally {
      setDeleting(false);
    }
  };

  const handleRemoveAll = async () => {
    if (!confirm(`Are you sure you want to remove ALL ${items.length} items from the digest library? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch('/api/digest-items?all=true', {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to remove all items');
      }

      // Refresh items and clear selection
      setSelectedIds(new Set());
      setSelectMode(false);
      await fetchItems();

      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent('digest-items-changed'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove all items';
      setError(message);
    } finally {
      setDeleting(false);
    }
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
          <div className="flex items-center gap-2">
            {selectMode && (
              <>
                <button
                  onClick={selectedIds.size === items.length ? handleDeselectAll : handleSelectAll}
                  disabled={items.length === 0 || deleting}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-white border border-gray-300 text-black hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                  title={selectedIds.size === items.length ? 'Deselect all' : 'Select all'}
                >
                  {selectedIds.size === items.length ? (
                    <>
                      <CheckSquare className="w-3.5 h-3.5" />
                      Deselect All
                    </>
                  ) : (
                    <>
                      <Square className="w-3.5 h-3.5" />
                      Select All
                    </>
                  )}
                </button>
                {selectedIds.size > 0 && (
                  <button
                    onClick={handleDeleteSelected}
                    disabled={deleting}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-red-50 border border-red-300 text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                    title={`Delete ${selectedIds.size} selected item(s)`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Selected ({selectedIds.size})
                  </button>
                )}
                <button
                  onClick={handleRemoveAll}
                  disabled={items.length === 0 || deleting}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-red-50 border border-red-300 text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                  title="Remove all items"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove All
                </button>
              </>
            )}
            <button
              onClick={handleToggleSelectMode}
              disabled={items.length === 0 || deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors bg-white border border-gray-300 text-black hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
              title={selectMode ? 'Exit select mode' : 'Enter select mode'}
            >
              {selectMode ? (
                <>
                  <X className="w-4 h-4" />
                  Cancel
                </>
              ) : (
                <>
                  <CheckSquare className="w-4 h-4" />
                  Select
                </>
              )}
            </button>
            {!selectMode && items.length > 0 && (
              <button
                onClick={handleRemoveAll}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors bg-red-50 border border-red-300 text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                title="Clear all items from digest library"
              >
                <Trash2 className="w-4 h-4" />
                Clear All
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading || deleting}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors bg-white border border-gray-300 text-black hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
              title="Refresh digest items"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
        <p className="text-sm text-muted">
          {selectMode
            ? `Select items to delete. ${selectedIds.size} of ${items.length} selected.`
            : 'Items in your digest library will be used when generating newsletters or podcasts in Auto mode.'}
        </p>
      </div>
      {items.map((item, index) => (
        <div key={item.id} className="flex items-start gap-3">
          {selectMode && (
            <input
              type="checkbox"
              checked={selectedIds.has(item.id)}
              onChange={() => handleToggleSelection(item.id)}
              disabled={deleting}
              className="mt-4 rounded border-surface-border accent-black focus:ring-black bg-surface"
            />
          )}
          <div className="flex-1">
            <ItemCard item={item} rank={selectMode ? undefined : index + 1} />
          </div>
        </div>
      ))}
    </div>
  );
}
