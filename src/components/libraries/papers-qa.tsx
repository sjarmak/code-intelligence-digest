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
  papersUsed: number;
  papersContext: string;
  citedPapers: Array<{
    index: number;
    bibcode: string;
    title?: string;
    authors?: string;
    adsUrl?: string;
  }>;
  allPapers: Array<{
    bibcode: string;
    title?: string;
    authors?: string;
    adsUrl?: string;
  }>;
}

interface SelectedPaper {
  bibcode: string;
  title?: string;
}

interface PapersQAProps {
  onPaperSelect?: (paper: SelectedPaper) => void;
  onLibrarySelect?: (library: Library) => void;
}

interface Library {
  id: string;
  name: string;
  numPapers: number;
}

export const PapersQA = forwardRef<
  { addPaper: (paper: SelectedPaper) => void; setSelectedLibrary: (library: Library) => void },
  PapersQAProps
>(
  function PapersQA({ onPaperSelect: _onPaperSelect, onLibrarySelect: _onLibrarySelect }, ref) {
    const [question, setQuestion] = useState('');
    const [loading, setLoading] = useState(false);
    const [response, setResponse] = useState<AskResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedPapers, setSelectedPapers] = useState<SelectedPaper[]>([]);
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

    useImperativeHandle(ref, () => ({ addPaper, setSelectedLibrary: addLibrary }), [addPaper, addLibrary]);

  const handleAsk = async () => {
    if (!question.trim()) return;

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const payload: Record<string, unknown> = { question };

      if (selectedPapers.length > 0) {
        payload.selectedBibcodes = selectedPapers.map(p => p.bibcode);
      } else if (selectedLibraries.length > 0) {
        payload.libraryIds = selectedLibraries.map(l => l.id);
      }

      const res = await fetch('/api/papers/ask', {
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
        <h2 className="text-xl font-bold mb-2">Ask About Papers</h2>
        <p className="text-sm text-muted">
          Ask questions about papers in your libraries. Select specific papers, an entire library, or search all cached papers.
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
                  <p className="text-xs text-gray-700">{library.numPapers} papers</p>
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

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !loading && handleAsk()}
          placeholder="Ask a question about papers..."
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
              Based on {response.papersUsed} papers in your libraries
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
                    <span className="text-xs font-semibold text-foreground bg-gray-100 border border-gray-300 rounded px-2 py-1 flex-shrink-0 mt-0.5">
                      [{paper.index}]
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
                    <span className="text-xs text-muted font-mono flex-shrink-0 mt-0.5">
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
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 justify-center py-4">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400" />
          <span className="text-sm text-muted">Searching papers and generating answer...</span>
        </div>
      )}
    </div>
  );
  }
);
