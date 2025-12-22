'use client';

import { useState } from 'react';

export type SourceRelevanceLevel = 0 | 1 | 2 | 3;

const RELEVANCE_OPTIONS: Array<{
  value: SourceRelevanceLevel;
  label: string;
  description: string;
  color: string;
}> = [
  { value: 0, label: 'Ignore', description: 'Filter out (0.0x)', color: 'text-red-900' },
  { value: 1, label: 'Neutral', description: 'No boost (1.0x)', color: 'text-gray-600' },
  { value: 2, label: 'Relevant', description: '1.3x boost', color: 'text-gray-700' },
  { value: 3, label: 'Highly Relevant', description: '1.6x boost', color: 'text-green-700' },
];

interface SourceRelevanceDropdownProps {
  streamId: string;
  sourceName: string;
  currentRelevance: number;
  onRelevanceChange?: (streamId: string, relevance: SourceRelevanceLevel) => Promise<void>;
}

export default function SourceRelevanceDropdown({
  streamId,
  sourceName,
  currentRelevance,
  onRelevanceChange,
}: SourceRelevanceDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentOption = RELEVANCE_OPTIONS.find((opt) => opt.value === currentRelevance);

  const handleChange = async (relevance: SourceRelevanceLevel) => {
    setLoading(true);
    setError(null);

    try {
      if (onRelevanceChange) {
        await onRelevanceChange(streamId, relevance);
      } else {
        // Default API call
        const response = await fetch('/api/admin/source-relevance', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_ADMIN_API_TOKEN || ''}`,
          },
          body: JSON.stringify({ streamId, relevance }),
        });

        if (!response.ok) {
          throw new Error('Failed to update source relevance');
        }
      }

      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
        className={`px-3 py-1 rounded text-sm font-medium transition-colors border ${
          currentOption?.color
        } ${
          isOpen
            ? 'bg-surface-border border-gray-400'
            : 'bg-surface border-surface-border hover:border-surface-focus'
        } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={`Current: ${currentOption?.label || 'Unknown'}`}
      >
        {currentOption?.label || '?'} {currentRelevance !== null && `(${currentRelevance})`}
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown menu */}
          <div className="absolute right-0 mt-2 w-48 bg-surface border border-surface-border rounded-lg shadow-lg z-50">
            <div className="p-2">
              {error && (
                <div className="text-xs text-red-900 mb-2 px-2 py-1 bg-red-50 rounded">
                  {error}
                </div>
              )}

              {RELEVANCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleChange(option.value)}
                  disabled={loading}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    currentRelevance === option.value
                      ? 'bg-black text-white font-semibold'
                      : 'hover:bg-surface-border text-foreground'
                  } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className={`font-semibold ${option.color}`}>{option.label}</div>
                  <div className="text-xs text-muted">{option.description}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
