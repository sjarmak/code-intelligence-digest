'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

type SyncStatus = 'idle' | 'loading' | 'success' | 'error';

interface SyncResult {
  success: boolean;
  itemsAdded: number;
  apiCallsUsed: number;
  categoriesProcessed: string[];
  error?: string;
}

export function SyncDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [days, setDays] = useState('3');
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [result, setResult] = useState<SyncResult | null>(null);

  const daysNum = parseInt(days, 10);
  const isValidDays = !isNaN(daysNum) && daysNum >= 1 && daysNum <= 30;

  async function handleSync() {
    if (!isValidDays) return;

    setStatus('loading');
    setResult(null);

    try {
      const response = await fetch(`/api/admin/sync-catchup?days=${daysNum}`, {
        method: 'POST',
      });

      const data = (await response.json()) as SyncResult;

      if (data.success) {
        setStatus('success');
        setResult(data);
      } else {
        setStatus('error');
        setResult(data);
      }
    } catch (error) {
      setStatus('error');
      setResult({
        success: false,
        itemsAdded: 0,
        apiCallsUsed: 0,
        categoriesProcessed: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  function handleOpenChange(open: boolean) {
    setIsOpen(open);
    if (!open) {
      // Reset when closing
      setTimeout(() => {
        setStatus('idle');
        setResult(null);
        setDays('3');
      }, 200);
    }
  }

  return (
    <div>
      <button
        onClick={() => handleOpenChange(true)}
        className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800 transition-colors text-sm font-medium"
      >
        Sync Content
      </button>

      {/* Modal Dialog */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full">
            {/* Header */}
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-black">
                Sync Recent Content
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Fetch items from the last N days
              </p>
            </div>

            {/* Content */}
            <div className="px-6 py-4">
              {status === 'idle' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-black mb-2">
                      Days to sync (1-30)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={days}
                        onChange={(e) => setDays(e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-black focus:outline-none focus:ring-2 focus:ring-black"
                        placeholder="3"
                      />
                      <span className="text-sm text-gray-600">days</span>
                    </div>
                    {!isValidDays && days !== '' && (
                      <p className="text-sm text-red-600 mt-1">
                        Must be between 1 and 30
                      </p>
                    )}
                  </div>

                  <div className="bg-gray-50 rounded-md p-3 text-sm text-gray-700">
                    <p className="font-medium text-gray-900 mb-1">
                      What this does:
                    </p>
                    <ul className="space-y-1 text-xs">
                      <li>• Fetches items published in the last {daysNum || '?'} days</li>
                      <li>• Merges with existing items (no duplicates)</li>
                      <li>• Costs 3-15 API calls depending on volume</li>
                      <li>• Good for bootstrap or catching up after outages</li>
                    </ul>
                  </div>
                </div>
              )}

              {status === 'loading' && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Loader2 className="w-8 h-8 text-black animate-spin" />
                  <p className="text-sm text-gray-600">Syncing...</p>
                </div>
              )}

              {status === 'success' && result && (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-black">Sync complete</p>
                      <p className="text-sm text-gray-600 mt-1">
                        Successfully synced items
                      </p>
                    </div>
                  </div>

                  <div className="bg-green-50 rounded-md p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-700">Items added:</span>
                      <span className="font-semibold text-black">
                        {result.itemsAdded}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-700">API calls used:</span>
                      <span className="font-semibold text-black">
                        {result.apiCallsUsed}
                      </span>
                    </div>
                    {result.categoriesProcessed.length > 0 && (
                      <div>
                        <span className="text-gray-700 block mb-1">
                          Categories:
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {result.categoriesProcessed.map((cat) => (
                            <span
                              key={cat}
                              className="inline-block bg-white text-black text-xs px-2 py-1 rounded border border-green-200"
                            >
                              {cat}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {status === 'error' && result && (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-black">Sync failed</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {result.error ||
                          'An error occurred during sync'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-2">
              <button
                onClick={() => handleOpenChange(false)}
                className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              >
                {status === 'idle' ? 'Cancel' : 'Close'}
              </button>
              {status === 'idle' && (
                <button
                  onClick={handleSync}
                  disabled={!isValidDays}
                  className="px-3 py-2 text-sm font-medium bg-black text-white rounded-md hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  Start Sync
                </button>
              )}
              {(status === 'success' || status === 'error') && (
                <button
                  onClick={() => {
                    setStatus('idle');
                    setResult(null);
                  }}
                  className="px-3 py-2 text-sm font-medium bg-black text-white rounded-md hover:bg-gray-800 transition-colors"
                >
                  Start Another
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
