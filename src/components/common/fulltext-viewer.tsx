'use client';

import { useState, useEffect } from 'react';
import { X, FileText } from 'lucide-react';

interface FullTextViewerProps {
  itemId: string;
  itemTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

export function FullTextViewer({ itemId, itemTitle, isOpen, onClose }: FullTextViewerProps) {
  const [fullText, setFullText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && itemId) {
      setLoading(true);
      setError(null);
      fetch(`/api/items/${encodeURIComponent(itemId)}/fulltext?include_content=true`)
        .then((res) => {
          if (!res.ok) {
            throw new Error('Failed to fetch full text');
          }
          return res.json();
        })
        .then((data) => {
          setFullText(data.text || null);
          if (!data.hasFullText) {
            setError('Full text not available for this item');
          }
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to load full text');
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setFullText(null);
      setError(null);
    }
  }, [isOpen, itemId]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-gray-600" />
            <div>
              <h2 className="text-lg font-semibold text-black">Full Text</h2>
              <p className="text-sm text-gray-600 mt-1 line-clamp-1">{itemTitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-gray-100 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="text-center py-12">
              <p className="text-muted">Loading full text...</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4">
              <p className="text-red-900 font-medium">Error</p>
              <p className="text-red-800 text-sm mt-1">{error}</p>
            </div>
          )}

          {!loading && !error && fullText && (
            <div className="prose prose-sm max-w-none">
              <div className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
                {fullText}
              </div>
            </div>
          )}

          {!loading && !error && !fullText && (
            <div className="text-center py-12">
              <p className="text-muted">Full text not available for this item</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800 transition-colors text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
