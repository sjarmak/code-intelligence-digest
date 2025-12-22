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



export default function ItemCard({ item, rank }: ItemCardProps) {
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
             <span className="text-sm font-semibold text-gray-700 bg-surface/50 px-2 py-1 rounded">
               {item.finalScore.toFixed(2)}
             </span>
             <a
               href={item.url}
               target="_blank"
               rel="noopener noreferrer"
               className="text-base font-semibold text-black hover:text-gray-700 transition-colors line-clamp-2"
             >
               {item.title}
             </a>
          </div>

          {/* Metadata line: source, tags, date */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted mb-2">
            <span className="font-medium text-gray-700">{item.sourceTitle}</span>
            <span>•</span>

            {/* Tags */}
            {item.llmScore.tags.length > 0 && (
              <>
                <div className="flex gap-1">
                  {item.llmScore.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
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

            {/* Date */}
            <span>{formatDate(item.publishedAt)}</span>
          </div>

          {/* Category badge */}
          {item.category && (
            <span className={`inline-block badge text-xs ${getCategoryColor(item.category)}`}>
              {item.category.replace('_', ' ')}
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
