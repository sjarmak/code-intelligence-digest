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
        
        // First check if admin UI is enabled (production check)
        const configResponse = await fetch('/api/config');
        if (configResponse.ok) {
          const config = await configResponse.json();
          if (!config.adminUIEnabled) {
            // In production, always disable tuning
            setSettings({ enableItemRelevanceTuning: false });
            setLoading(false);
            return;
          }
        }
        
        // In dev, fetch actual settings
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
