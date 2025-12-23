'use client';

import { Suspense, useState } from 'react';
import ItemsGrid from '@/src/components/feeds/items-grid';
import SearchPage from '@/src/components/search/search-page';
import QAPage from '@/src/components/qa/qa-page';

export const dynamic = 'force-dynamic';

type Period = 'day' | 'week' | 'month' | 'all';
type TabType = 'resources' | 'search' | 'ask';

function Loading() {
  return <div className="text-center py-12 text-muted">Loading...</div>;
}

export default function Home() {
  const [period, setPeriod] = useState<Period>('week');
  const [activeCategory, setActiveCategory] = useState<string>('newsletters');
  const [activeTab, setActiveTab] = useState<TabType>('resources');

  const categories = [
    { id: 'newsletters', label: 'Newsletters' },
    { id: 'podcasts', label: 'Podcasts' },
    { id: 'tech_articles', label: 'Tech Articles' },
    { id: 'ai_news', label: 'AI News' },
    { id: 'product_news', label: 'Product News' },
    { id: 'community', label: 'Community' },
    { id: 'research', label: 'Research' },
  ];

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Header */}
      <header className="border-b border-surface-border sticky top-0 z-10 bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-start">
            {/* Title */}
            <div>
              <h1 className="text-3xl font-bold">Code Intelligence Digest</h1>
              <p className="text-muted mt-2">
                Daily, weekly, and monthly digests of code intelligence, tools, and AI agents
              </p>
            </div>

            {/* Settings icon */}
            <a
              href="/admin"
              className="p-1 rounded-md transition-colors hover:bg-gray-100"
              title="Manage relevance tuning and content sync"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      {/* Main Tabs */}
      <div className="border-b border-surface-border bg-surface sticky top-20 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex overflow-x-auto gap-6" role="tablist">
            <button
                onClick={() => setActiveTab('resources')}
                className={`px-1 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeTab === 'resources'
                    ? 'border-black text-black'
                    : 'border-transparent text-gray-600 hover:text-black'
                }`}
                role="tab"
                aria-selected={activeTab === 'resources'}
              >
                Resources
              </button>
             <button
               onClick={() => setActiveTab('search')}
               className={`px-1 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                 activeTab === 'search'
                   ? 'border-black text-black'
                   : 'border-transparent text-gray-600 hover:text-black'
               }`}
               role="tab"
               aria-selected={activeTab === 'search'}
             >
               Search
             </button>
             <button
               onClick={() => setActiveTab('ask')}
               className={`px-1 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                 activeTab === 'ask'
                   ? 'border-black text-black'
                   : 'border-transparent text-gray-600 hover:text-black'
               }`}
               role="tab"
               aria-selected={activeTab === 'ask'}
             >
               Ask
             </button>
             <a
               href="/research"
               className="px-1 py-4 text-sm font-medium border-b-2 border-transparent text-gray-600 hover:text-black transition-colors whitespace-nowrap no-underline"
               style={{ color: '#666666' }}
               title="View ADS research libraries"
             >
               Libraries
             </a>
             <a
               href="/synthesis/newsletter"
               className="px-1 py-4 text-sm font-medium border-b-2 border-transparent text-gray-600 hover:text-black transition-colors whitespace-nowrap no-underline"
               style={{ color: '#666666' }}
               title="Generate newsletters"
             >
               Newsletter Generator
             </a>
             <a
               href="/synthesis/podcast"
               className="px-1 py-4 text-sm font-medium border-b-2 border-transparent text-gray-600 hover:text-black transition-colors whitespace-nowrap no-underline"
               style={{ color: '#666666' }}
               title="Generate podcast episodes"
             >
               Podcast Generator
             </a>
           </nav>
        </div>
      </div>

      {/* Category Tabs (only show for resources tab) */}
      {activeTab === 'resources' && (
        <div className="border-b border-surface-border bg-surface sticky top-32 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center">
              <nav className="flex overflow-x-auto gap-2" role="tablist">
                {categories.map((cat) => (
                  <button
                     key={cat.id}
                     onClick={() => setActiveCategory(cat.id)}
                     className={`px-4 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                       activeCategory === cat.id
                         ? 'border-black text-black'
                         : 'border-transparent text-gray-600 hover:text-black'
                     }`}
                     role="tab"
                     aria-selected={activeCategory === cat.id}
                   >
                     {cat.label}
                   </button>
                 ))}
               </nav>

              {/* Period buttons on the right */}
              <div className="flex gap-2 ml-auto">
                <button
                   onClick={() => setPeriod('day')}
                   className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                     period === 'day'
                       ? 'bg-black text-white'
                       : 'bg-white border border-gray-400 text-black hover:bg-gray-50'
                   }`}
                >
                   Daily
                </button>
                <button
                   onClick={() => setPeriod('week')}
                   className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                     period === 'week'
                       ? 'bg-black text-white'
                       : 'bg-white border border-gray-400 text-black hover:bg-gray-50'
                   }`}
                >
                   Weekly
                </button>
                <button
                   onClick={() => setPeriod('month')}
                   className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                     period === 'month'
                       ? 'bg-black text-white'
                       : 'bg-white border border-gray-400 text-black hover:bg-gray-50'
                   }`}
                >
                   Monthly
                </button>
                <button
                   onClick={() => setPeriod('all')}
                   className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                     period === 'all'
                       ? 'bg-black text-white'
                       : 'bg-white border border-gray-400 text-black hover:bg-gray-50'
                   }`}
                >
                   All-time
                </button>
              </div>
            </div>
           </div>
         </div>
       )}

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'resources' && (
          <Suspense fallback={<Loading />}>
            <ItemsGrid category={activeCategory} period={period} />
          </Suspense>
        )}
        {activeTab === 'search' && <SearchPage />}
        {activeTab === 'ask' && <QAPage />}
      </main>
    </div>
  );
}
