'use client';

import { useEffect, useState } from 'react';

interface AppConfig {
  isProduction: boolean;
  adminUIEnabled: boolean;
  features: {
    search: boolean;
    qa: boolean;
    starred: boolean;
  };
}

const defaultConfig: AppConfig = {
  isProduction: true, // Assume production until we know otherwise
  adminUIEnabled: false,
  features: {
    search: true,
    qa: true,
    starred: false,
  },
};

export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch('/api/config');
        if (response.ok) {
          const data = await response.json();
          setConfig(data);
        }
      } catch {
        // On error, use safe defaults (production mode)
        console.warn('Failed to load app config, using safe defaults');
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  return { config, loading };
}
