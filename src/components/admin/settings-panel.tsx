'use client';

import { useEffect, useState } from 'react';
import { InfoIcon } from 'lucide-react';

interface Settings {
  enableItemRelevanceTuning: boolean;
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState<Settings>({
    enableItemRelevanceTuning: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/settings');
      if (!response.ok) {
        throw new Error('Failed to fetch settings');
      }

      const data = await response.json();
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSetting = async (key: keyof Settings) => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const newValue = !settings[key];
      const response = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          [key]: newValue,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update settings');
      }

      const data = await response.json();
      setSettings(data.settings);
      setSuccess(true);

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Feature Settings</h3>
        <p className="text-sm text-muted mb-6">
          Enable or disable features that affect how the digest works
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="text-sm text-red-900">Error: {error}</p>
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-3">
          <p className="text-sm text-green-900">Settings updated successfully</p>
        </div>
      )}

      {/* Item Relevance Tuning Setting */}
      <div className="border border-surface-border rounded-lg p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-black">
                Item Relevance Tuning
              </h4>
              <div className="group relative">
                <InfoIcon className="w-4 h-4 text-gray-500 cursor-help hover:text-gray-700 transition-colors" />
                <div className="invisible group-hover:visible absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 bg-gray-900 text-gray-100 text-sm rounded px-3 py-2 pointer-events-none whitespace-normal z-10">
                  When enabled, each article card will show a 0-4 relevance rating dropdown with an optional notes field. These ratings help the system learn what types of content are most valuable to you.
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted">
              Enable users to rate articles from 0-3 (Not Relevant to Highly Relevant).
              Ratings help improve the scoring algorithm.
            </p>
          </div>

          <button
            onClick={() => handleToggleSetting('enableItemRelevanceTuning')}
            disabled={saving}
            className={`ml-4 flex-shrink-0 relative inline-flex items-center h-8 w-14 rounded-full transition-colors ${
              settings.enableItemRelevanceTuning
                ? 'bg-green-600'
                : 'bg-gray-300'
            } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            role="switch"
            aria-checked={settings.enableItemRelevanceTuning}
          >
            <span
              className={`${
                settings.enableItemRelevanceTuning ? 'translate-x-7' : 'translate-x-1'
              } inline-block w-6 h-6 transform rounded-full bg-white transition-transform`}
            ></span>
          </button>
        </div>
      </div>

      {/* Embeddings Management */}
      <EmbeddingsPanel />
    </div>
  );
}

function EmbeddingsPanel() {
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message?: string; stats?: any; error?: string } | null>(null);

  const handleGenerateEmbeddings = async () => {
    setGenerating(true);
    setResult(null);

    try {
      const response = await fetch('/api/admin/populate-embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ skipExisting: true }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="border border-surface-border rounded-lg p-4">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-black">Embeddings Cache</h4>
            <div className="group relative">
              <InfoIcon className="w-4 h-4 text-gray-500 cursor-help hover:text-gray-700 transition-colors" />
              <div className="invisible group-hover:visible absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 bg-gray-900 text-gray-100 text-sm rounded px-3 py-2 pointer-events-none whitespace-normal z-10">
                Generate embeddings for all items to speed up search and Q&A. Embeddings are cached and reused. This may take a few minutes.
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
              </div>
            </div>
          </div>
          <p className="text-sm text-muted">
            Pre-generate embeddings for faster search performance. Only generates embeddings for items that don't have them yet.
          </p>
        </div>
      </div>

      {result && (
        <div className={`mb-4 rounded-lg border p-3 ${
          result.success
            ? 'border-green-300 bg-green-50'
            : 'border-red-300 bg-red-50'
        }`}>
          {result.success ? (
            <div>
              <p className="text-sm font-medium text-green-900">✅ {result.message}</p>
              {result.stats && (
                <div className="text-xs text-green-800 mt-2 space-y-1">
                  <div>Generated: {result.stats.generated}</div>
                  <div>Skipped: {result.stats.skipped}</div>
                  <div>Duration: {result.stats.duration}</div>
                  <div>Rate: {result.stats.rate}</div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-red-900">Error: {result.error || 'Failed to generate embeddings'}</p>
          )}
        </div>
      )}

      <button
        onClick={handleGenerateEmbeddings}
        disabled={generating}
        className="px-4 py-2 text-sm font-medium bg-black text-white rounded-md hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
      >
        {generating ? 'Generating Embeddings...' : 'Generate All Embeddings'}
      </button>
    </div>
  );
}
