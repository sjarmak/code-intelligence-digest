'use client';

import { useState } from 'react';
import SourcesPanel from '@/src/components/tuning/sources-panel';
import StarredItemsPanel from '@/src/components/tuning/starred-items-panel';

type AdminTab = 'sources' | 'starred';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('sources');
  const [adminToken, setAdminToken] = useState<string>('');
  const [showTokenInput, setShowTokenInput] = useState(true);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const handleTokenSubmit = async (token: string) => {
    if (!token) {
      setTokenError('Token is required');
      return;
    }

    try {
      // Test the token
      const response = await fetch('/api/admin/source-relevance', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok && response.status === 401) {
        setTokenError('Invalid token');
        return;
      }

      setAdminToken(token);
      setShowTokenInput(false);
      setTokenError(null);
    } catch (err) {
      setTokenError('Failed to verify token');
    }
  };

  const handleLogout = () => {
    setAdminToken('');
    setShowTokenInput(true);
    setTokenError(null);
  };

  if (showTokenInput) {
    return (
      <div className="min-h-screen bg-black text-white">
        <header className="border-b border-surface-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <h1 className="text-3xl font-bold">Relevance Tuning</h1>
            <p className="text-muted mt-2">
              Manage source relevance scores and curate starred items
            </p>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="max-w-md">
            <div className="rounded-lg border border-surface-border p-6 bg-surface">
              <h2 className="text-lg font-semibold mb-4">Admin Authentication</h2>
              <p className="text-sm text-muted mb-4">
                Enter your admin API token to access tuning controls.
              </p>

              <div className="space-y-3">
                <input
                  type="password"
                  placeholder="Paste your ADMIN_API_TOKEN here"
                  defaultValue=""
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleTokenSubmit(e.currentTarget.value);
                    }
                  }}
                  className="w-full px-3 py-2 rounded bg-surface-border border border-surface-border text-foreground placeholder-muted focus:outline-none focus:border-blue-500"
                />

                <button
                  onClick={(e) => {
                    const input = (e.currentTarget.parentElement?.querySelector(
                      'input'
                    ) as HTMLInputElement) || { value: '' };
                    handleTokenSubmit(input.value);
                  }}
                  className="w-full px-4 py-2 rounded font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  Sign In
                </button>
              </div>

              {tokenError && (
                <div className="mt-3 rounded-lg border border-red-900 bg-red-900/20 p-2">
                  <p className="text-xs text-red-400">{tokenError}</p>
                </div>
              )}

              <p className="text-xs text-muted mt-4">
                Token is stored in your browser session only and not saved anywhere.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-surface-border sticky top-0 z-10 bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Relevance Tuning</h1>
              <p className="text-muted mt-2">
                Manage source relevance scores and curate starred items
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded text-sm font-medium bg-surface border border-surface-border text-muted hover:text-foreground transition-colors"
            >
              Sign Out
            </button>
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
          {activeTab === 'sources' && <SourcesPanel adminToken={adminToken} />}
          {activeTab === 'starred' && <StarredItemsPanel adminToken={adminToken} />}
        </div>
      </main>
    </div>
  );
}
