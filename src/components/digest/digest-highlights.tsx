'use client';

import Link from 'next/link';

interface HighlightItem {
  id: string;
  title: string;
  url: string;
  sourceTitle: string;
  finalScore: number;
}

interface DigestHighlightsProps {
  highlights: Record<string, HighlightItem[]>;
  expandedLimits?: Record<string, number>;
  onExpandCategory?: (category: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  newsletters: 'Newsletters',
  podcasts: 'Podcasts',
  tech_articles: 'Tech Articles',
  ai_news: 'AI News',
  product_news: 'Product News',
  community: 'Community',
  research: 'Research',
};

// Note: Colors organized for potential future use or styling expansion
const categoryStyles = {
  newsletters: 'from-blue-900/30 to-blue-900/10 border-blue-500/30',
  podcasts: 'from-purple-900/30 to-purple-900/10 border-purple-500/30',
  tech_articles: 'from-green-900/30 to-green-900/10 border-green-500/30',
  ai_news: 'from-orange-900/30 to-orange-900/10 border-orange-500/30',
  product_news: 'from-pink-900/30 to-pink-900/10 border-pink-500/30',
  community: 'from-cyan-900/30 to-cyan-900/10 border-cyan-500/30',
  research: 'from-yellow-900/30 to-yellow-900/10 border-yellow-500/30',
} as const;

export default function DigestHighlights({
  highlights,
  expandedLimits = {},
  onExpandCategory,
}: DigestHighlightsProps) {
  const categories = Object.entries(highlights)
    .filter(([, items]) => items.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div>
      <h2 className="text-2xl font-bold text-foreground mb-6">Highlights by Category</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
         {categories.map(([category, items]) => {
           const limit = expandedLimits[category] || 10;
           const displayedItems = items.slice(0, limit);
           const hasMore = items.length > limit;
           
           return (
           <div
             key={category}
             className={`bg-gradient-to-br ${categoryStyles[category as keyof typeof categoryStyles]} border rounded-lg p-6`}
           >
             <div className="flex items-center justify-between mb-4">
               <h3 className="text-lg font-semibold text-foreground">
                 {CATEGORY_LABELS[category]}
               </h3>
               {hasMore && (
                 <button
                   onClick={() => onExpandCategory?.(category)}
                   className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                 >
                   {limit === 10 ? 'Expand' : 'Collapse'}
                 </button>
               )}
             </div>

             <div className="space-y-3">
               {displayedItems.map((item, i) => (
                 <div key={item.id} className="flex gap-3">
                   <div className="text-muted font-bold min-w-6">{i + 1}.</div>
                   <div className="flex-1 min-w-0">
                     <Link
                       href={item.url}
                       target="_blank"
                       rel="noopener noreferrer"
                       className="text-blue-400 hover:text-blue-300 font-medium text-sm break-words line-clamp-2"
                     >
                       {item.title}
                     </Link>
                     <div className="text-xs text-muted mt-1">
                       {item.sourceTitle} • {(item.finalScore * 100).toFixed(0)}%
                     </div>
                   </div>
                 </div>
               ))}
             </div>

             {hasMore && limit === 10 && (
               <div className="text-xs text-muted mt-3">
                 Showing {displayedItems.length} of {items.length} items
               </div>
             )}

             <Link
               href={`/?category=${category}`}
               className="text-xs text-blue-400 hover:text-blue-300 mt-4 inline-block"
             >
               View all {CATEGORY_LABELS[category].toLowerCase()} →
             </Link>
           </div>
           );
         })}
       </div>
    </div>
  );
}
