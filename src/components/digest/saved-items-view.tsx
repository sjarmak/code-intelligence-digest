'use client';

import { useEffect, useState, useCallback } from 'react';
import ItemCard from '@/src/components/feeds/item-card';
import { FolderHeart, RefreshCw, CheckSquare, Square, Trash2, X } from 'lucide-react';

interface SavedItemsViewProps {
  selectedItemIds?: Set<string>;
  onSelectionChange?: (selectedIds: Set<string>) => void;
  showCheckboxes?: boolean;
}

interface SavedApiItem {
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

interface SavedItem extends SavedApiItem {
  llmScore: {
    relevance: number;
    usefulness: number;
    tags: string[];
  };
  finalScore: number;
  reasoning: string;
  diversityReason?: string;
}

export function SavedItemsView({ selectedItemIds: externalSelectedIds, onSelectionChange, showCheckboxes = false }: SavedItemsViewProps = {}) {

  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(externalSelectedIds || new Set());
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteSelectedIds, setDeleteSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

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
      const fetchedItems: SavedApiItem[] = data.items || [];

      // Transform items to match ItemCard format
      const transformedItems: SavedItem[] = fetchedItems.map((item) => ({
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

  const handleToggleDeleteMode = () => {
    setDeleteMode(!deleteMode);
    if (deleteMode) {
      setDeleteSelectedIds(new Set());
    }
  };

  const handleToggleDeleteSelection = (itemId: string) => {
    const newSelection = new Set(deleteSelectedIds);
    if (newSelection.has(itemId)) {
      newSelection.delete(itemId);
    } else {
      newSelection.add(itemId);
    }
    setDeleteSelectedIds(newSelection);
  };

  const handleSelectAllForDelete = () => {
    setDeleteSelectedIds(new Set(items.map(item => item.id)));
  };

  const handleDeselectAllForDelete = () => {
    setDeleteSelectedIds(new Set());
  };

  const handleDeleteSelected = async () => {
    if (deleteSelectedIds.size === 0) return;

    if (!confirm(`Are you sure you want to delete ${deleteSelectedIds.size} item(s) from the saved items library?`)) {
      return;
    }

    setDeleting(true);
    try {
      const itemIdsArray = Array.from(deleteSelectedIds);
      const response = await fetch('/api/saved-items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: itemIdsArray }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete items');
      }

      // Refresh items and clear selection
      setDeleteSelectedIds(new Set());
      setDeleteMode(false);
      await fetchItems();

      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent('saved-items-changed'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete items';
      setError(message);
    } finally {
      setDeleting(false);
    }
  };

  const handleRemoveAll = async () => {
    if (!confirm(`Are you sure you want to remove ALL ${items.length} items from the saved items library? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch('/api/saved-items?all=true', {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to remove all items');
      }

      // Refresh items and clear selection
      setDeleteSelectedIds(new Set());
      setDeleteMode(false);
      await fetchItems();

      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent('saved-items-changed'));
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
          <div className="flex items-center gap-2">
            {deleteMode && (
              <>
                <button
                  onClick={deleteSelectedIds.size === items.length ? handleDeselectAllForDelete : handleSelectAllForDelete}
                  disabled={items.length === 0 || deleting}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-white border border-gray-300 text-black hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                  title={deleteSelectedIds.size === items.length ? 'Deselect all' : 'Select all'}
                >
                  {deleteSelectedIds.size === items.length ? (
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
                {deleteSelectedIds.size > 0 && (
                  <button
                    onClick={handleDeleteSelected}
                    disabled={deleting}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-red-50 border border-red-300 text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                    title={`Delete ${deleteSelectedIds.size} selected item(s)`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Selected ({deleteSelectedIds.size})
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
            {!showCheckboxes && (
              <button
                onClick={handleToggleDeleteMode}
                disabled={items.length === 0 || deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors bg-white border border-gray-300 text-black hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                title={deleteMode ? 'Exit delete mode' : 'Enter delete mode'}
              >
                {deleteMode ? (
                  <>
                    <X className="w-4 h-4" />
                    Cancel
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </>
                )}
              </button>
            )}
            {!showCheckboxes && !deleteMode && items.length > 0 && (
              <button
                onClick={handleRemoveAll}
                disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors bg-red-50 border border-red-300 text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                title="Clear all items from saved library"
              >
                <Trash2 className="w-4 h-4" />
                Clear All
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading || deleting}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-colors bg-white border border-gray-300 text-black hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
              title="Refresh saved items"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
        <p className="text-sm text-muted">
          {deleteMode
            ? `Select items to delete. ${deleteSelectedIds.size} of ${items.length} selected.`
            : showCheckboxes
              ? `Select items from your saved items library (${internalSelectedIds.size} selected).`
              : 'Your saved items library. Select items from here when generating newsletters or podcasts in Manual mode.'}
        </p>
      </div>
      {items.map((item, index) => (
        <div key={item.id} className="flex items-start gap-3">
          {(showCheckboxes || deleteMode) && (
            <input
              type="checkbox"
              checked={showCheckboxes ? internalSelectedIds.has(item.id) : deleteSelectedIds.has(item.id)}
              onChange={() => showCheckboxes ? handleToggleSelection(item.id) : handleToggleDeleteSelection(item.id)}
              disabled={deleting}
              className="mt-4 rounded border-surface-border accent-black focus:ring-black bg-surface"
            />
          )}
          <div className="flex-1">
            <ItemCard item={item} rank={(showCheckboxes || deleteMode) ? undefined : index + 1} />
          </div>
        </div>
      ))}
    </div>
  );
}
