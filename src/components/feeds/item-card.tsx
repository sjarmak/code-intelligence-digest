'use client';

import { useState, useEffect } from 'react';
import { Bookmark } from 'lucide-react';
import ItemRelevanceBadge, { ItemRelevanceRating } from '@/src/components/tuning/item-relevance-badge';
import { useAdminSettings } from '@/src/hooks/useAdminSettings';

interface LLMScore {
  relevance: number;
  usefulness: number;
  tags: string[];
}

interface ItemCardProps {
  item: {
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
    llmScore: LLMScore;
    finalScore: number;
    reasoning: string;
    diversityReason?: string;
  };
  rank?: number;
  period?: 'day' | 'week' | 'month' | 'all' | 'custom';
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString();
}

function formatCategoryName(category: string): string {
  const categoryLabels: Record<string, string> = {
    newsletters: 'Newsletters',
    podcasts: 'Podcasts',
    tech_articles: 'Tech Articles',
    ai_news: 'AI News',
    product_news: 'Product News',
    community: 'Community',
    research: 'Research',
  };
  return categoryLabels[category] || category.replace('_', ' ');
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    newsletters: 'bg-gray-100 text-gray-800 border-gray-300',
    podcasts: 'bg-gray-100 text-gray-800 border-gray-300',
    tech_articles: 'bg-gray-100 text-gray-800 border-gray-300',
    ai_news: 'bg-gray-100 text-gray-800 border-gray-300',
    product_news: 'bg-gray-100 text-gray-800 border-gray-300',
    community: 'bg-gray-100 text-gray-800 border-gray-300',
    research: 'bg-gray-100 text-gray-800 border-gray-300',
  };
  return colors[category] || 'bg-gray-100 text-gray-800 border-gray-300';
}



// Extract bibcode from arXiv URL or ADS URL
function extractBibcodeFromUrl(url: string): string | null {
  // Match ADS URLs: https://ui.adsabs.harvard.edu/abs/BIBCODE or https://adsabs.harvard.edu/abs/BIBCODE
  const adsMatch = url.match(/adsabs\.harvard\.edu\/abs\/([^\/\?&#]+)/);
  if (adsMatch) {
    return decodeURIComponent(adsMatch[1]);
  }

  // Match arXiv URLs: https://arxiv.org/abs/YYMM.NNNNN or https://arxiv.org/pdf/YYMM.NNNNN.pdf
  const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/);
  if (arxivMatch) {
    const arxivId = arxivMatch[1];
    // Convert arXiv ID to bibcode format: YYMM.NNNNN -> YYYYarXivYYMMNNNNNL
    // Example: 2501.00123 -> 2025arXiv250100123A
    const [yymm, nnnnn] = arxivId.split('.');
    const yearSuffix = yymm.substring(0, 2);
    const month = yymm.substring(2, 4);
    // Determine full year: assume 2000s for now (20-99 -> 2020-2099)
    const fullYear = 2000 + parseInt(yearSuffix);

    // Format: YYYYarXivYYMMNNNNNL (L is a letter, we'll use 'A' as default)
    // Pad nnnnn to 5 digits (left-pad with zeros)
    const paddedNumber = nnnnn.padStart(5, '0');
    return `${fullYear}arXiv${yearSuffix}${month}${paddedNumber}A`;
  }

  return null;
}

export default function ItemCard({ item, rank, period }: ItemCardProps) {
  const { settings, loading } = useAdminSettings();
  const [currentRating, setCurrentRating] = useState<ItemRelevanceRating>(null);
  const [isStarred, setIsStarred] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const bibcode = item.category === 'research' ? extractBibcodeFromUrl(item.url) : null;

  // Load stored rating, starred status, and favorite status on mount
  useEffect(() => {
    const loadMetadata = async () => {
      try {
        const [relevanceRes, favoriteRes] = await Promise.all([
          fetch(`/api/admin/item-relevance?itemId=${encodeURIComponent(item.id)}`),
          bibcode ? fetch(`/api/papers/${encodeURIComponent(bibcode)}/favorite`) : Promise.resolve(null),
        ]);

        if (relevanceRes?.ok) {
          const data = await relevanceRes.json();
          if (data.rating !== undefined) {
            setCurrentRating(data.rating);
          }
          if (data.starred !== undefined) {
            setIsStarred(data.starred);
          }
        }

        if (favoriteRes?.ok) {
          const data = await favoriteRes.json();
          setIsFavorite(data.isFavorite || false);
        }
      } catch (error) {
        console.error('Error loading item metadata:', error);
      }
    };

    loadMetadata();
  }, [item.id, bibcode]);

  const handleRateItem = async (
    itemId: string,
    rating: ItemRelevanceRating,
    notes?: string
  ) => {
    try {
      const response = await fetch('/api/admin/item-relevance', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itemId, rating, notes }),
      });

      if (!response.ok) {
        throw new Error(`API error ${response.status}`);
      }

      setCurrentRating(rating);
    } catch (error) {
      console.error('Error rating item:', error);
      throw error;
    }
  };

  const handleToggleFavorite = async () => {
    if (!bibcode) {
      console.warn('Cannot favorite: no bibcode extracted from URL', item.url);
      return;
    }

    setFavoriteLoading(true);
    const wasFavorite = isFavorite;
    try {
      const method = isFavorite ? 'DELETE' : 'POST';
      const response = await fetch(`/api/papers/${encodeURIComponent(bibcode)}/favorite`, {
        method,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Failed to toggle favorite:', errorData);
        return;
      }

      const data = await response.json();
      setIsFavorite(data.isFavorite || false);

      // Trigger section processing if favoriting (not unfavoriting)
      if (!wasFavorite && data.isFavorite) {
        // The favorite endpoint already triggers section processing, but we can also call it explicitly
        fetch(`/api/papers/${encodeURIComponent(bibcode)}/process-sections`, {
          method: 'POST',
        }).catch(err => console.error('Failed to trigger section processing:', err));
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
    } finally {
      setFavoriteLoading(false);
    }
  };

  return (
    <div className="border border-surface-border rounded-lg p-4 hover:border-gray-400 hover:bg-surface/80 transition-all hover:shadow-md">
       {/* Main row with rank, score, and title */}
       <div className="flex items-start gap-4">
         {/* Rank number */}
         {rank !== undefined && (
           <div className="flex-shrink-0 pt-1">
             <span className="text-2xl font-bold text-black w-8 text-right">{rank}</span>
           </div>
         )}

         {/* Score and title */}
         <div className="flex-1 min-w-0">
           <div className="flex items-baseline gap-2 mb-1">
             {!loading && settings.enableItemRelevanceTuning && (
               <span className="text-sm font-semibold text-gray-700 bg-surface/50 px-2 py-1 rounded">
                 {item.finalScore.toFixed(2)}
               </span>
             )}
             <a
               href={item.url}
               target="_blank"
               rel="noopener noreferrer"
               className="text-base font-semibold text-black hover:text-gray-700 transition-colors line-clamp-2"
             >
               {item.title}
             </a>
          </div>

          {/* Metadata line: source, tags, date, and rating button */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted mb-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-700">{item.sourceTitle}</span>
              <span>•</span>

              {/* Tags */}
              {item.llmScore.tags.length > 0 && (
                <>
                  <div className="flex gap-1">
                    {item.llmScore.tags.slice(0, 2).map((tag, tagIndex) => (
                      <span
                        key={`${item.id}-tag-${tagIndex}-${tag}`}
                        className="inline-block px-1.5 py-0.5 bg-surface border border-surface-border rounded text-gray-600"
                      >
                        {tag}
                      </span>
                    ))}
                    {item.llmScore.tags.length > 2 && (
                      <span className="text-gray-500">+{item.llmScore.tags.length - 2}</span>
                    )}
                  </div>
                  <span>•</span>
                </>
              )}

              {/* Date - use createdAt for day period or research day/week/month, otherwise use publishedAt */}
              <span>{formatDate(((period === 'day' || (item.category === 'research' && period !== 'all')) && item.createdAt) ? item.createdAt : item.publishedAt)}</span>
            </div>

            {/* Favorite button for research papers - right aligned */}
            {item.category === 'research' && bibcode && (
              <button
                onClick={handleToggleFavorite}
                disabled={favoriteLoading}
                className={`p-1.5 rounded transition-colors ${
                  isFavorite ? 'text-yellow-600 bg-yellow-50' : 'text-gray-400 hover:text-yellow-600 hover:bg-yellow-50'
                } disabled:opacity-50`}
                title={isFavorite ? 'Remove bookmark' : 'Bookmark paper'}
              >
                <Bookmark className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
              </button>
            )}

            {/* Rating button - right aligned */}
            {!loading && settings.enableItemRelevanceTuning && (
              <ItemRelevanceBadge
                itemId={item.id}
                currentRating={currentRating}
                onRatingChange={handleRateItem}
                starred={isStarred}
                onStarChange={(starred) => setIsStarred(starred)}
                readOnly={false}
              />
            )}
          </div>

          {/* Category badge */}
          {item.category && (
            <span className={`inline-block badge text-xs ${getCategoryColor(item.category)}`}>
              {formatCategoryName(item.category)}
            </span>
          )}
        </div>

        {/* External link icon */}
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
  );
}
