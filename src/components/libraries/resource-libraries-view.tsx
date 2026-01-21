'use client';

import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, FolderHeart, FileHeart, Trash2 } from 'lucide-react';
import { FeedItem } from '@/src/lib/model';

interface ResourceLibrary {
  id: 'saved-items' | 'digest-items';
  name: string;
  numItems: number;
}

interface ResourceLibrariesViewProps {
  onAddItemToQA?: (item: { id: string; title?: string }) => void;
  onSelectLibraryForQA?: (library: ResourceLibrary) => void;
}

export function ResourceLibrariesView({ onAddItemToQA, onSelectLibraryForQA }: ResourceLibrariesViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<FeedItem[]>([]);
  const [digestItems, setDigestItems] = useState<FeedItem[]>([]);
  const [expandedLibrary, setExpandedLibrary] = useState<'saved-items' | 'digest-items' | null>(null);
  const [clearing, setClearing] = useState(false);

  // Fetch saved items
  const fetchSavedItems = useCallback(async () => {
    try {
      const response = await fetch('/api/saved-items');
      if (!response.ok) throw new Error('Failed to fetch saved items');
      const data = await response.json();
      setSavedItems(data.items || []);
    } catch (err) {
      console.error('Failed to fetch saved items:', err);
      setSavedItems([]);
    }
  }, []);

  // Fetch digest items
  const fetchDigestItems = useCallback(async () => {
    try {
      const response = await fetch('/api/digest-items');
      if (!response.ok) throw new Error('Failed to fetch digest items');
      const data = await response.json();
      setDigestItems(data.items || []);
    } catch (err) {
      console.error('Failed to fetch digest items:', err);
      setDigestItems([]);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        await Promise.all([fetchSavedItems(), fetchDigestItems()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [fetchSavedItems, fetchDigestItems]);

  // Listen for changes to saved/digest items from other components
  useEffect(() => {
    const handleSavedItemsChanged = () => {
      fetchSavedItems();
    };
    const handleDigestItemsChanged = () => {
      fetchDigestItems();
    };

    window.addEventListener('saved-items-changed', handleSavedItemsChanged);
    window.addEventListener('digest-items-changed', handleDigestItemsChanged);

    return () => {
      window.removeEventListener('saved-items-changed', handleSavedItemsChanged);
      window.removeEventListener('digest-items-changed', handleDigestItemsChanged);
    };
  }, [fetchSavedItems, fetchDigestItems]);

  const handleLibraryClick = (libraryId: 'saved-items' | 'digest-items') => {
    if (expandedLibrary === libraryId) {
      setExpandedLibrary(null);
    } else {
      setExpandedLibrary(libraryId);
    }
  };

  const handleRemoveFromSavedItems = async (itemId: string) => {
    try {
      const response = await fetch(`/api/saved-items?itemId=${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        // Dispatch custom event to notify other components
        window.dispatchEvent(new CustomEvent('saved-items-changed'));
        await fetchSavedItems();
        if (expandedLibrary === 'saved-items') {
          setExpandedLibrary(null);
          setTimeout(() => setExpandedLibrary('saved-items'), 100);
        }
      }
    } catch (err) {
      console.error('Failed to remove from saved items:', err);
    }
  };

  const handleRemoveFromDigestItems = async (itemId: string) => {
    try {
      const response = await fetch(`/api/digest-items?itemId=${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        // Dispatch custom event to notify other components
        window.dispatchEvent(new CustomEvent('digest-items-changed'));
        await fetchDigestItems();
        if (expandedLibrary === 'digest-items') {
          setExpandedLibrary(null);
          setTimeout(() => setExpandedLibrary('digest-items'), 100);
        }
      }
    } catch (err) {
      console.error('Failed to remove from digest items:', err);
    }
  };

  const handleClearAllSavedItems = async () => {
    if (!confirm(`Are you sure you want to remove ALL ${savedItems.length} items from the Saved Items library? This cannot be undone.`)) {
      return;
    }
    setClearing(true);
    try {
      const response = await fetch('/api/saved-items?all=true', {
        method: 'DELETE',
      });
      if (response.ok) {
        window.dispatchEvent(new CustomEvent('saved-items-changed'));
        await fetchSavedItems();
      }
    } catch (err) {
      console.error('Failed to clear saved items:', err);
    } finally {
      setClearing(false);
    }
  };

  const handleClearAllDigestItems = async () => {
    if (!confirm(`Are you sure you want to remove ALL ${digestItems.length} items from the Digest Items library? This cannot be undone.`)) {
      return;
    }
    setClearing(true);
    try {
      const response = await fetch('/api/digest-items?all=true', {
        method: 'DELETE',
      });
      if (response.ok) {
        window.dispatchEvent(new CustomEvent('digest-items-changed'));
        await fetchDigestItems();
      }
    } catch (err) {
      console.error('Failed to clear digest items:', err);
    } finally {
      setClearing(false);
    }
  };

  const formatDate = (dateString: string | Date): string => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-red-300/50 bg-red-50 rounded-lg p-4">
        <p className="text-red-900">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Saved Items Library */}
      <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        <div className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors group">
          <button
            onClick={() => handleLibraryClick('saved-items')}
            className="flex items-center gap-3 flex-1 text-left"
          >
              {expandedLibrary === 'saved-items' ? (
                <ChevronDown className="w-5 h-5 text-black shrink-0" />
              ) : (
                <ChevronRight className="w-5 h-5 text-black shrink-0" />
            )}
            <FolderHeart className="w-5 h-5 text-black shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-black">Saved Items</h3>
              <p className="text-sm text-muted mt-0.5">
                {savedItems.length} {savedItems.length === 1 ? 'item' : 'items'}
              </p>
            </div>
          </button>
          {savedItems.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClearAllSavedItems();
              }}
              disabled={clearing}
              title="Clear all items from saved library"
              className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 border border-red-300 hover:bg-red-100 transition-colors whitespace-nowrap flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3 h-3" />
              Clear All
            </button>
          )}
          {onSelectLibraryForQA && savedItems.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectLibraryForQA({
                  id: 'saved-items',
                  name: 'Saved Items',
                  numItems: savedItems.length,
                });
              }}
              title="Add all items from this library to Q&A context"
              className="text-xs px-2 py-1 rounded bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors whitespace-nowrap flex items-center gap-1"
            >
              <FolderHeart className="w-3 h-3" />
              Add Library to Context
            </button>
          )}
        </div>

        {expandedLibrary === 'saved-items' && (
          <div className="border-t border-gray-300 p-4 bg-white">
            {savedItems.length === 0 ? (
              <div className="text-center text-muted py-4">No items in saved items library</div>
            ) : (
              <div className="space-y-2">
                {savedItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between p-3 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <h4 className="font-medium text-black hover:text-gray-700 transition-colors line-clamp-2">
                          {item.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted">
                          <span>{item.sourceTitle}</span>
                          <span>•</span>
                          <span>{formatDate(item.publishedAt)}</span>
                          {item.category && (
                            <>
                              <span>•</span>
                              <span className="capitalize">{item.category.replace('_', ' ')}</span>
                            </>
                          )}
                        </div>
                        {item.summary && (
                          <p className="text-sm text-muted mt-2 line-clamp-2">{item.summary}</p>
                        )}
                      </a>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await handleRemoveFromSavedItems(item.id);
                        }}
                        className="p-1.5 text-gray-600 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                        title="Remove from saved items"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      {onAddItemToQA && (
                        <button
                          onClick={() => onAddItemToQA({ id: item.id, title: item.title })}
                          className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100"
                          title="Add to Q&A"
                        >
                          Add
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Digest Items Library */}
      <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        <div className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors group">
          <button
            onClick={() => handleLibraryClick('digest-items')}
            className="flex items-center gap-3 flex-1 text-left"
          >
            {expandedLibrary === 'digest-items' ? (
              <ChevronDown className="w-5 h-5 text-black shrink-0" />
            ) : (
              <ChevronRight className="w-5 h-5 text-black shrink-0" />
            )}
            <FileHeart className="w-5 h-5 text-black shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-black">Digest Items</h3>
              <p className="text-sm text-muted mt-0.5">
                {digestItems.length} {digestItems.length === 1 ? 'item' : 'items'}
              </p>
            </div>
          </button>
          {digestItems.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClearAllDigestItems();
              }}
              disabled={clearing}
              title="Clear all items from digest library"
              className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 border border-red-300 hover:bg-red-100 transition-colors whitespace-nowrap flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3 h-3" />
              Clear All
            </button>
          )}
          {onSelectLibraryForQA && digestItems.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectLibraryForQA({
                  id: 'digest-items',
                  name: 'Digest Items',
                  numItems: digestItems.length,
                });
              }}
              title="Add all items from this library to Q&A context"
              className="text-xs px-2 py-1 rounded bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors whitespace-nowrap flex items-center gap-1"
            >
              <FileHeart className="w-3 h-3" />
              Add Library to Context
            </button>
          )}
        </div>

        {expandedLibrary === 'digest-items' && (
          <div className="border-t border-gray-300 p-4 bg-white">
            {digestItems.length === 0 ? (
              <div className="text-center text-muted py-4">No items in digest items library</div>
            ) : (
              <div className="space-y-2">
                {digestItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between p-3 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <h4 className="font-medium text-black hover:text-gray-700 transition-colors line-clamp-2">
                          {item.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted">
                          <span>{item.sourceTitle}</span>
                          <span>•</span>
                          <span>{formatDate(item.publishedAt)}</span>
                          {item.category && (
                            <>
                              <span>•</span>
                              <span className="capitalize">{item.category.replace('_', ' ')}</span>
                            </>
                          )}
                        </div>
                        {item.summary && (
                          <p className="text-sm text-muted mt-2 line-clamp-2">{item.summary}</p>
                        )}
                      </a>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await handleRemoveFromDigestItems(item.id);
                        }}
                        className="p-1.5 text-gray-600 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                        title="Remove from digest items"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      {onAddItemToQA && (
                        <button
                          onClick={() => onAddItemToQA({ id: item.id, title: item.title })}
                          className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100"
                          title="Add to Q&A"
                        >
                          Add
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
