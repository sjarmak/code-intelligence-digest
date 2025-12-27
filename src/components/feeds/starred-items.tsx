'use client';

import { useEffect, useState } from 'react';
import ItemCard from './item-card';

interface StarredItem {
  id: string;
  itemId: string;
  inoreaderItemId: string;
  title: string;
  url: string;
  sourceTitle: string;
  publishedAt: string;
  createdAt?: string | null;
  summary?: string;
  relevanceRating?: number | null;
  notes?: string | null;
  starredAt: string;
  ratedAt?: string | null;
}

export default function StarredItems() {
  const [items, setItems] = useState<StarredItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadStarredItems = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch('/api/admin/starred?limit=100');
        if (!response.ok) {
          throw new Error('Failed to load starred items');
        }

        const data = await response.json();
        setItems(data.items || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load starred items');
        console.error('Error loading starred items:', err);
      } finally {
        setLoading(false);
      }
    };

    loadStarredItems();
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading starred items...</div>;
  }

  if (error) {
    return <div className="text-center py-12 text-red-600">Error: {error}</div>;
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted">
        <p>No starred items yet. Star items from the resources tab to see them here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-black">Starred Items</h2>
        <p className="text-sm text-muted mt-1">{items.length} item{items.length !== 1 ? 's' : ''} saved for later</p>
      </div>
      <div className="space-y-4">
        {items.map((item, index) => (
          <div key={item.id} className="border border-surface-border rounded-lg p-4 hover:border-gray-400 hover:bg-surface/80 transition-all hover:shadow-md">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 pt-1">
                <span className="text-2xl font-bold text-black w-8 text-right">{index + 1}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base font-semibold text-black hover:text-gray-700 transition-colors line-clamp-2"
                  >
                    {item.title}
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted mb-2">
                  <span className="font-medium text-gray-700">{item.sourceTitle}</span>
                  <span>•</span>
                  <span>{new Date(item.createdAt || item.publishedAt).toLocaleDateString()}</span>
                </div>
                {item.summary && (
                  <p className="text-sm text-gray-600 line-clamp-2">{item.summary}</p>
                )}
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 text-black hover:text-gray-700 transition-colors mt-1"
                title="Open in new tab"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
