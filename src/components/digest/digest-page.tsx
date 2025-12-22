'use client';

import { useEffect, useState } from 'react';
import DigestSummary from './digest-summary';
import DigestHighlights from './digest-highlights';
import DigestThemes from './digest-themes';

type Period = 'day' | 'week' | 'month';

interface DigestData {
  period: string;
  dateRange: { start: string; end: string };
  summary: string;
  themes: string[];
  itemCount: number;
  highlights: Record<string, Array<{
    id: string;
    title: string;
    url: string;
    sourceTitle: string;
    finalScore: number;
  }>>;
  generatedAt: string;
}

export default function DigestPage() {
  const [period, setPeriod] = useState<Period>('week');
  const [expandedLimits, setExpandedLimits] = useState<Record<string, number>>({});
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDigest = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/digest?period=${period}`);
        if (!res.ok) {
          throw new Error('Failed to fetch digest');
        }

        const data = await res.json();
        setDigest(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchDigest();
  }, [period]);

  const handleExpandCategory = (category: string) => {
    setExpandedLimits(prev => ({
      ...prev,
      [category]: (prev[category] || 10) === 10 ? 50 : 10
    }));
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-surface-border sticky top-0 z-10 bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Code Intelligence Digest</h1>
              <p className="text-muted mt-2">
                Weekly recap of key themes, highlights, and emerging trends
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPeriod('day')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  period === 'day'
                    ? 'bg-black text-white'
                    : 'bg-surface border border-surface-border text-muted hover:text-foreground'
                }`}
              >
                Daily
              </button>
              <button
                onClick={() => setPeriod('week')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  period === 'week'
                    ? 'bg-black text-white'
                    : 'bg-surface border border-surface-border text-muted hover:text-foreground'
                }`}
              >
                Weekly
              </button>
              <button
                onClick={() => setPeriod('month')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  period === 'month'
                    ? 'bg-black text-white'
                    : 'bg-surface border border-surface-border text-muted hover:text-foreground'
                }`}
              >
                Monthly
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && (
          <div className="text-center py-12 text-muted">
            Loading digest...
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-300/50 rounded-lg p-4 text-red-900">
            {error}
          </div>
        )}

        {digest && (
          <div className="space-y-8">
            {/* Summary */}
            <DigestSummary
              summary={digest.summary}
              dateRange={digest.dateRange}
              itemCount={digest.itemCount}
              generatedAt={digest.generatedAt}
            />

            {/* Themes */}
            {digest.themes.length > 0 && (
              <DigestThemes themes={digest.themes} />
            )}

            {/* Highlights */}
             <DigestHighlights 
               highlights={digest.highlights}
               expandedLimits={expandedLimits}
               onExpandCategory={handleExpandCategory}
             />
          </div>
        )}
      </main>
    </div>
  );
}
