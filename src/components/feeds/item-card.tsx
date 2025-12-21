'use client';

import ItemRelevanceBadge from '../tuning/item-relevance-badge';

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



export default function ItemCard({ item, rank }: ItemCardProps) {
  return (
    <div className="border border-surface-border rounded-lg p-4 hover:border-blue-500/50 hover:bg-surface/80 transition-all hover:shadow-md">
      {/* Main row with rank, score, and title */}
      <div className="flex items-start gap-4">
        {/* Rank number */}
        {rank !== undefined && (
          <div className="flex-shrink-0 pt-1">
            <span className="text-2xl font-bold text-blue-400 w-8 text-right">{rank}</span>
          </div>
        )}

        {/* Score and title */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-sm font-semibold text-blue-300 bg-surface/50 px-2 py-1 rounded">
              {item.finalScore.toFixed(2)}
            </span>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-semibold text-blue-400 hover:text-blue-300 transition-colors line-clamp-2"
            >
              {item.title}
            </a>
          </div>

          {/* Metadata line: source, tags, relevance, date */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted mb-2">
            <div className="flex items-center gap-1">
              <span className="font-medium text-gray-300">{item.sourceTitle}</span>
              <a
                href="/admin"
                className="inline-block px-1.5 py-0.5 rounded text-xs bg-gray-900/50 border border-gray-700 text-gray-400 hover:text-gray-300 hover:border-gray-600 transition-colors"
                title="Tune source relevance"
              >
                Tune
              </a>
            </div>
            <span>•</span>

            {/* Tags */}
            {item.llmScore.tags.length > 0 && (
              <>
                <div className="flex gap-1">
                  {item.llmScore.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="inline-block px-1.5 py-0.5 bg-surface border border-surface-border rounded text-gray-400"
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

            {/* Date */}
            <span>{formatDate(item.publishedAt)}</span>
          </div>

          {/* Category badge and relevance control */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {item.category && (
              <span className={`inline-block badge text-xs ${getCategoryColor(item.category)}`}>
                {item.category.replace('_', ' ')}
              </span>
            )}
            
            {/* Relevance rating badge (read-only display) */}
            <ItemRelevanceBadge
              itemId={item.id}
              currentRating={null}
              categories={item.category ? [item.category] : []}
              readOnly={true}
            />
          </div>
        </div>

        {/* External link icon */}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 text-blue-400 hover:text-blue-300 transition-colors mt-1"
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
