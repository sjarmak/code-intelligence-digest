'use client';

import { useState } from 'react';

export type ItemRelevanceRating = 0 | 1 | 2 | 3 | null;

const RATING_OPTIONS: Array<{
  value: ItemRelevanceRating;
  label: string;
  color: string;
}> = [
  { value: 0, label: 'Not Relevant', color: 'text-red-900' },
  { value: 1, label: 'Somewhat Relevant', color: 'text-gray-600' },
  { value: 2, label: 'Relevant', color: 'text-gray-700' },
  { value: 3, label: 'Highly Relevant', color: 'text-green-700' },
  { value: null, label: 'Clear rating', color: 'text-gray-500' },
];

interface ItemRelevanceBadgeProps {
  itemId: string;
  inoreaderItemId?: string;
  currentRating: ItemRelevanceRating;
  onRatingChange?: (itemId: string, rating: ItemRelevanceRating, notes?: string) => Promise<void>;
  starred?: boolean;
  categories?: string[];
  readOnly?: boolean; // If true, badge displays rating but doesn't allow editing
}

export default function ItemRelevanceBadge({
  itemId,
  inoreaderItemId,
  currentRating,
  onRatingChange,
  starred = false,
  categories = [],
  readOnly = false,
}: ItemRelevanceBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);

  const currentOption = RATING_OPTIONS.find((opt) => opt.value === currentRating);

  const handleRate = async (rating: ItemRelevanceRating) => {
    setLoading(true);

    try {
      if (onRatingChange) {
        // If parent provides callback, use it (preferred for state management)
        console.log('Calling onRatingChange', { itemId, rating, notes });
        await onRatingChange(itemId, rating, notes);
      } else if (inoreaderItemId) {
        // Fallback: direct API call if no callback provided
        console.log('Direct API call to rate item', { inoreaderItemId, rating, notes });
        const response = await fetch(
          `/api/admin/starred/${inoreaderItemId}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.NEXT_PUBLIC_ADMIN_API_TOKEN || ''}`,
            },
            body: JSON.stringify({ rating, notes: notes || undefined }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error: ${response.status} - ${errorText}`);
        }
      } else {
        throw new Error('No rating handler available (missing both onRatingChange callback and inoreaderItemId)');
      }

      // Reset UI state after successful rating
      setIsOpen(false);
      setNotes('');
      setShowNotes(false);
      console.log('Successfully rated item');
    } catch (err) {
      console.error('Error rating item:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert(`Failed to rate item: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (!readOnly && !loading) {
            setIsOpen(!isOpen);
          }
        }}
        disabled={loading || readOnly}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors border ${
          currentOption?.color || 'text-gray-500'
        } ${
          isOpen
            ? 'bg-blue-500 border-gray-400'
            : 'bg-gray-700 border-gray-600 hover:border-gray-500'
        } ${loading ? 'opacity-50 cursor-not-allowed' : ''} ${readOnly ? 'cursor-default opacity-70' : ''}`}
        title={`Rating: ${currentOption?.label || 'Unrated'}${readOnly ? ' (read-only)' : ''}`}
      >
        {/* Star icon */}
        <svg
          className={`w-3 h-3 ${
            starred ? 'fill-yellow-400 text-gray-700' : 'text-gray-500'
          }`}
          viewBox="0 0 24 24"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
        {currentOption?.label ? `${currentOption.label}` : 'Rate'}
      </button>

      {isOpen && !readOnly && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          {/* Dropdown menu */}
          <div className="absolute right-0 mt-2 w-56 bg-surface border border-surface-border rounded-lg shadow-lg z-50">
            <div className="p-3">
              {/* Category tags */}
              {categories && categories.length > 0 && (
                <div className="mb-2 pb-2 border-b border-surface-border">
                  <p className="text-xs text-muted mb-1">Categories:</p>
                  <div className="flex flex-wrap gap-1">
                    {categories.map((cat) => (
                      <span
                        key={cat}
                        className="inline-block px-2 py-0.5 bg-surface-border rounded text-xs text-muted"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Rating options */}
              <div className="space-y-1 mb-3">
                {RATING_OPTIONS.map((option) => (
                  <button
                    key={`${option.value}`}
                    onClick={() => handleRate(option.value)}
                    disabled={loading}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                      currentRating === option.value
                        ? 'bg-black text-white font-semibold'
                        : 'hover:bg-surface-border text-foreground'
                    } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className={option.color}>{option.label}</span>
                  </button>
                ))}
              </div>

              {/* Notes input */}
              <div className="border-t border-surface-border pt-2">
                <button
                  onClick={() => setShowNotes(!showNotes)}
                  className="text-xs text-black hover:text-gray-700 mb-1"
                >
                  {showNotes ? 'Hide notes' : 'Add notes'}
                </button>

                {showNotes && (
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Why is this relevant?"
                    className="w-full px-2 py-1 text-xs bg-surface-border border border-surface-border rounded text-foreground placeholder-muted focus:outline-none focus:border-gray-400"
                    rows={2}
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
