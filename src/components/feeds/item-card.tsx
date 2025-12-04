'use client';

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
    contentSnippet?: string;
    category: string;
    llmScore: LLMScore;
    finalScore: number;
    reasoning: string;
  };
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

function getRelevanceColor(relevance: number): string {
  if (relevance >= 8) return 'text-green-400';
  if (relevance >= 6) return 'text-yellow-400';
  return 'text-gray-400';
}

export default function ItemCard({ item }: ItemCardProps) {
  return (
    <div className="card p-4 hover:border-surface-border/80 transition-all hover:shadow-lg">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lg font-semibold text-blue-400 hover:text-blue-300 transition-colors block"
          >
            {item.title}
          </a>
          <p className="text-sm text-muted mt-1">{item.sourceTitle}</p>
        </div>
      </div>

      {/* Metadata */}
      <div className="flex items-center gap-2 text-xs text-muted mb-3">
        <span>{formatDate(item.publishedAt)}</span>
        <span>•</span>
        <span className={`badge ${getCategoryColor(item.category)}`}>
          {item.category.replace('_', ' ')}
        </span>
      </div>

      {/* Snippet */}
      {item.contentSnippet && (
        <p className="text-sm text-gray-300 mb-3 line-clamp-2">
          {item.contentSnippet}
        </p>
      )}

      {/* Score Section */}
      <div className="bg-surface/50 rounded p-3 mb-3 text-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="text-muted">Relevance</span>
          <span className={`font-semibold ${getRelevanceColor(item.llmScore.relevance)}`}>
            {item.llmScore.relevance.toFixed(1)}/10
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Score</span>
          <span className="font-semibold text-blue-400">
            {item.finalScore.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Tags */}
      {item.llmScore.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {item.llmScore.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-block px-2 py-1 text-xs bg-surface border border-surface-border rounded text-muted"
            >
              {tag}
            </span>
          ))}
          {item.llmScore.tags.length > 3 && (
            <span className="text-xs text-muted">
              +{item.llmScore.tags.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 pt-3 border-t border-surface-border">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
        >
          Read more →
        </a>
      </div>
    </div>
  );
}
