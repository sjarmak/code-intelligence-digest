'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { SyncDialog } from '@/src/components/admin/sync-dialog';
import SettingsPanel from '@/src/components/admin/settings-panel';
import { useAppConfig } from '@/src/hooks/useAppConfig';

type AdminTab = 'sources' | 'starred' | 'settings';

export default function AdminPage() {
  const { config, loading } = useAppConfig();
  const [activeTab, setActiveTab] = useState<AdminTab>('sources');

  // Redirect to home if admin UI is disabled (production)
  useEffect(() => {
    if (!loading && !config.adminUIEnabled) {
      window.location.href = '/';
    }
  }, [loading, config.adminUIEnabled]);

  // Show nothing while checking config or if admin disabled
  if (loading || !config.adminUIEnabled) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Header */}
      <header className="border-b border-surface-border sticky top-0 z-10 bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-4">
              <Link
                href="/"
                className="mt-1 p-1.5 rounded-md text-gray-600 hover:text-black hover:bg-gray-100 transition-colors"
                title="Back to main"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-3xl font-bold">Relevance Tuning</h1>
                <p className="text-muted mt-2">
                  Manage source relevance scores and curate starred items
                </p>
              </div>
            </div>
            <SyncDialog />
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
                  ? 'border-black text-black'
                  : 'border-transparent text-gray-600 hover:text-black'
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
                  ? 'border-black text-black'
                  : 'border-transparent text-gray-600 hover:text-black'
              }`}
              role="tab"
              aria-selected={activeTab === 'starred'}
            >
              Starred Items
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-1 py-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'settings'
                  ? 'border-black text-black'
                  : 'border-transparent text-gray-600 hover:text-black'
              }`}
              role="tab"
              aria-selected={activeTab === 'settings'}
            >
              Settings
            </button>
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-4xl">
          {activeTab === 'settings' && <SettingsPanel />}
          {activeTab === 'sources' && <p className="text-muted">Sources panel</p>}
          {activeTab === 'starred' && <p className="text-muted">Starred items panel</p>}
        </div>
      </main>
    </div>
  );
}
