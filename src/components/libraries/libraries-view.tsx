'use client';

import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Plus, BookOpen, FileText, Bookmark, FolderHeart, FileHeart, Trash2, RefreshCw, AlertCircle, CheckSquare, Square, X } from 'lucide-react';
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
  const [refreshingBibcode, setRefreshingBibcode] = useState<string | null>(null);
  const [removingBibcode, setRemovingBibcode] = useState<string | null>(null);

  // Library status for saved/digest items
  const [itemIdMap, setItemIdMap] = useState<Map<string, string>>(new Map()); // bibcode -> itemId
  const [libraryStatus, setLibraryStatus] = useState<Map<string, { inSavedItems: boolean; inDigestItems: boolean }>>(new Map()); // itemId -> status
  const [libraryLoading, setLibraryLoading] = useState<Set<string>>(new Set()); // itemId -> loading

  // Reader modal state
  const [readerOpen, setReaderOpen] = useState(false);
  const [readerBibcode, setReaderBibcode] = useState<string | null>(null);
  const [readerTitle, setReaderTitle] = useState<string | undefined>();

  // Selection mode state for bulk add
  const [selectMode, setSelectMode] = useState(false);
  const [selectedBibcodes, setSelectedBibcodes] = useState<Set<string>>(new Set());
  const [bulkAdding, setBulkAdding] = useState(false);

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

      // Status lookups are non-critical; load them after papers render.
      warmLibraryStatusForPapers(allItems);
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

  // Find itemId for a paper by URL
  const findItemIdForPaper = useCallback(async (paper: LibraryItemMetadata): Promise<string | null> => {
    // Try arxivUrl first, then adsUrl
    const urls = [paper.arxivUrl, paper.adsUrl].filter(Boolean) as string[];

    for (const url of urls) {
      try {
        const response = await fetch(`/api/items/find-by-url?url=${encodeURIComponent(url)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.itemId) {
            return data.itemId;
          }
        }
      } catch (err) {
        console.error(`Failed to find itemId for ${url}:`, err);
      }
    }
    return null;
  }, []);

  // Load library status for papers
  const loadLibraryStatusForPapers = useCallback(async (papers: LibraryItemMetadata[]) => {
    const newItemIdMap = new Map<string, string>();
    const statusMap = new Map<string, { inSavedItems: boolean; inDigestItems: boolean }>();

    // Find itemIds for all papers
    const itemIdPromises = papers.map(async (paper) => {
      const itemId = await findItemIdForPaper(paper);
      if (itemId) {
        newItemIdMap.set(paper.bibcode, itemId);
        return { bibcode: paper.bibcode, itemId };
      }
      // Use bibcode as synthetic itemId if no feed item found
      return { bibcode: paper.bibcode, itemId: `ads:${paper.bibcode}` };
    });

    const itemIdResults = await Promise.all(itemIdPromises);

    // Load library status for all itemIds (both real and synthetic)
    const statusPromises = itemIdResults.map(async ({ itemId }) => {
      try {
        const response = await fetch(`/api/items/${encodeURIComponent(itemId)}/libraries`);
        if (response.ok) {
          const data = await response.json();
          statusMap.set(itemId, {
            inSavedItems: Boolean(data.inSavedItems),
            inDigestItems: Boolean(data.inDigestItems),
          });
        }
      } catch (err) {
        // For synthetic itemIds, the API might return 404, which is fine
        // Just set default status
        if (!itemId.startsWith('ads:')) {
          console.error(`Failed to load library status for ${itemId}:`, err);
        }
      }
    });

    await Promise.all(statusPromises);

    setItemIdMap((prev) => {
      const next = new Map(prev);
      itemIdResults.forEach(({ bibcode, itemId }) => {
        // Only store real itemIds in the map, not synthetic ones
        if (!itemId.startsWith('ads:')) {
          next.set(bibcode, itemId);
        }
      });
      return next;
    });
    setLibraryStatus((prev) => {
      const next = new Map(prev);
      statusMap.forEach((status, itemId) => next.set(itemId, status));
      return next;
    });
  }, [findItemIdForPaper]);

  const warmLibraryStatusForPapers = useCallback((papers: LibraryItemMetadata[]) => {
    void loadLibraryStatusForPapers(papers).catch((err) => {
      console.error('Failed to load library status for papers:', err);
    });
  }, [loadLibraryStatusForPapers]);

  // Get all visible papers in the currently expanded library
  const getVisiblePapers = useCallback(() => {
    if (!expandedLibrary || !libraryData[expandedLibrary]) return [];
    return libraryData[expandedLibrary].items;
  }, [expandedLibrary, libraryData]);

  // Toggle selection for a paper
  const handleToggleSelection = (bibcode: string) => {
    setSelectedBibcodes((prev) => {
      const next = new Set(prev);
      if (next.has(bibcode)) {
        next.delete(bibcode);
      } else {
        next.add(bibcode);
      }
      return next;
    });
  };

  // Select all papers in current library
  const handleSelectAll = () => {
    const papers = getVisiblePapers();
    setSelectedBibcodes(new Set(papers.map(p => p.bibcode)));
  };

  // Deselect all papers
  const handleDeselectAll = () => {
    setSelectedBibcodes(new Set());
  };

  // Toggle select mode
  const handleToggleSelectMode = () => {
    setSelectMode(!selectMode);
    if (selectMode) {
      setSelectedBibcodes(new Set());
    }
  };

  // Bulk add to digest items
  const handleBulkAddToDigest = async (bibcodes?: string[]) => {
    const targetBibcodes = bibcodes || Array.from(selectedBibcodes);
    if (targetBibcodes.length === 0) return;

    setBulkAdding(true);
    try {
      // Convert bibcodes to itemIds
      const itemIds = targetBibcodes.map(bibcode => itemIdMap.get(bibcode) || `ads:${bibcode}`);
      
      const response = await fetch('/api/digest-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds }),
      });

      if (!response.ok) {
        throw new Error('Failed to add items to digest');
      }

      const result = await response.json();
      
      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent('digest-items-changed'));
      
      // Reload library status for added papers
      const papers = getVisiblePapers().filter(p => targetBibcodes.includes(p.bibcode));
      await loadLibraryStatusForPapers(papers);
      
      // Clear selection after successful add
      if (!bibcodes) {
        setSelectedBibcodes(new Set());
        setSelectMode(false);
      }
      
      alert(`Added ${result.added || targetBibcodes.length} items to digest library`);
    } catch (error) {
      console.error('Failed to bulk add to digest:', error);
      alert('Failed to add items to digest library');
    } finally {
      setBulkAdding(false);
    }
  };

  // Bulk add to saved items
  const handleBulkAddToSaved = async (bibcodes?: string[]) => {
    const targetBibcodes = bibcodes || Array.from(selectedBibcodes);
    if (targetBibcodes.length === 0) return;

    setBulkAdding(true);
    try {
      // Convert bibcodes to itemIds
      const itemIds = targetBibcodes.map(bibcode => itemIdMap.get(bibcode) || `ads:${bibcode}`);
      
      const response = await fetch('/api/saved-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds }),
      });

      if (!response.ok) {
        throw new Error('Failed to add items to saved');
      }

      const result = await response.json();
      
      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent('saved-items-changed'));
      
      // Reload library status for added papers
      const papers = getVisiblePapers().filter(p => targetBibcodes.includes(p.bibcode));
      await loadLibraryStatusForPapers(papers);
      
      // Clear selection after successful add
      if (!bibcodes) {
        setSelectedBibcodes(new Set());
        setSelectMode(false);
      }
      
      alert(`Added ${result.added || targetBibcodes.length} items to saved library`);
    } catch (error) {
      console.error('Failed to bulk add to saved:', error);
      alert('Failed to add items to saved library');
    } finally {
      setBulkAdding(false);
    }
  };

  // Add all papers from current library
  const handleAddAllToDigest = () => {
    const papers = getVisiblePapers();
    if (papers.length === 0) return;
    
    if (!confirm(`Add all ${papers.length} papers from this library to Digest Items?`)) return;
    
    handleBulkAddToDigest(papers.map(p => p.bibcode));
  };

  const handleAddAllToSaved = () => {
    const papers = getVisiblePapers();
    if (papers.length === 0) return;
    
    if (!confirm(`Add all ${papers.length} papers from this library to Saved Items?`)) return;
    
    handleBulkAddToSaved(papers.map(p => p.bibcode));
  };

  // Toggle saved items
  const handleToggleSavedItems = async (bibcode: string) => {
    // Use existing itemId if found, otherwise use bibcode as synthetic itemId
    const itemId = itemIdMap.get(bibcode) || `ads:${bibcode}`;

    const status = libraryStatus.get(itemId);
    const inSavedItems = status?.inSavedItems || false;

    setLibraryLoading((prev) => new Set(prev).add(itemId));
    try {
      const method = inSavedItems ? 'DELETE' : 'POST';
      const response = await fetch(`/api/saved-items${method === 'DELETE' ? `?itemId=${encodeURIComponent(itemId)}` : ''}`, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
        body: method === 'POST' ? JSON.stringify({ itemId }) : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to toggle saved items');
      }

      // Dispatch custom event to notify other components
      window.dispatchEvent(new CustomEvent('saved-items-changed'));

      // Reload library status
      const libraryRes = await fetch(`/api/items/${encodeURIComponent(itemId)}/libraries`);
      if (libraryRes?.ok) {
        const libData = await libraryRes.json();
        setLibraryStatus((prev) => {
          const next = new Map(prev);
          next.set(itemId, {
            inSavedItems: Boolean(libData.inSavedItems),
            inDigestItems: Boolean(libData.inDigestItems),
          });
          return next;
        });
      } else {
        // Fallback to optimistic update
        setLibraryStatus((prev) => {
          const next = new Map(prev);
          const current = next.get(itemId) || { inSavedItems: false, inDigestItems: false };
          next.set(itemId, { ...current, inSavedItems: !inSavedItems });
          return next;
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error toggling saved items:', errorMessage);
      // Show user-friendly error
      alert(`Failed to add/remove from saved items: ${errorMessage}`);
    } finally {
      setLibraryLoading((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  // Toggle digest items
  const handleToggleDigestItems = async (bibcode: string) => {
    // Use existing itemId if found, otherwise use bibcode as synthetic itemId
    const itemId = itemIdMap.get(bibcode) || `ads:${bibcode}`;

    const status = libraryStatus.get(itemId);
    const inDigestItems = status?.inDigestItems || false;

    setLibraryLoading((prev) => new Set(prev).add(itemId));
    try {
      const method = inDigestItems ? 'DELETE' : 'POST';
      const response = await fetch(`/api/digest-items${method === 'DELETE' ? `?itemId=${encodeURIComponent(itemId)}` : ''}`, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
        body: method === 'POST' ? JSON.stringify({ itemId }) : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to toggle digest items');
      }

      // Dispatch custom event to notify other components
      window.dispatchEvent(new CustomEvent('digest-items-changed'));

      // Reload library status
      const libraryRes = await fetch(`/api/items/${encodeURIComponent(itemId)}/libraries`);
      if (libraryRes?.ok) {
        const libData = await libraryRes.json();
        setLibraryStatus((prev) => {
          const next = new Map(prev);
          next.set(itemId, {
            inSavedItems: Boolean(libData.inSavedItems),
            inDigestItems: Boolean(libData.inDigestItems),
          });
          return next;
        });
      } else {
        // Fallback to optimistic update
        setLibraryStatus((prev) => {
          const next = new Map(prev);
          const current = next.get(itemId) || { inSavedItems: false, inDigestItems: false };
          next.set(itemId, { ...current, inDigestItems: !inDigestItems });
          return next;
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error toggling digest items:', errorMessage);
      // Show user-friendly error
      alert(`Failed to add/remove from digest items: ${errorMessage}`);
    } finally {
      setLibraryLoading((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
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

        const result = {
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

        return result;
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
          // Load library status for bookmarked papers without blocking initial render.
          warmLibraryStatusForPapers(bookmarked.items);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [fetchBookmarkedPapers, warmLibraryStatusForPapers]);

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
      {/* Research Libraries Sub-header */}
      <div className="mb-4">
        <h3 className="text-xl font-semibold text-black">Research Libraries</h3>
        <p className="text-sm text-muted mt-1">
          Curated research papers from ADS/SciX libraries
        </p>
      </div>

      {/* Bookmarked Library - Show first if it exists */}
      {hasBookmarked && (
        <div className="border border-yellow-300 rounded-lg overflow-hidden bg-yellow-50/30">
          <div className="flex items-center justify-between p-4 hover:bg-yellow-50/50 transition-colors group">
            <button
              onClick={() => handleLibraryClick('Bookmarked')}
              className="flex items-center gap-3 flex-1 text-left"
            >
              {expandedLibrary === 'Bookmarked' ? (
                <ChevronDown className="w-5 h-5 text-black shrink-0" />
              ) : (
                <ChevronRight className="w-5 h-5 text-black shrink-0" />
              )}
              <BookOpen className="w-5 h-5 text-yellow-600 shrink-0" />
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
                title="Add all papers from this library to Q&A context"
                className="text-xs px-2 py-1 rounded bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors whitespace-nowrap flex items-center gap-1"
              >
                <BookOpen className="w-3 h-3" />
                Add Library to Context
              </button>
            )}
          </div>

          {expandedLibrary === 'Bookmarked' && (
            <div className="border-t border-yellow-300 p-4 bg-white">
              {/* Bulk action toolbar */}
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleSelectMode}
                    disabled={bulkAdding}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors rounded-md ${
                      selectMode
                        ? 'bg-blue-100 border border-blue-300 text-blue-700'
                        : 'bg-white border border-gray-300 text-black hover:bg-gray-50'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={selectMode ? 'Exit select mode' : 'Enter select mode'}
                  >
                    {selectMode ? <X className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
                    {selectMode ? 'Cancel' : 'Select'}
                  </button>
                  {selectMode && (
                    <>
                      <button
                        onClick={selectedBibcodes.size === bookmarkedLibrary.items.length ? handleDeselectAll : handleSelectAll}
                        disabled={bulkAdding}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-white border border-gray-300 text-black hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                      >
                        {selectedBibcodes.size === bookmarkedLibrary.items.length ? (
                          <><CheckSquare className="w-3.5 h-3.5" /> Deselect All</>
                        ) : (
                          <><Square className="w-3.5 h-3.5" /> Select All</>
                        )}
                      </button>
                      {selectedBibcodes.size > 0 && (
                        <>
                          <button
                            onClick={() => handleBulkAddToDigest()}
                            disabled={bulkAdding}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-purple-50 border border-purple-300 text-purple-700 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                            title="Add selected to digest items"
                          >
                            <FileHeart className="w-3.5 h-3.5" />
                            Add {selectedBibcodes.size} to Digest
                          </button>
                          <button
                            onClick={() => handleBulkAddToSaved()}
                            disabled={bulkAdding}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-yellow-50 border border-yellow-300 text-yellow-700 hover:bg-yellow-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                            title="Add selected to saved items"
                          >
                            <FolderHeart className="w-3.5 h-3.5" />
                            Add {selectedBibcodes.size} to Saved
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
                {!selectMode && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleAddAllToDigest}
                      disabled={bulkAdding || bookmarkedLibrary.items.length === 0}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-purple-50 border border-purple-300 text-purple-700 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                      title="Add all papers to digest items"
                    >
                      <FileHeart className="w-3.5 h-3.5" />
                      Add All to Digest
                    </button>
                    <button
                      onClick={handleAddAllToSaved}
                      disabled={bulkAdding || bookmarkedLibrary.items.length === 0}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-yellow-50 border border-yellow-300 text-yellow-700 hover:bg-yellow-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                      title="Add all papers to saved items"
                    >
                      <FolderHeart className="w-3.5 h-3.5" />
                      Add All to Saved
                    </button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {bookmarkedLibrary.items.map((item) => {
                  const hasNoTitle = !item.title || item.title === item.bibcode;
                  const isRefreshing = refreshingBibcode === item.bibcode;
                  const isRemoving = removingBibcode === item.bibcode;
                  const isSelected = selectedBibcodes.has(item.bibcode);
                  
                  return (
                  <div
                    key={item.bibcode}
                    className={`flex items-start justify-between p-3 border rounded-lg hover:bg-gray-50 transition-colors group ${
                      hasNoTitle ? 'border-amber-300 bg-amber-50/50' : isSelected ? 'border-blue-400 bg-blue-50/50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {selectMode && (
                      <button
                        onClick={() => handleToggleSelection(item.bibcode)}
                        className="mr-3 mt-1 flex-shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-5 h-5 text-blue-600" />
                        ) : (
                          <Square className="w-5 h-5 text-gray-400" />
                        )}
                      </button>
                    )}
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => selectMode ? handleToggleSelection(item.bibcode) : openReader(item.bibcode, item.title)}
                        className="text-left w-full"
                      >
                        {hasNoTitle && (
                          <div className="flex items-center gap-1.5 mb-1 text-amber-600">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span className="text-xs">Metadata may be incomplete - try refreshing</span>
                          </div>
                        )}
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
                    <div className="flex items-center gap-1.5 ml-4">
                      {/* Refresh metadata button */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          setRefreshingBibcode(item.bibcode);
                          try {
                            // Clear cache and refetch
                            await fetch(`/api/papers/${encodeURIComponent(item.bibcode)}/clear-cache`, {
                              method: 'POST',
                            });
                            // Trigger a refetch of metadata
                            await fetch(`/api/papers/${encodeURIComponent(item.bibcode)}`);
                            // Refresh the bookmarked list
                            const updated = await fetchBookmarkedPapers();
                            if (updated) {
                              setLibraryData(prev => ({
                                ...prev,
                                'Bookmarked': updated,
                              }));
                            }
                          } catch (err) {
                            console.error('Failed to refresh paper:', err);
                          } finally {
                            setRefreshingBibcode(null);
                          }
                        }}
                        disabled={isRefreshing}
                        className={`p-1.5 rounded transition-colors ${
                          isRefreshing
                            ? 'text-blue-400 animate-spin'
                            : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
                        }`}
                        title="Refresh paper metadata"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      {/* Saved items library button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSavedItems(item.bibcode);
                        }}
                        disabled={libraryLoading.has(itemIdMap.get(item.bibcode) || `ads:${item.bibcode}`)}
                        className={`p-1.5 rounded transition-colors ${
                          libraryStatus.get(itemIdMap.get(item.bibcode) || `ads:${item.bibcode}`)?.inSavedItems
                            ? 'text-yellow-600 bg-yellow-50'
                            : 'text-gray-400 hover:text-yellow-600 hover:bg-yellow-50'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        title={libraryStatus.get(itemIdMap.get(item.bibcode) || `ads:${item.bibcode}`)?.inSavedItems ? 'Remove from saved items' : 'Add to saved items'}
                      >
                        <FolderHeart className="w-4 h-4" />
                      </button>
                      {/* Digest items library button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleDigestItems(item.bibcode);
                        }}
                        disabled={libraryLoading.has(itemIdMap.get(item.bibcode) || `ads:${item.bibcode}`)}
                        className={`p-1.5 rounded transition-colors ${
                          libraryStatus.get(itemIdMap.get(item.bibcode) || `ads:${item.bibcode}`)?.inDigestItems
                            ? 'text-yellow-600 bg-yellow-50'
                            : 'text-gray-400 hover:text-yellow-600 hover:bg-yellow-50'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        title={libraryStatus.get(itemIdMap.get(item.bibcode) || `ads:${item.bibcode}`)?.inDigestItems ? 'Remove from digest items' : 'Add to digest items'}
                      >
                        <FileHeart className="w-4 h-4" />
                      </button>
                      {/* Remove from bookmarks button - more prominent */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (window.confirm(`Remove "${item.title || item.bibcode}" from bookmarks?`)) {
                            setRemovingBibcode(item.bibcode);
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
                                }
                              }
                            } catch (err) {
                              console.error('Failed to remove bookmark:', err);
                            } finally {
                              setRemovingBibcode(null);
                            }
                          }
                        }}
                        disabled={isRemoving}
                        className={`p-1.5 rounded transition-colors ${
                          isRemoving
                            ? 'text-red-400 opacity-50'
                            : 'text-red-500 hover:text-red-600 hover:bg-red-50'
                        }`}
                        title="Remove from bookmarks"
                      >
                        <Trash2 className="w-4 h-4" />
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
                  );
                })}
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
                    <ChevronDown className="w-5 h-5 text-black shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted shrink-0" />
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
                      {/* Bulk action toolbar */}
                      <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleToggleSelectMode}
                            disabled={bulkAdding}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors rounded-md ${
                              selectMode
                                ? 'bg-blue-100 border border-blue-300 text-blue-700'
                                : 'bg-white border border-gray-300 text-black hover:bg-gray-50'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                            title={selectMode ? 'Exit select mode' : 'Enter select mode'}
                          >
                            {selectMode ? <X className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
                            {selectMode ? 'Cancel' : 'Select'}
                          </button>
                          {selectMode && (
                            <>
                              <button
                                onClick={selectedBibcodes.size === items.length ? handleDeselectAll : handleSelectAll}
                                disabled={bulkAdding}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-white border border-gray-300 text-black hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                              >
                                {selectedBibcodes.size === items.length ? (
                                  <><CheckSquare className="w-3.5 h-3.5" /> Deselect All</>
                                ) : (
                                  <><Square className="w-3.5 h-3.5" /> Select All</>
                                )}
                              </button>
                              {selectedBibcodes.size > 0 && (
                                <>
                                  <button
                                    onClick={() => handleBulkAddToDigest()}
                                    disabled={bulkAdding}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-purple-50 border border-purple-300 text-purple-700 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                                    title="Add selected to digest items"
                                  >
                                    <FileHeart className="w-3.5 h-3.5" />
                                    Add {selectedBibcodes.size} to Digest
                                  </button>
                                  <button
                                    onClick={() => handleBulkAddToSaved()}
                                    disabled={bulkAdding}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-yellow-50 border border-yellow-300 text-yellow-700 hover:bg-yellow-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                                    title="Add selected to saved items"
                                  >
                                    <FolderHeart className="w-3.5 h-3.5" />
                                    Add {selectedBibcodes.size} to Saved
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                        {!selectMode && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleAddAllToDigest}
                              disabled={bulkAdding || items.length === 0}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-purple-50 border border-purple-300 text-purple-700 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                              title="Add all papers to digest items"
                            >
                              <FileHeart className="w-3.5 h-3.5" />
                              Add All to Digest
                            </button>
                            <button
                              onClick={handleAddAllToSaved}
                              disabled={bulkAdding || items.length === 0}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors bg-yellow-50 border border-yellow-300 text-yellow-700 hover:bg-yellow-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                              title="Add all papers to saved items"
                            >
                              <FolderHeart className="w-3.5 h-3.5" />
                              Add All to Saved
                            </button>
                          </div>
                        )}
                      </div>
                      {items.length > 0 ? (
                        items.map((item) => {
                          const isSelected = selectedBibcodes.has(item.bibcode);
                          return (
                          <div
                            key={item.bibcode}
                            className={`border rounded-lg overflow-hidden bg-surface transition-colors ${
                              isSelected ? 'border-blue-400 bg-blue-50/30' : 'border-surface-border hover:border-gray-400/50'
                            }`}
                          >
                            <div className="p-4 pb-3">
                              <div className="flex items-start justify-between gap-4">
                                {selectMode && (
                                  <button
                                    onClick={() => handleToggleSelection(item.bibcode)}
                                    className="mt-1 flex-shrink-0"
                                  >
                                    {isSelected ? (
                                      <CheckSquare className="w-5 h-5 text-blue-600" />
                                    ) : (
                                      <Square className="w-5 h-5 text-gray-400" />
                                    )}
                                  </button>
                                )}
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
                                    {/* Saved items library button - always show for research papers */}
                                    <button
                                      onClick={() => handleToggleSavedItems(item.bibcode)}
                                      disabled={libraryLoading.has(itemIdMap.get(item.bibcode) || `ads:${item.bibcode}`)}
                                      className={`p-1.5 rounded transition-colors ${
                                        libraryStatus.get(itemIdMap.get(item.bibcode) || `ads:${item.bibcode}`)?.inSavedItems
                                          ? 'text-yellow-600 bg-yellow-50'
                                          : 'text-gray-400 hover:text-yellow-600 hover:bg-yellow-50'
                                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                                      title={libraryStatus.get(itemIdMap.get(item.bibcode) || `ads:${item.bibcode}`)?.inSavedItems ? 'Remove from saved items' : 'Add to saved items'}
                                    >
                                      <FolderHeart className="w-4 h-4" />
                                    </button>
                                    {/* Digest items library button - always show for research papers */}
                                    <button
                                      onClick={() => handleToggleDigestItems(item.bibcode)}
                                      disabled={libraryLoading.has(itemIdMap.get(item.bibcode) || `ads:${item.bibcode}`)}
                                      className={`p-1.5 rounded transition-colors ${
                                        libraryStatus.get(itemIdMap.get(item.bibcode) || `ads:${item.bibcode}`)?.inDigestItems
                                          ? 'text-yellow-600 bg-yellow-50'
                                          : 'text-gray-400 hover:text-yellow-600 hover:bg-yellow-50'
                                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                                      title={libraryStatus.get(itemIdMap.get(item.bibcode) || `ads:${item.bibcode}`)?.inDigestItems ? 'Remove from digest items' : 'Add to digest items'}
                                    >
                                      <FileHeart className="w-4 h-4" />
                                    </button>
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
                        );
                        })
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
