'use client';

import { useEffect, useState } from 'react';
import SourceRelevanceDropdown, { SourceRelevanceLevel } from './source-relevance-dropdown';

interface Source {
  streamId: string;
  canonicalName: string;
  sourceRelevance: number;
  relevanceLabel: string;
  defaultCategory: string;
}

interface SourcesPanelProps {
  adminToken?: string;
}

export default function SourcesPanel({ adminToken }: SourcesPanelProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');

  useEffect(() => {
    const fetchSources = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/admin/source-relevance');
        if (!response.ok) {
          throw new Error('Failed to fetch sources');
        }

        const data = await response.json();
        setSources(data.sources || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchSources();
  }, []);

  const handleRelevanceChange = async (
    streamId: string,
    relevance: SourceRelevanceLevel
  ) => {
    try {
      const response = await fetch('/api/admin/source-relevance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken || process.env.NEXT_PUBLIC_ADMIN_API_TOKEN || ''}`,
        },
        body: JSON.stringify({ streamId, relevance }),
      });

      if (!response.ok) {
        throw new Error('Failed to update relevance');
      }

      // Update local state
      setSources((prev) =>
        prev.map((source) =>
          source.streamId === streamId
            ? { ...source, sourceRelevance: relevance }
            : source
        )
      );
    } catch (err) {
      console.error('Error updating source relevance:', err);
    }
  };

  const categories = Array.from(
    new Set(sources.map((s) => s.defaultCategory))
  ).sort();

  const filteredSources =
    filterCategory === 'all'
      ? sources
      : sources.filter((s) => s.defaultCategory === filterCategory);

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        Loading sources...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-3">Feed Sources</h3>
        <p className="text-sm text-muted mb-4">
          Adjust how much each feed contributes to the digest scoring.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-900/20 p-3">
          <p className="text-sm text-red-400">Error: {error}</p>
        </div>
      )}

      {/* Filter by category */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setFilterCategory('all')}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              filterCategory === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-surface border border-surface-border text-muted hover:text-foreground'
            }`}
          >
            All ({sources.length})
          </button>
          {categories.map((cat) => {
            const count = sources.filter((s) => s.defaultCategory === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  filterCategory === cat
                    ? 'bg-blue-600 text-white'
                    : 'bg-surface border border-surface-border text-muted hover:text-foreground'
                }`}
              >
                {cat.replace('_', ' ')} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Sources list */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredSources.length === 0 ? (
          <div className="text-center py-8 text-muted">
            No sources found.
          </div>
        ) : (
          filteredSources.map((source) => (
            <div
              key={source.streamId}
              className="flex items-center justify-between p-3 rounded-lg border border-surface-border hover:border-surface-focus hover:bg-surface/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">
                  {source.canonicalName}
                </p>
                <p className="text-xs text-muted">
                  {source.defaultCategory.replace('_', ' ')}
                </p>
              </div>

              <SourceRelevanceDropdown
                streamId={source.streamId}
                sourceName={source.canonicalName}
                currentRelevance={source.sourceRelevance}
                onRelevanceChange={handleRelevanceChange}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
