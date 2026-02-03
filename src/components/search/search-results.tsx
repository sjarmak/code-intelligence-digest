'use client';

import { useState, useEffect } from 'react';
import { Bookmark, FileHeart, FolderHeart, FileText } from 'lucide-react';
import { SearchResult } from '@/src/lib/pipeline/search';
import { FullTextViewer } from '@/src/components/common/fulltext-viewer';

interface SearchResultsProps {
  results: SearchResult[];
  isLoading: boolean;
  error: string | null;
  itemsSearched?: number;
}

function getSimilarityColor(score: number): string {
  if (score >= 0.8) return 'text-green-700';
  if (score >= 0.6) return 'text-gray-700';
  if (score >= 0.4) return 'text-gray-600';
  return 'text-red-700';
}

function getSimilarityBarColor(score: number): string {
  if (score >= 0.8) return 'bg-green-400';
  if (score >= 0.6) return 'bg-gray-400';
  if (score >= 0.4) return 'bg-gray-300';
  return 'bg-red-400';
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    newsletters: 'bg-gray-100 text-gray-800 border-gray-300',
    podcasts: 'bg-gray-100 text-gray-800 border-gray-300',
    tech_articles: 'bg-gray-100 text-gray-800 border-gray-300',
    ai_news: 'bg-gray-100 text-gray-800 border-gray-300',
    ai_dev: 'bg-gray-100 text-gray-800 border-gray-300',
    product_news: 'bg-gray-100 text-gray-800 border-gray-300',
    community: 'bg-gray-100 text-gray-800 border-gray-300',
    research: 'bg-gray-100 text-gray-800 border-gray-300',
  };
  return colors[category] || 'bg-gray-100 text-gray-800 border-gray-300';
}

export default function SearchResults({
  results,
  isLoading,
  error,
  itemsSearched,
}: SearchResultsProps) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loadingBibcodes, setLoadingBibcodes] = useState<Set<string>>(new Set());
  const [libraryStatus, setLibraryStatus] = useState<Map<string, { inSavedItems: boolean; inDigestItems: boolean }>>(new Map());
  const [hasFullText, setHasFullText] = useState<Map<string, boolean>>(new Map());
  const [libraryLoading, setLibraryLoading] = useState<Set<string>>(new Set());
  const [showFullText, setShowFullText] = useState<{ itemId: string; title: string } | null>(null);

  // Load favorites and library status on mount
  useEffect(() => {
    async function loadMetadata() {
      try {
        const [favoritesRes, ...libraryRes] = await Promise.all([
          fetch('/api/papers/favorites'),
          ...results.map((result) =>
            Promise.all([
              fetch(`/api/items/${encodeURIComponent(result.id)}/libraries`),
              fetch(`/api/items/${encodeURIComponent(result.id)}/fulltext`),
            ])
          ),
        ]);

        if (favoritesRes?.ok) {
          const data = await favoritesRes.json();
          setFavorites(new Set(data.bibcodes || []));
        }

        // Process library status and full text
        // Always check database state for each result
        const statusMap = new Map<string, { inSavedItems: boolean; inDigestItems: boolean }>();
        const fullTextMap = new Map<string, boolean>();

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const [libraryResItem, fulltextRes] = libraryRes[i];

          // Always set library status from database response
          if (libraryResItem?.ok) {
            const libData = await libraryResItem.json();
            statusMap.set(result.id, {
              inSavedItems: Boolean(libData.inSavedItems),
              inDigestItems: Boolean(libData.inDigestItems),
            });
          } else {
            // If API call fails for a specific item, default to false
            statusMap.set(result.id, {
              inSavedItems: false,
              inDigestItems: false,
            });
          }

          if (fulltextRes?.ok) {
            const fulltextData = await fulltextRes.json();
            fullTextMap.set(result.id, fulltextData.hasFullText || false);
          }
        }

        // Always update state with database-checked values
        setLibraryStatus(statusMap);
        setHasFullText(fullTextMap);
      } catch (error) {
        console.error('Failed to load metadata', error);
      }
    }

    if (results.length > 0) {
      loadMetadata();
    }
  }, [results]); // Reload when results change

  const toggleFavorite = async (bibcode: string) => {
    if (!bibcode) return;

    const isFavorite = favorites.has(bibcode);
    setLoadingBibcodes((prev) => new Set(prev).add(bibcode));

    try {
      const response = await fetch('/api/papers/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bibcode, favorite: !isFavorite }),
      });

      if (response.ok) {
        if (isFavorite) {
          setFavorites((prev) => {
            const next = new Set(prev);
            next.delete(bibcode);
            return next;
          });
        } else {
          setFavorites((prev) => new Set(prev).add(bibcode));
        }
      } else {
        console.error('Failed to update favorite status');
      }
    } catch (error) {
      console.error('Error toggling favorite', error);
    } finally {
      setLoadingBibcodes((prev) => {
        const next = new Set(prev);
        next.delete(bibcode);
        return next;
      });
    }
  };

  const handleToggleSavedItems = async (itemId: string) => {
    const status = libraryStatus.get(itemId);
    const inSavedItems = status?.inSavedItems || false;

    setLibraryLoading((prev) => new Set(prev).add(itemId));
    try {
      const method = inSavedItems ? 'DELETE' : 'POST';
      const response = await fetch(`/api/saved-items${method === 'DELETE' ? `?itemId=${encodeURIComponent(itemId)}` : ''}`, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
        body: method === 'POST' ? JSON.stringify({ itemId }) : undefined,
      });

      if (!response.ok) {
        throw new Error('Failed to toggle saved items');
      }

      // Reload library status to ensure it's in sync with the server
      const libraryRes = await fetch(`/api/items/${encodeURIComponent(itemId)}/libraries`);
      if (libraryRes?.ok) {
        const libData = await libraryRes.json();
        setLibraryStatus((prev) => {
          const next = new Map(prev);
          next.set(itemId, {
            inSavedItems: Boolean(libData.inSavedItems),
            inDigestItems: Boolean(libData.inDigestItems),
          });
          return next;
        });
      } else {
        // Fallback to optimistic update if reload fails
        setLibraryStatus((prev) => {
          const next = new Map(prev);
          const current = next.get(itemId) || { inSavedItems: false, inDigestItems: false };
          next.set(itemId, { ...current, inSavedItems: !inSavedItems });
          return next;
        });
      }
    } catch (error) {
      console.error('Error toggling saved items:', error);
    } finally {
      setLibraryLoading((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const handleToggleDigestItems = async (itemId: string) => {
    const status = libraryStatus.get(itemId);
    const inDigestItems = status?.inDigestItems || false;

    setLibraryLoading((prev) => new Set(prev).add(itemId));
    try {
      const method = inDigestItems ? 'DELETE' : 'POST';
      const response = await fetch(`/api/digest-items${method === 'DELETE' ? `?itemId=${encodeURIComponent(itemId)}` : ''}`, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
        body: method === 'POST' ? JSON.stringify({ itemId }) : undefined,
      });

      if (!response.ok) {
        throw new Error('Failed to toggle digest items');
      }

      // Reload library status to ensure it's in sync with the server
      const libraryRes = await fetch(`/api/items/${encodeURIComponent(itemId)}/libraries`);
      if (libraryRes?.ok) {
        const libData = await libraryRes.json();
        setLibraryStatus((prev) => {
          const next = new Map(prev);
          next.set(itemId, {
            inSavedItems: Boolean(libData.inSavedItems),
            inDigestItems: Boolean(libData.inDigestItems),
          });
          return next;
        });
      } else {
        // Fallback to optimistic update if reload fails
        setLibraryStatus((prev) => {
          const next = new Map(prev);
          const current = next.get(itemId) || { inSavedItems: false, inDigestItems: false };
          next.set(itemId, { ...current, inDigestItems: !inDigestItems });
          return next;
        });
      }
    } catch (error) {
      console.error('Error toggling digest items:', error);
    } finally {
      setLibraryLoading((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted">Searching...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4">
        <p className="text-red-900 font-medium">Search Error</p>
        <p className="text-red-800 text-sm mt-1">{error}</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted">
          {itemsSearched === 0
            ? 'No items found in this category and period.'
            : 'No results matched your search query. Try different keywords.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Found {results.length} result{results.length !== 1 ? 's' : ''}
        {itemsSearched ? ` (searched ${itemsSearched} items)` : ''}
      </p>

      <div className="grid gap-4 grid-cols-1">
        {results.map((result) => (
          <div
            key={result.id}
            className="card p-4 hover:border-surface-border/80 transition-all hover:shadow-lg"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-1">
                <a
                   href={result.url}
                   target="_blank"
                   rel="noopener noreferrer"
                   className="text-lg font-semibold text-black hover:text-gray-700 transition-colors block"
                 >
                   {result.title}
                 </a>
                <p className="text-sm text-muted mt-1">{result.sourceTitle}</p>
              </div>
              {/* Action buttons */}
              <div className="flex items-center gap-1">
                {/* Full text icon */}
                {hasFullText.get(result.id) && (
                  <button
                    onClick={() => setShowFullText({ itemId: result.id, title: result.title })}
                    className="p-2 rounded-lg transition-colors text-blue-600 hover:text-blue-700 hover:bg-blue-50 border border-blue-200"
                    title="View full text"
                  >
                    <FileText className="w-5 h-5" />
                  </button>
                )}

                {/* Saved items library (folder-heart) */}
                <button
                  onClick={() => handleToggleSavedItems(result.id)}
                  disabled={libraryLoading.has(result.id)}
                  className={`p-2 rounded-lg transition-colors ${
                    libraryStatus.get(result.id)?.inSavedItems
                      ? 'text-yellow-600 bg-yellow-50'
                      : 'text-gray-400 hover:text-yellow-600 hover:bg-yellow-50'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                  title={libraryStatus.get(result.id)?.inSavedItems ? 'Remove from saved items' : 'Add to saved items'}
                >
                  <FolderHeart className="w-5 h-5" />
                </button>

                {/* Digest items library (file-heart) */}
                <button
                  onClick={() => handleToggleDigestItems(result.id)}
                  disabled={libraryLoading.has(result.id)}
                  className={`p-2 rounded-lg transition-colors ${
                    libraryStatus.get(result.id)?.inDigestItems
                      ? 'text-yellow-600 bg-yellow-50'
                      : 'text-gray-400 hover:text-yellow-600 hover:bg-yellow-50'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                  title={libraryStatus.get(result.id)?.inDigestItems ? 'Remove from digest items' : 'Add to digest items'}
                >
                  <FileHeart className="w-5 h-5" />
                </button>

                {/* Bookmark icon for research papers only (ADS library) */}
                {result.bibcode && (
                  <button
                    onClick={() => toggleFavorite(result.bibcode!)}
                    disabled={loadingBibcodes.has(result.bibcode!)}
                    className={`flex-shrink-0 p-2 rounded-lg transition-colors ${
                      favorites.has(result.bibcode!)
                        ? 'text-yellow-600 hover:text-yellow-700 bg-yellow-50'
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={favorites.has(result.bibcode!) ? 'Remove from bookmarked library' : 'Add to bookmarked library'}
                  >
                    <Bookmark
                      className={`w-5 h-5 ${favorites.has(result.bibcode!) ? 'fill-current' : ''}`}
                    />
                  </button>
                )}
              </div>
            </div>

            {/* Metadata */}
            <div className="flex items-center gap-2 text-xs text-muted mb-3 flex-wrap">
              <span>{new Date(result.createdAt || result.publishedAt).toLocaleDateString()}</span>
              <span>•</span>
              <span className={`badge ${getCategoryColor(result.category)}`}>
                {result.category.replace('_', ' ')}
              </span>
            </div>

            {/* Summary */}
            {result.summary && (
              <p className="text-sm text-gray-700 mb-3 line-clamp-2">{result.summary}</p>
            )}

            {/* Similarity Score with Bar */}
            <div className="bg-surface/50 rounded p-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted">Semantic Similarity</span>
                <span className={`text-sm font-semibold ${getSimilarityColor(result.similarity)}`}>
                  {(result.similarity * 100).toFixed(0)}%
                </span>
              </div>
              <div className="w-full bg-surface rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full ${getSimilarityBarColor(result.similarity)} transition-all`}
                  style={{ width: `${result.similarity * 100}%` }}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 pt-3 border-t border-surface-border">
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-black hover:text-gray-700 text-sm transition-colors"
              >
                Read more →
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Full text viewer modal */}
      {showFullText && (
        <FullTextViewer
          itemId={showFullText.itemId}
          itemTitle={showFullText.title}
          isOpen={!!showFullText}
          onClose={() => setShowFullText(null)}
        />
      )}
    </div>
  );
}
