'use client';

import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Plus, BookOpen, FileText, Tag, Bookmark } from 'lucide-react';
import { PaperReaderModal } from './paper-reader-modal';

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
  const [expandedLibrary, setExpandedLibrary] = useState<string | null>(null);
  const [libraryData, setLibraryData] = useState<Record<string, LibrariesResponse>>({});
  const [loadingLibraries, setLoadingLibraries] = useState<Set<string>>(new Set());
  const [processingBibcode, setProcessingBibcode] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});

  // Reader modal state
  const [readerOpen, setReaderOpen] = useState(false);
  const [readerBibcode, setReaderBibcode] = useState<string | null>(null);
  const [readerTitle, setReaderTitle] = useState<string | undefined>();

  // Get all papers in current library for navigation
  const getCurrentLibraryPapers = useCallback(() => {
    if (!expandedLibrary || !libraryData[expandedLibrary]) return [];
    return libraryData[expandedLibrary].items;
  }, [expandedLibrary, libraryData]);

  // Open reader for a paper
  const openReader = (bibcode: string, title?: string) => {
    setReaderBibcode(bibcode);
    setReaderTitle(title);
    setReaderOpen(true);
  };

  // Navigate to previous/next paper
  const navigatePaper = (direction: 'prev' | 'next') => {
    const papers = getCurrentLibraryPapers();
    const currentIndex = papers.findIndex((p) => p.bibcode === readerBibcode);
    if (currentIndex === -1) return;

    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < papers.length) {
      const paper = papers[newIndex];
      setReaderBibcode(paper.bibcode);
      setReaderTitle(paper.title);
    }
  };

  // Check if navigation is available
  const getNavigationState = () => {
    const papers = getCurrentLibraryPapers();
    const currentIndex = papers.findIndex((p) => p.bibcode === readerBibcode);
    return {
      hasPrevious: currentIndex > 0,
      hasNext: currentIndex < papers.length - 1,
    };
  };

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

  // Fetch papers for a specific library (with pagination to load all items)
  const fetchLibraryItems = async (libraryName: string, offset = 0) => {
    // Mark library as loading
    setLoadingLibraries((prev) => new Set(prev).add(libraryName));

    try {
      const rowsPerPage = 50;
      let allItems: LibraryItemMetadata[] = [];
      let currentOffset = offset;
      let hasMore = true;
      let libraryInfo: Library | null = null;

      // Fetch all pages until we have all items
      while (hasMore) {
        const response = await fetch(
          `/api/libraries?library=${encodeURIComponent(libraryName)}&start=${currentOffset}&rows=${rowsPerPage}&metadata=true`,
        );
        if (!response.ok) {
          const errorData = (await response.json()) as LibrariesError;
          throw new Error(errorData.error || 'Failed to fetch library');
        }
        const result = (await response.json()) as LibrariesResponse;

        // Store library info from first page
        if (!libraryInfo) {
          libraryInfo = result.library;
        }

        // Accumulate items
        allItems = [...allItems, ...result.items];

        // Check if there are more pages
        hasMore = result.pagination.hasMore;
        currentOffset = result.pagination.start + result.pagination.rows;
      }

      // Update state with all items
      setLibraryData((prev) => ({
        ...prev,
        [libraryName]: {
          library: libraryInfo!,
          items: allItems,
          pagination: {
            start: 0,
            rows: allItems.length,
            total: allItems.length,
            hasMore: false,
          },
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      // Remove library from loading set
      setLoadingLibraries((prev) => {
        const next = new Set(prev);
        next.delete(libraryName);
        return next;
      });
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

  // Fetch bookmarked papers
  const fetchBookmarkedPapers = useCallback(async () => {
    try {
      const response = await fetch('/api/papers/favorites');
      if (response.ok) {
        const data = await response.json();
        const bibcodes = data.bibcodes || [];

        // Fetch paper details for each bibcode
        const papers = await Promise.all(
          bibcodes.map(async (bibcode: string) => {
            try {
              // First try to get paper metadata from the paper API endpoint
              const paperResponse = await fetch(`/api/papers/${encodeURIComponent(bibcode)}`);
              if (paperResponse.ok) {
                const paperData = await paperResponse.json();
                if (paperData.title) {
                  return {
                    bibcode,
                    title: paperData.title,
                    authors: paperData.authors,
                    pubdate: paperData.pubdate,
                    abstract: paperData.abstract,
                    adsUrl: paperData.adsUrl,
                    arxivUrl: paperData.arxivUrl,
                  };
                }
              }

              // Fallback: try content API (might have title from parsed HTML)
              const contentResponse = await fetch(`/api/papers/${encodeURIComponent(bibcode)}/content`);
              if (contentResponse.ok) {
                const contentData = await contentResponse.json();
                if (contentData.title) {
                  return {
                    bibcode,
                    title: contentData.title,
                    authors: contentData.authors,
                    pubdate: undefined,
                    abstract: contentData.abstract,
                    adsUrl: contentData.adsUrl,
                    arxivUrl: contentData.arxivUrl,
                  };
                }
              }
            } catch (err) {
              console.error(`Failed to fetch paper ${bibcode}:`, err);
            }
            return {
              bibcode,
              title: undefined,
              adsUrl: `https://ui.adsabs.harvard.edu/abs/${bibcode}`,
            };
          })
        );

        return {
          library: {
            id: 'bookmarked',
            name: 'Bookmarked',
            numPapers: papers.length,
            description: 'Your saved papers for reading later',
          },
          items: papers,
          pagination: {
            start: 0,
            rows: papers.length,
            total: papers.length,
            hasMore: false,
          },
        };
      }
    } catch (err) {
      console.error('Failed to fetch bookmarked papers:', err);
    }
    return null;
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        await fetchAllLibraries();
        // Also fetch bookmarked papers
        const bookmarked = await fetchBookmarkedPapers();
        if (bookmarked) {
          setLibraryData(prev => ({
            ...prev,
            'Bookmarked': bookmarked,
          }));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [fetchBookmarkedPapers]);

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

  // Get bookmarked library if it exists
  const bookmarkedLibrary = libraryData['Bookmarked'];
  const hasBookmarked = bookmarkedLibrary && bookmarkedLibrary.items.length > 0;

  return (
    <div className="space-y-4">
      {/* Bookmarked Library - Show first if it exists */}
      {hasBookmarked && (
        <div className="border border-yellow-300 rounded-lg overflow-hidden bg-yellow-50/30">
          <div className="flex items-center justify-between p-4 hover:bg-yellow-50/50 transition-colors group">
            <button
              onClick={() => handleLibraryClick('Bookmarked')}
              className="flex items-center gap-3 flex-1 text-left"
            >
              {expandedLibrary === 'Bookmarked' ? (
                <ChevronDown className="w-5 h-5 text-black flex-shrink-0" />
              ) : (
                <ChevronRight className="w-5 h-5 text-black flex-shrink-0" />
              )}
              <BookOpen className="w-5 h-5 text-yellow-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-black">Bookmarked</h3>
                <p className="text-sm text-muted mt-0.5">
                  {bookmarkedLibrary.items.length} saved {bookmarkedLibrary.items.length === 1 ? 'paper' : 'papers'}
                </p>
              </div>
            </button>
            {onSelectLibraryForQA && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectLibraryForQA({
                    id: 'bookmarked',
                    name: 'Bookmarked',
                    numPapers: bookmarkedLibrary.items.length,
                  });
                }}
                className="px-3 py-1.5 text-sm bg-black text-white rounded hover:bg-gray-800 transition-colors"
              >
                Use for Q&A
              </button>
            )}
          </div>

          {expandedLibrary === 'Bookmarked' && (
            <div className="border-t border-yellow-300 p-4 bg-white">
              <div className="space-y-2">
                {bookmarkedLibrary.items.map((item) => (
                  <div
                    key={item.bibcode}
                    className="flex items-start justify-between p-3 border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => openReader(item.bibcode, item.title)}
                        className="text-left w-full"
                      >
                        <h4 className="font-medium text-black hover:text-gray-700 transition-colors line-clamp-2">
                          {item.title || item.bibcode}
                        </h4>
                        {item.authors && item.authors.length > 0 && (
                          <p className="text-sm text-muted mt-1">
                            {item.authors.slice(0, 3).join(', ')}
                            {item.authors.length > 3 && ' et al.'}
                          </p>
                        )}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const response = await fetch('/api/papers/favorites', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ bibcode: item.bibcode, favorite: false }),
                            });
                            if (response.ok) {
                              // Refresh bookmarked papers
                              const updated = await fetchBookmarkedPapers();
                              if (updated) {
                                setLibraryData(prev => ({
                                  ...prev,
                                  'Bookmarked': updated,
                                }));
                                if (expandedLibrary === 'Bookmarked') {
                                  setExpandedLibrary(null);
                                  setTimeout(() => setExpandedLibrary('Bookmarked'), 100);
                                }
                              }
                            }
                          } catch (err) {
                            console.error('Failed to remove bookmark:', err);
                          }
                        }}
                        className="p-1.5 text-yellow-600 hover:text-yellow-700 hover:bg-yellow-100 rounded transition-colors"
                        title="Remove bookmark"
                      >
                        <Bookmark className="w-4 h-4 fill-current" />
                      </button>
                      {onAddPaperToQA && (
                        <button
                          onClick={() => onAddPaperToQA({ bibcode: item.bibcode, title: item.title })}
                          className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100"
                          title="Add to Q&A"
                        >
                          Add
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Libraries List */}
      <div className="space-y-2">
        {allLibraries.map((lib) => {
          const isExpanded = expandedLibrary === lib.name;
          const data = libraryData[lib.name];
          const items = data?.items || [];
          const cleanName = lib.name.replace(/^My ADS library\s*/i, '');
          const cleanDescription = lib.description?.replace(/^My ADS library\s*/i, '');

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
                    <h3 className="font-semibold text-lg">{cleanName}</h3>
                    <p className="text-xs text-muted mt-0.5">
                      {lib.numPapers} papers{cleanDescription && ` • ${cleanDescription}`}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onSelectLibraryForQA?.({ id: lib.id, name: lib.name, numPapers: lib.numPapers })}
                    title="Add all papers from this library to Q&A context"
                    className="text-xs px-2 py-1 rounded bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors whitespace-nowrap flex items-center gap-1"
                  >
                    <BookOpen className="w-3 h-3" />
                    Add Library to Context
                  </button>
                  <span className="text-xs px-2 py-1 rounded bg-surface-border/30 text-muted">
                    {lib.numPapers}
                  </span>
                </div>
              </div>

              {/* Papers List */}
              {isExpanded && (
                <div className="border-t border-surface-border/50 p-4 space-y-3 bg-surface-border/5">
                  {loadingLibraries.has(lib.name) ? (
                    <div className="flex justify-center py-4">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400" />
                      <span className="ml-2 text-sm text-muted">Loading papers...</span>
                    </div>
                  ) : data ? (
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
                                      onClick={async () => {
                                        try {
                                          // Check if already favorited
                                          const checkResponse = await fetch(`/api/papers/${encodeURIComponent(item.bibcode)}/favorite`);
                                          const isFavorite = checkResponse.ok ? (await checkResponse.json()).isFavorite : false;

                                          const response = await fetch('/api/papers/favorites', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ bibcode: item.bibcode, favorite: !isFavorite }),
                                          });
                                          if (response.ok) {
                                            // Trigger section processing if favoriting (not unfavoriting)
                                            if (!isFavorite) {
                                              // Process sections in background
                                              fetch(`/api/papers/${encodeURIComponent(item.bibcode)}/process-sections`, {
                                                method: 'POST',
                                              }).catch(err => console.error('Failed to trigger section processing:', err));
                                            }
                                            // Refresh bookmarked papers
                                            const updated = await fetchBookmarkedPapers();
                                            if (updated) {
                                              setLibraryData(prev => ({
                                                ...prev,
                                                'Bookmarked': updated,
                                              }));
                                            }
                                          }
                                        } catch (err) {
                                          console.error('Failed to toggle bookmark:', err);
                                        }
                                      }}
                                      title="Bookmark paper"
                                      className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded transition-colors"
                                    >
                                      <Bookmark className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => openReader(item.bibcode, item.title)}
                                      title="Open in reader"
                                      className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors whitespace-nowrap flex items-center gap-1"
                                    >
                                      <FileText className="w-3 h-3" />
                                      Read
                                    </button>
                                    {onAddPaperToQA && (
                                      <button
                                        onClick={() => onAddPaperToQA?.({ bibcode: item.bibcode, title: item.title })}
                                        title="Add to Q&A context"
                                        className="text-xs px-2 py-1 rounded bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors whitespace-nowrap"
                                      >
                                        <Plus className="w-3 h-3 inline mr-1" />
                                        Add
                                      </button>
                                    )}
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

      {/* Paper Reader Modal */}
      {readerOpen && readerBibcode && (
        <PaperReaderModal
          bibcode={readerBibcode}
          title={readerTitle}
          onClose={() => setReaderOpen(false)}
          onPrevious={() => navigatePaper('prev')}
          onNext={() => navigatePaper('next')}
          hasPrevious={getNavigationState().hasPrevious}
          hasNext={getNavigationState().hasNext}
        />
      )}
    </div>
  );
}
