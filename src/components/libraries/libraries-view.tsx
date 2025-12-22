'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, BookOpen } from 'lucide-react';

interface LibraryItemMetadata {
  bibcode: string;
  title?: string;
  authors?: string[];
  pubdate?: string;
  abstract?: string;
  adsUrl?: string;
  arxivUrl?: string | null;
}

interface Library {
  id: string;
  name: string;
  numPapers: number;
  description?: string;
  public?: boolean;
}

interface LibrariesResponse {
  library: Library;
  items: LibraryItemMetadata[];
  pagination: {
    start: number;
    rows: number;
    total: number;
    hasMore: boolean;
  };
}

interface AllLibrariesResponse {
  libraries: Library[];
}

interface LibrariesError {
  error: string;
}

interface LibrariesViewProps {
  onAddPaperToQA?: (paper: { bibcode: string; title?: string }) => void;
  onSelectLibraryForQA?: (library: { id: string; name: string; numPapers: number }) => void;
}

export function LibrariesView({ onAddPaperToQA, onSelectLibraryForQA }: LibrariesViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allLibraries, setAllLibraries] = useState<Library[]>([]);
  const [expandedLibrary, setExpandedLibrary] = useState<string | null>('Benchmarks');
  const [libraryData, setLibraryData] = useState<Record<string, LibrariesResponse>>({});
  const [processingBibcode, setProcessingBibcode] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});

  // Fetch all available libraries
  const fetchAllLibraries = async () => {
    try {
      const response = await fetch('/api/libraries', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to fetch libraries');
      const result = (await response.json()) as AllLibrariesResponse;
      setAllLibraries(result.libraries);
    } catch (err) {
      console.error('Failed to fetch libraries:', err);
    }
  };

  // Fetch papers for a specific library
  const fetchLibraryItems = async (libraryName: string, offset = 0) => {
    try {
      const response = await fetch(
        `/api/libraries?library=${encodeURIComponent(libraryName)}&start=${offset}&rows=50&metadata=true`,
      );
      if (!response.ok) {
        const errorData = (await response.json()) as LibrariesError;
        throw new Error(errorData.error || 'Failed to fetch library');
      }
      const result = (await response.json()) as LibrariesResponse;
      setLibraryData((prev) => ({
        ...prev,
        [libraryName]: result,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  // Generate summary for a paper
  const generateSummary = async (bibcode: string) => {
    setProcessingBibcode(bibcode);
    try {
      const response = await fetch(`/api/papers/${encodeURIComponent(bibcode)}/summarize`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string };
        throw new Error(errorData.error || 'Failed to generate summary');
      }
      const data = (await response.json()) as { summary: string };
      setSummaries((prev) => ({
        ...prev,
        [bibcode]: data.summary,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error generating summary');
      console.error('Error generating summary:', err);
    } finally {
      setProcessingBibcode(null);
    }
  };

  // Handle library expansion
  const handleLibraryClick = async (libraryName: string) => {
    if (expandedLibrary === libraryName) {
      setExpandedLibrary(null);
    } else {
      setExpandedLibrary(libraryName);
      // Fetch papers if not already cached
      if (!libraryData[libraryName]) {
        await fetchLibraryItems(libraryName);
      }
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        await fetchAllLibraries();
        // Fetch the default library
        await fetchLibraryItems('Benchmarks');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-red-300/50 bg-red-50 rounded-lg p-4">
        <p className="text-red-900">Error: {error}</p>
        <p className="text-sm text-red-800 mt-2">
          Make sure ADS_API_TOKEN is configured in your .env.local
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Libraries List */}
      <div className="space-y-2">
        {allLibraries.map((lib) => {
          const isExpanded = expandedLibrary === lib.name;
          const data = libraryData[lib.name];
          const items = data?.items || [];

          return (
            <div key={lib.id} className="border border-surface-border rounded-lg overflow-hidden bg-surface">
              {/* Library Header */}
              <div className="flex items-center justify-between p-4 hover:bg-surface-border/20 transition-colors group">
                <button
                  onClick={() => handleLibraryClick(lib.name)}
                  className="flex items-center gap-3 flex-1 text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-black flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted flex-shrink-0" />
                  )}
                  <div>
                    <h3 className="font-semibold text-lg">{lib.name}</h3>
                    <p className="text-xs text-muted mt-0.5">
                      {lib.numPapers} papers{lib.description && ` • ${lib.description}`}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onSelectLibraryForQA?.({ id: lib.id, name: lib.name, numPapers: lib.numPapers })}
                    title="Use all papers from this library for Q&A"
                    className="text-xs px-2 py-1 rounded bg-gray-50 text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap flex items-center gap-1"
                  >
                    <BookOpen className="w-3 h-3" />
                    Use Library
                  </button>
                  <span className="text-xs px-2 py-1 rounded bg-surface-border/30 text-muted">
                    {lib.numPapers}
                  </span>
                </div>
              </div>

              {/* Papers List */}
              {isExpanded && (
                <div className="border-t border-surface-border/50 p-4 space-y-3 bg-surface-border/5">
                  {data ? (
                    <>
                      {items.length > 0 ? (
                        items.map((item) => (
                          <div
                            key={item.bibcode}
                            className="border border-surface-border rounded-lg overflow-hidden bg-surface hover:border-gray-400/50 transition-colors"
                          >
                            <div className="p-4 pb-3">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  {item.title ? (
                                    <a
                                      href={item.arxivUrl || item.adsUrl || '#'}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-base font-semibold line-clamp-2 text-black hover:text-gray-700 transition-colors"
                                    >
                                      {item.title}
                                    </a>
                                  ) : (
                                    <a
                                      href={item.arxivUrl || item.adsUrl || '#'}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-base font-semibold line-clamp-2 text-black hover:text-gray-700 transition-colors font-mono"
                                    >
                                      {item.bibcode}
                                    </a>
                                  )}
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <p className="text-xs text-muted font-mono">
                                      {item.bibcode}
                                    </p>
                                    <div className="flex gap-1">
                                      {item.arxivUrl && (
                                        <a
                                          href={item.arxivUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-800 hover:bg-red-900/40 transition-colors"
                                          title="Open on arXiv"
                                        >
                                          arXiv
                                        </a>
                                      )}
                                      {item.adsUrl && (
                                        <a
                                          href={item.adsUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs px-2 py-0.5 rounded bg-gray-50 text-gray-700 hover:bg-gray-50 transition-colors"
                                          title="Open on ADS"
                                        >
                                          ADS
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                  {item.pubdate && (
                                    <span className="border border-surface-border px-2 py-1 rounded text-xs whitespace-nowrap bg-surface-border/30">
                                      {item.pubdate.substring(0, 4)}
                                    </span>
                                  )}
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => onAddPaperToQA?.({ bibcode: item.bibcode, title: item.title })}
                                      title="Add to Q&A context"
                                      className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-900/40 transition-colors whitespace-nowrap"
                                    >
                                      <Plus className="w-3 h-3 inline mr-1" />
                                      Add
                                    </button>
                                    <button
                                      onClick={() => generateSummary(item.bibcode)}
                                      disabled={processingBibcode === item.bibcode}
                                      className="text-xs px-2 py-1 rounded bg-gray-50 text-gray-700 hover:bg-purple-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                    >
                                      {processingBibcode === item.bibcode ? 'Summarizing...' : 'Summarize'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Summary Section */}
                            {summaries[item.bibcode] && (
                              <div className="px-4 py-3 bg-purple-900/10 border-t border-surface-border/50">
                                <p className="font-medium text-xs text-muted mb-2">Summary</p>
                                <p className="text-sm text-muted leading-relaxed">
                                  {summaries[item.bibcode]}
                                </p>
                              </div>
                            )}

                            {/* Paper Details */}
                            {(item.authors || item.abstract) && (
                              <div className="space-y-2 text-sm px-4 py-3 border-t border-surface-border/50">
                                {item.authors && item.authors.length > 0 && (
                                  <div>
                                    <p className="font-medium text-xs text-muted">Authors</p>
                                    <p className="text-muted line-clamp-2">
                                      {item.authors.slice(0, 3).join('; ')}
                                      {item.authors.length > 3 && ' et al.'}
                                    </p>
                                  </div>
                                )}
                                {item.abstract && (
                                  <div>
                                    <p className="font-medium text-xs text-muted">Abstract</p>
                                    <p className="text-muted line-clamp-3">
                                      {item.abstract}
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="text-center text-muted py-4">No papers in this library</div>
                      )}
                    </>
                  ) : (
                    <div className="flex justify-center py-4">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400" />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allLibraries.length === 0 && (
        <div className="border border-surface-border rounded-lg p-6 text-center text-muted bg-surface">
          No libraries found. Check your ADS_API_TOKEN configuration.
        </div>
      )}
    </div>
  );
}
