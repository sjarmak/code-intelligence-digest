'use client';

import { SearchResult } from '@/src/lib/pipeline/search';

interface SearchResultsProps {
  results: SearchResult[];
  isLoading: boolean;
  error: string | null;
  itemsSearched?: number;
}

function getSimilarityColor(score: number): string {
  if (score >= 0.8) return 'text-green-400';
  if (score >= 0.6) return 'text-yellow-400';
  if (score >= 0.4) return 'text-orange-400';
  return 'text-red-400';
}

function getSimilarityBarColor(score: number): string {
  if (score >= 0.8) return 'bg-green-600';
  if (score >= 0.6) return 'bg-yellow-600';
  if (score >= 0.4) return 'bg-orange-600';
  return 'bg-red-600';
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    newsletters: 'bg-blue-900/30 text-blue-300 border-blue-700',
    podcasts: 'bg-purple-900/30 text-purple-300 border-purple-700',
    tech_articles: 'bg-cyan-900/30 text-cyan-300 border-cyan-700',
    ai_news: 'bg-amber-900/30 text-amber-300 border-amber-700',
    product_news: 'bg-green-900/30 text-green-300 border-green-700',
    community: 'bg-pink-900/30 text-pink-300 border-pink-700',
    research: 'bg-indigo-900/30 text-indigo-300 border-indigo-700',
  };
  return colors[category] || 'bg-gray-900/30 text-gray-300 border-gray-700';
}

export default function SearchResults({
  results,
  isLoading,
  error,
  itemsSearched,
}: SearchResultsProps) {
  if (isLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted">Searching...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900 bg-red-900/20 p-4">
        <p className="text-red-400 font-medium">Search Error</p>
        <p className="text-red-300 text-sm mt-1">{error}</p>
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
                  className="text-lg font-semibold text-blue-400 hover:text-blue-300 transition-colors block"
                >
                  {result.title}
                </a>
                <p className="text-sm text-muted mt-1">{result.sourceTitle}</p>
              </div>
            </div>

            {/* Metadata */}
            <div className="flex items-center gap-2 text-xs text-muted mb-3 flex-wrap">
              <span>{new Date(result.publishedAt).toLocaleDateString()}</span>
              <span>•</span>
              <span className={`badge ${getCategoryColor(result.category)}`}>
                {result.category.replace('_', ' ')}
              </span>
            </div>

            {/* Summary */}
            {result.summary && (
              <p className="text-sm text-gray-300 mb-3 line-clamp-2">{result.summary}</p>
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
                className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
              >
                Read more →
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
