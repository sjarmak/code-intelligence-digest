'use client';

import { useEffect, useState } from 'react';

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
            <h4 className="font-semibold text-black mb-1">
              Item Relevance Tuning
            </h4>
            <p className="text-sm text-muted">
              Enable users to rate articles from 0-3 (Not Relevant to Highly Relevant).
              Ratings help improve the scoring algorithm. When enabled, a rating dropdown
              will appear on each resource card.
            </p>
          </div>

          <button
            onClick={() => handleToggleSetting('enableItemRelevanceTuning')}
            disabled={saving}
            className={`ml-4 flex-shrink-0 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              settings.enableItemRelevanceTuning
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-gray-300 hover:bg-gray-400 text-black'
            } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {settings.enableItemRelevanceTuning ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>

      {/* Feature Info */}
      <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
        <p className="text-sm text-blue-900">
          <strong>What this does:</strong> When enabled, each article card will show a 0-4 relevance
          rating dropdown with an optional notes field. These ratings help the system learn what
          types of content are most valuable to you.
        </p>
      </div>
    </div>
  );
}
