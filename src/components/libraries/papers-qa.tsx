'use client';

import { useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Send, X } from 'lucide-react';

/**
 * Render markdown text with proper formatting
 * Handles bold (**text**), links, and line breaks
 */
function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  // Split by lines first to handle line breaks
  const lines = text.split('\n');

  return (
    <>
      {lines.map((line, lineIdx) => {
        // Split by ** to handle bold sections
        const parts = line.split(/(\*\*[^*]+\*\*)/g);

        const lineContent = (
          <>
            {parts.map((part, partIdx) => {
              // Check if this part is bold markdown
              if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
                const boldText = part.slice(2, -2);
                return (
                  <strong key={partIdx} className="font-semibold">
                    {boldText}
                  </strong>
                );
              }
              // Return regular text
              return part ? <span key={partIdx}>{part}</span> : null;
            })}
          </>
        );

        // Add line break except for last line
        return (
          <span key={lineIdx}>
            {lineContent}
            {lineIdx < lines.length - 1 && <br />}
          </span>
        );
      })}
    </>
  );
}

interface AskResponse {
  answer: string;
  sourcesUsed: number;
  papersUsed?: number;
  itemsUsed?: number;
  papersContext?: string;
  itemsContext?: string;
  citedPapers?: Array<{
    index: number;
    bibcode: string;
    title?: string;
    authors?: string;
    adsUrl?: string;
  }>;
  citedItems?: Array<{
    index: number;
    id: string;
    title?: string;
    url?: string;
    sourceTitle?: string;
  }>;
  allPapers?: Array<{
    bibcode: string;
    title?: string;
    authors?: string;
    adsUrl?: string;
  }>;
  allItems?: Array<{
    id: string;
    title?: string;
    url?: string;
    sourceTitle?: string;
  }>;
}

interface SelectedPaper {
  bibcode: string;
  title?: string;
}

interface SelectedItem {
  id: string;
  title?: string;
}

interface PapersQAProps {
  onPaperSelect?: (paper: SelectedPaper) => void;
  onLibrarySelect?: (library: Library) => void;
}

interface Library {
  id: string;
  name: string;
  numPapers?: number;
  numItems?: number;
}

export const PapersQA = forwardRef<
  { 
    addPaper: (paper: SelectedPaper) => void; 
    addItem: (item: SelectedItem) => void;
    setSelectedLibrary: (library: Library) => void;
  },
  PapersQAProps
>(
  function PapersQA({ onPaperSelect: _onPaperSelect, onLibrarySelect: _onLibrarySelect }, ref) {
    const [question, setQuestion] = useState('');
    const [loading, setLoading] = useState(false);
    const [response, setResponse] = useState<AskResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedPapers, setSelectedPapers] = useState<SelectedPaper[]>([]);
    const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
    const [selectedLibraries, setSelectedLibraries] = useState<Library[]>([]);

    // Exposed method for adding papers from external components
    const addPaper = useCallback(
      (paper: SelectedPaper) => {
        setSelectedPapers((prev) => {
          // Avoid duplicates
          if (!prev.some(p => p.bibcode === paper.bibcode)) {
            return [...prev, paper];
          }
          return prev;
        });
      },
      []
    );

    // Exposed method for adding items from external components
    const addItem = useCallback(
      (item: SelectedItem) => {
        setSelectedItems((prev) => {
          // Avoid duplicates
          if (!prev.some(i => i.id === item.id)) {
            return [...prev, item];
          }
          return prev;
        });
      },
      []
    );

    const addLibrary = useCallback(
      (library: Library) => {
        setSelectedLibraries((prev) => {
          // Avoid duplicates
          if (!prev.some(l => l.id === library.id)) {
            return [...prev, library];
          }
          return prev;
        });
      },
      []
    );

    useImperativeHandle(ref, () => ({ addPaper, addItem, setSelectedLibrary: addLibrary }), [addPaper, addItem, addLibrary]);

  const handleAsk = async () => {
    if (!question.trim()) return;

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const payload: Record<string, unknown> = { question };

      // Add papers if selected
      if (selectedPapers.length > 0) {
        payload.selectedBibcodes = selectedPapers.map(p => p.bibcode);
      }

      // Add items if selected
      if (selectedItems.length > 0) {
        payload.selectedItemIds = selectedItems.map(i => i.id);
      }

      // Add libraries if selected (can be research or resource libraries)
      if (selectedLibraries.length > 0) {
        const researchLibraryIds: string[] = [];
        const resourceLibraryIds: string[] = [];
        
        selectedLibraries.forEach(lib => {
          if (lib.id === 'saved-items' || lib.id === 'digest-items') {
            resourceLibraryIds.push(lib.id);
          } else {
            researchLibraryIds.push(lib.id);
          }
        });

        if (researchLibraryIds.length > 0) {
          payload.libraryIds = researchLibraryIds;
        }
        if (resourceLibraryIds.length > 0) {
          payload.resourceLibraryIds = resourceLibraryIds;
        }
      }

      const res = await fetch('/api/resources/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        const errorMsg = errorData.error || 'Failed to get answer';
        throw new Error(errorMsg);
      }

      const data = (await res.json()) as AskResponse;
      setResponse(data);
      setQuestion('');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      console.error('Error asking question:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-surface-border rounded-lg bg-surface p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold mb-2">Chat with Resources</h2>
        <p className="text-sm text-muted">
          Ask questions about papers and resources in your libraries. Select specific papers or items, an entire library, or search all cached content.
        </p>
      </div>

      {/* Selected Libraries */}
      {selectedLibraries.length > 0 && (
        <div className="bg-gray-50 border border-gray-400/30 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700">Libraries in Context ({selectedLibraries.length})</p>
          <div className="space-y-2">
            {selectedLibraries.map((library) => (
              <div key={library.id} className="flex items-center justify-between bg-gray-50 border border-gray-400/50 rounded px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-600">{library.name}</p>
                  <p className="text-xs text-gray-700">
                    {library.numPapers !== undefined && `${library.numPapers} papers`}
                    {library.numItems !== undefined && `${library.numItems} items`}
                    {library.numPapers === undefined && library.numItems === undefined && '0 items'}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedLibraries(selectedLibraries.filter(l => l.id !== library.id))}
                  className="hover:text-gray-500"
                  title="Remove library"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setSelectedLibraries([])}
            className="text-xs text-gray-700 hover:text-gray-600 underline"
          >
            Clear all libraries
          </button>
        </div>
      )}

      {/* Selected Papers */}
      {selectedPapers.length > 0 && selectedLibraries.length === 0 && (
        <div className="bg-gray-50 border border-gray-400/30 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700">Selected Papers ({selectedPapers.length})</p>
          <div className="flex flex-wrap gap-2">
            {selectedPapers.map((paper) => (
              <div
                key={paper.bibcode}
                className="flex items-center gap-2 bg-gray-50 border border-gray-400/50 rounded px-2 py-1 text-xs text-gray-600"
              >
                <span className="font-mono">{paper.bibcode}</span>
                <button
                  onClick={() => setSelectedPapers(selectedPapers.filter(p => p.bibcode !== paper.bibcode))}
                  className="hover:text-gray-500"
                  title="Remove paper"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setSelectedPapers([])}
            className="text-xs text-gray-700 hover:text-gray-600 underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Selected Items */}
      {selectedItems.length > 0 && selectedLibraries.length === 0 && selectedPapers.length === 0 && (
        <div className="bg-gray-50 border border-gray-400/30 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700">Selected Items ({selectedItems.length})</p>
          <div className="flex flex-wrap gap-2">
            {selectedItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 bg-gray-50 border border-gray-400/50 rounded px-2 py-1 text-xs text-gray-600"
              >
                <span className="truncate max-w-[200px]">{item.title || item.id}</span>
                <button
                  onClick={() => setSelectedItems(selectedItems.filter(i => i.id !== item.id))}
                  className="hover:text-gray-500"
                  title="Remove item"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setSelectedItems([])}
            className="text-xs text-gray-700 hover:text-gray-600 underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !loading && handleAsk()}
          placeholder="Ask a question about papers and resources..."
          className="flex-1 px-4 py-2 rounded-lg bg-surface-border/30 border border-surface-border text-foreground placeholder:text-muted focus:outline-none focus:border-gray-400"
          disabled={loading}
        />
        <button
          onClick={handleAsk}
          disabled={loading || !question.trim()}
          className="px-4 py-2 rounded-lg bg-black hover:bg-gray-800 disabled:bg-surface-border disabled:text-muted disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center gap-2"
        >
          <Send className="w-4 h-4" />
          Ask
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="border border-red-300/50 bg-red-50 rounded-lg p-4 text-red-900 text-sm">
          {error}
        </div>
      )}

      {/* Response */}
      {response && (
        <div className="space-y-4">
          <div className="bg-gray-50 border border-gray-400/30 rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-gray-600">Answer</h3>
            <div className="text-sm text-muted leading-relaxed whitespace-pre-wrap">
              {renderMarkdown(response.answer)}
            </div>
            <p className="text-xs text-muted mt-2">
              Based on {response.sourcesUsed || 0} {response.sourcesUsed === 1 ? 'source' : 'sources'} 
              {response.papersUsed !== undefined && response.itemsUsed !== undefined && (
                <> ({response.papersUsed} {response.papersUsed === 1 ? 'paper' : 'papers'}, {response.itemsUsed} {response.itemsUsed === 1 ? 'item' : 'items'})</>
              )}
              {response.papersUsed !== undefined && response.itemsUsed === undefined && (
                <> ({response.papersUsed} {response.papersUsed === 1 ? 'paper' : 'papers'})</>
              )}
              {response.itemsUsed !== undefined && response.papersUsed === undefined && (
                <> ({response.itemsUsed} {response.itemsUsed === 1 ? 'item' : 'items'})</>
              )}
            </p>
          </div>

          {/* Cited Papers */}
          {response.citedPapers && response.citedPapers.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground">Papers Cited in Answer</h4>
              <div className="space-y-2">
                {response.citedPapers.map((paper) => (
                  <a
                    key={paper.bibcode}
                    href={paper.adsUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-3 rounded-lg border border-surface-border hover:border-gray-400 hover:bg-gray-50 transition-colors group"
                  >
                    <span className="text-xs font-semibold text-foreground bg-gray-100 border border-gray-300 rounded px-2 py-1 shrink-0 mt-0.5">
                      [Paper {paper.index}]
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground group-hover:text-black line-clamp-2 block">
                        {paper.title || 'No title available'}
                      </span>
                      {paper.authors && (
                        <span className="text-xs text-muted mt-1 block">
                          {paper.authors}
                        </span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Cited Items */}
          {response.citedItems && response.citedItems.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-foreground">Resources Cited in Answer</h4>
              <div className="space-y-2">
                {response.citedItems.map((item) => (
                  <a
                    key={item.id}
                    href={item.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-3 rounded-lg border border-surface-border hover:border-gray-400 hover:bg-gray-50 transition-colors group"
                  >
                    <span className="text-xs font-semibold text-foreground bg-gray-100 border border-gray-300 rounded px-2 py-1 shrink-0 mt-0.5">
                      [Item {item.index}]
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground group-hover:text-black line-clamp-2 block">
                        {item.title || 'No title available'}
                      </span>
                      {item.sourceTitle && (
                        <span className="text-xs text-muted mt-1 block">
                          {item.sourceTitle}
                        </span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* All Source Papers */}
          {response.allPapers && response.allPapers.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted">All Source Papers</h4>
              <div className="space-y-2">
                {response.allPapers.map((paper) => (
                  <a
                    key={paper.bibcode}
                    href={paper.adsUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-3 rounded-lg border border-surface-border hover:border-gray-400/50 hover:bg-surface-border/20 transition-colors group"
                  >
                    <span className="text-xs text-muted font-mono shrink-0 mt-0.5">
                      {paper.bibcode}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-700 group-hover:text-gray-600 line-clamp-2 block">
                        {paper.title || 'No title available'}
                      </span>
                      {paper.authors && (
                        <span className="text-xs text-muted mt-1 block">
                          {paper.authors}
                        </span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* All Source Items */}
          {response.allItems && response.allItems.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted">All Source Resources</h4>
              <div className="space-y-2">
                {response.allItems.map((item) => (
                  <a
                    key={item.id}
                    href={item.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-3 rounded-lg border border-surface-border hover:border-gray-400/50 hover:bg-surface-border/20 transition-colors group"
                  >
                    <span className="text-xs text-muted font-mono shrink-0 mt-0.5">
                      {item.id.substring(0, 20)}...
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-700 group-hover:text-gray-600 line-clamp-2 block">
                        {item.title || 'No title available'}
                      </span>
                      {item.sourceTitle && (
                        <span className="text-xs text-muted mt-1 block">
                          {item.sourceTitle}
                        </span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 justify-center py-4">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400" />
          <span className="text-sm text-muted">Searching resources and generating answer...</span>
        </div>
      )}
    </div>
  );
  }
);
