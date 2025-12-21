'use client';

import { useState } from 'react';

type AdminTab = 'sources' | 'starred';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('sources');

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-surface-border sticky top-0 z-10 bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div>
            <h1 className="text-3xl font-bold">Relevance Tuning</h1>
            <p className="text-muted mt-2">
              Manage source relevance scores and curate starred items
            </p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-surface-border bg-surface sticky top-20 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-6" role="tablist">
            <button
              onClick={() => setActiveTab('sources')}
              className={`px-1 py-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'sources'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-muted hover:text-foreground'
              }`}
              role="tab"
              aria-selected={activeTab === 'sources'}
            >
              Sources
            </button>
            <button
              onClick={() => setActiveTab('starred')}
              className={`px-1 py-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'starred'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-muted hover:text-foreground'
              }`}
              role="tab"
              aria-selected={activeTab === 'starred'}
            >
              Starred Items
            </button>
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-4xl">
          <p className="text-muted">Admin panel</p>
        </div>
      </main>
    </div>
  );
}
