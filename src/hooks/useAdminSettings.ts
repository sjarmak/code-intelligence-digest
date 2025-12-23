'use client';

import { useEffect, useState } from 'react';

interface Settings {
  enableItemRelevanceTuning: boolean;
}

export function useAdminSettings() {
  const [settings, setSettings] = useState<Settings>({
    enableItemRelevanceTuning: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/admin/settings');
        if (!response.ok) {
          throw new Error('Failed to load settings');
        }
        const data = await response.json();
        setSettings(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        // Default to disabled if fetch fails
        setSettings({ enableItemRelevanceTuning: false });
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  return { settings, loading, error };
}
