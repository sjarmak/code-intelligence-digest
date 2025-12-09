'use client';

import { useEffect, useState } from 'react';
import ItemRelevanceBadge, { ItemRelevanceRating } from './item-relevance-badge';

interface StarredItem {
  id: string;
  itemId: string;
  inoreaderItemId: string;
  title: string;
  url: string;
  sourceTitle: string;
  publishedAt: string;
  summary?: string;
  relevanceRating: number | null;
  notes: string | null;
  starredAt: string;
  ratedAt: string | null;
}

interface StarredItemsPanelProps {
  adminToken?: string;
}

export default function StarredItemsPanel({ adminToken }: StarredItemsPanelProps) {
  const [items, setItems] = useState<StarredItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterUnrated, setFilterUnrated] = useState(true);
  const [stats, setStats] = useState({ total: 0, unrated: 0 });
  const [syncing, setSyncing] = useState(false);

  const loadStarredItems = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        onlyUnrated: filterUnrated.toString(),
        limit: '50',
      });

      const response = await fetch(`/api/admin/starred?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch starred items');
      }

      const data = await response.json();
      setItems(data.items || []);
      setStats({
        total: data.total || 0,
        unrated: data.unrated || 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStarredItems();
  }, [filterUnrated]);

  const handleSyncStarred = async () => {
    setSyncing(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/sync-starred', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken || process.env.NEXT_PUBLIC_ADMIN_API_TOKEN || ''}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to sync starred items');
      }

      const data = await response.json();
      // Reload items after sync
      await loadStarredItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSyncing(false);
    }
  };

  const handleRateItem = async (
    itemId: string,
    rating: ItemRelevanceRating,
    notes?: string
  ) => {
    const item = items.find((i) => i.itemId === itemId);
    if (!item) {
      throw new Error('Item not found in list');
    }

    try {
      const response = await fetch(
        `/api/admin/starred/${item.inoreaderItemId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken || process.env.NEXT_PUBLIC_ADMIN_API_TOKEN || ''}`,
          },
          body: JSON.stringify({ rating, notes }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      // Update local state
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId
            ? { ...i, relevanceRating: rating, notes: notes || null }
            : i
        )
      );
    } catch (err) {
      console.error('Error rating item:', err);
      throw err; // Re-throw so child component can handle it
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2">Starred Items for Curation</h3>
        <p className="text-sm text-muted mb-4">
          Rate starred items to improve relevance scoring. Total: {stats.total}, Unrated: {stats.unrated}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-900/20 p-3">
          <p className="text-sm text-red-400">Error: {error}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleSyncStarred}
          disabled={syncing}
          className="px-4 py-2 rounded font-medium text-sm transition-colors bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {syncing ? 'Syncing...' : 'Sync from Inoreader'}
        </button>

        <button
          onClick={() => setFilterUnrated(!filterUnrated)}
          className={`px-4 py-2 rounded font-medium text-sm transition-colors ${
            filterUnrated
              ? 'bg-blue-600 text-white'
              : 'bg-surface border border-surface-border text-muted hover:text-foreground'
          }`}
        >
          {filterUnrated ? 'Show Unrated' : 'Show All'}
        </button>
      </div>

      {/* Items list */}
      {loading ? (
        <div className="text-center py-8 text-muted">
          Loading items...
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-muted">
          {filterUnrated ? 'No unrated items.' : 'No starred items.'}
        </div>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.itemId}
              className="border border-surface-border rounded-lg p-3 hover:border-blue-500/50 hover:bg-surface/50 transition-all"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-sm font-semibold text-blue-400 hover:text-blue-300 line-clamp-2"
                >
                  {item.title}
                </a>
                <ItemRelevanceBadge
                  itemId={item.itemId}
                  inoreaderItemId={item.inoreaderItemId}
                  currentRating={item.relevanceRating as ItemRelevanceRating}
                  onRatingChange={handleRateItem}
                  starred={true}
                />
              </div>

              <div className="flex items-center gap-2 text-xs text-muted mb-1">
                <span className="font-medium">{item.sourceTitle}</span>
                <span>•</span>
                <span>{new Date(item.publishedAt).toLocaleDateString()}</span>
              </div>

              {item.summary && (
                <p className="text-xs text-muted line-clamp-2 mb-2">
                  {item.summary}
                </p>
              )}

              {item.notes && (
                <p className="text-xs text-yellow-400/70 italic">
                  Note: {item.notes}
                </p>
              )}

              {item.ratedAt && (
                <p className="text-xs text-gray-500">
                  Rated: {new Date(item.ratedAt).toLocaleDateString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
