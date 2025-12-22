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
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const response = await fetch('/api/admin/sync-48h', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.statusText}`);
      }

      const data = await response.json();
      setSyncMessage(`✓ Synced ${data.itemsAdded} items (${data.apiCallsUsed} API calls)`);
      setTimeout(() => setSyncMessage(null), 5000);
    } catch (error) {
      setSyncMessage(`✗ Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSyncing(false);
    }
  };

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
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Code Intelligence Digest</h1>
              <p className="text-muted mt-2">
                Daily, weekly, and monthly digests of code intelligence, tools, and AI agents
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2 flex-wrap items-start">
                <button
                   onClick={handleSync}
                   disabled={isSyncing}
                   className="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white"
                   title="Sync today's content from Inoreader"
                 >
                   {isSyncing ? 'Syncing...' : '↻ Sync'}
                 </button>
                 <a
                   href="/research"
                   className="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-white border border-gray-400 text-black hover:bg-gray-50"
                   title="View ADS research libraries"
                 >
                   Libraries
                 </a>
                 <a
                   href="/admin"
                   className="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-white border border-gray-400 text-black hover:bg-gray-50"
                   title="Manage relevance tuning"
                 >
                   Tuning
                 </a>
                <button
                   onClick={() => setPeriod('day')}
                   className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                     period === 'day'
                       ? 'bg-black text-white'
                       : 'bg-white border border-gray-400 text-black hover:bg-gray-50'
                   }`}
                 >
                   Daily
                 </button>
                 <button
                   onClick={() => setPeriod('week')}
                   className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                     period === 'week'
                       ? 'bg-black text-white'
                       : 'bg-white border border-gray-400 text-black hover:bg-gray-50'
                   }`}
                 >
                   Weekly
                 </button>
                 <button
                   onClick={() => setPeriod('month')}
                   className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                     period === 'month'
                       ? 'bg-black text-white'
                       : 'bg-white border border-gray-400 text-black hover:bg-gray-50'
                   }`}
                 >
                   Monthly
                 </button>
                 <button
                   onClick={() => setPeriod('all')}
                   className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                     period === 'all'
                       ? 'bg-black text-white'
                       : 'bg-white border border-gray-400 text-black hover:bg-gray-50'
                   }`}
                 >
                   All-time
                 </button>
              </div>
              <div className="flex gap-2 flex-wrap items-start">
                <a
                   href="/synthesis/podcast"
                   className="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-white border border-gray-400 text-black hover:bg-gray-50"
                   title="Generate podcast episodes"
                 >
                   Podcast Generator
                 </a>
                 <a
                   href="/synthesis/newsletter"
                   className="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-white border border-gray-400 text-black hover:bg-gray-50"
                   title="Generate newsletters"
                 >
                   Newsletter Generator
                 </a>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Sync Status Message */}
      {syncMessage && (
        <div className={`border-b px-4 py-2 text-sm font-medium text-center ${
          syncMessage.startsWith('✓')
            ? 'bg-green-100 border-green-300 text-green-900'
            : 'bg-red-100 border-red-300 text-red-900'
        }`}>
          {syncMessage}
        </div>
      )}

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
