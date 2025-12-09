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
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-surface-border sticky top-0 z-10 bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Code Intelligence Digest</h1>
              <p className="text-muted mt-2">
                Daily, weekly, and monthly digests of code intelligence, tools, and AI agents
              </p>
            </div>
            <div className="flex gap-2 flex-wrap items-start">
              <a
                href="/admin"
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-surface border border-surface-border text-muted hover:text-foreground"
                title="Manage relevance tuning"
              >
                ⚙️ Tuning
              </a>
              <button
                onClick={() => setPeriod('day')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  period === 'day'
                    ? 'bg-blue-600 text-white'
                    : 'bg-surface border border-surface-border text-muted hover:text-foreground'
                }`}
              >
                Daily
              </button>
              <button
                onClick={() => setPeriod('week')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  period === 'week'
                    ? 'bg-blue-600 text-white'
                    : 'bg-surface border border-surface-border text-muted hover:text-foreground'
                }`}
              >
                Weekly
              </button>
              <button
                onClick={() => setPeriod('month')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  period === 'month'
                    ? 'bg-blue-600 text-white'
                    : 'bg-surface border border-surface-border text-muted hover:text-foreground'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setPeriod('all')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  period === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-surface border border-surface-border text-muted hover:text-foreground'
                }`}
              >
                All-time
              </button>
            </div>
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
                   ? 'border-blue-500 text-blue-400'
                   : 'border-transparent text-muted hover:text-foreground'
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
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-muted hover:text-foreground'
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
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-muted hover:text-foreground'
              }`}
              role="tab"
              aria-selected={activeTab === 'ask'}
            >
              Ask
            </button>
          </nav>
        </div>
      </div>

      {/* Category Tabs (only show for resources tab) */}
      {activeTab === 'resources' && (
        <div className="border-b border-surface-border bg-surface sticky top-32 z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex overflow-x-auto gap-2" role="tablist">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-4 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                    activeCategory === cat.id
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-muted hover:text-foreground'
                  }`}
                  role="tab"
                  aria-selected={activeCategory === cat.id}
                >
                  {cat.label}
                </button>
              ))}
            </nav>
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
