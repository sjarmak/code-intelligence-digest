"use client";

import { useState, useEffect, useRef } from "react";
import { Bookmark, FileHeart, FolderHeart, FileText } from "lucide-react";
import ItemRelevanceBadge, {
  ItemRelevanceRating,
} from "@/src/components/tuning/item-relevance-badge";
import { useAdminSettings } from "@/src/hooks/useAdminSettings";
import { useAppConfig } from "@/src/hooks/useAppConfig";
import { FullTextViewer } from "@/src/components/common/fulltext-viewer";
import { ProductBadgeList } from "@/src/components/common/product-badge";

interface LLMScore {
  relevance: number;
  usefulness: number;
  tags: string[];
}

interface ItemCardProps {
  item: {
    id: string;
    title: string;
    url: string;
    sourceTitle: string;
    publishedAt: string;
    createdAt?: string | null;
    summary?: string;
    contentSnippet?: string;
    categories?: string[];
    category?: string;
    llmScore: LLMScore;
    finalScore: number;
    reasoning: string;
    diversityReason?: string;
    /** Product IDs mentioned in the content */
    productMentions?: string[];
  };
  rank?: number;
  period?: "day" | "week" | "month" | "all" | "custom";
  /** Optional callback when a product badge is clicked (for filtering) */
  onProductClick?: (productId: string) => void;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString();
}

function formatCategoryName(category: string): string {
  const categoryLabels: Record<string, string> = {
    newsletters: "Newsletters",
    podcasts: "Podcasts",
    tech_articles: "Tech Articles",
    ai_news: "AI News",
    product_news: "Product News",
    community: "Community",
    research: "Research",
  };
  return categoryLabels[category] || category.replace("_", " ");
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    newsletters: "bg-gray-100 text-gray-800 border-gray-300",
    podcasts: "bg-gray-100 text-gray-800 border-gray-300",
    tech_articles: "bg-gray-100 text-gray-800 border-gray-300",
    ai_news: "bg-gray-100 text-gray-800 border-gray-300",
    product_news: "bg-gray-100 text-gray-800 border-gray-300",
    community: "bg-gray-100 text-gray-800 border-gray-300",
    research: "bg-gray-100 text-gray-800 border-gray-300",
  };
  return colors[category] || "bg-gray-100 text-gray-800 border-gray-300";
}

// Extract bibcode from arXiv URL or ADS URL
function extractBibcodeFromUrl(url: string): string | null {
  // Match ADS URLs: https://ui.adsabs.harvard.edu/abs/BIBCODE or https://adsabs.harvard.edu/abs/BIBCODE
  const adsMatch = url.match(/adsabs\.harvard\.edu\/abs\/([^\/\?&#]+)/);
  if (adsMatch) {
    return decodeURIComponent(adsMatch[1]);
  }

  // Match arXiv URLs: https://arxiv.org/abs/YYMM.NNNNN or https://arxiv.org/pdf/YYMM.NNNNN.pdf
  const arxivMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/);
  if (arxivMatch) {
    const arxivId = arxivMatch[1];
    // Convert arXiv ID to bibcode format: YYMM.NNNNN -> YYYYarXivYYMMNNNNNL
    // Example: 2501.00123 -> 2025arXiv250100123A
    const [yymm, nnnnn] = arxivId.split(".");
    const yearSuffix = yymm.substring(0, 2);
    const month = yymm.substring(2, 4);
    // Determine full year: assume 2000s for now (20-99 -> 2020-2099)
    const fullYear = 2000 + parseInt(yearSuffix);

    // Format: YYYYarXivYYMMNNNNNL (L is a letter, we'll use 'A' as default)
    // Pad nnnnn to 5 digits (left-pad with zeros)
    const paddedNumber = nnnnn.padStart(5, "0");
    return `${fullYear}arXiv${yearSuffix}${month}${paddedNumber}A`;
  }

  return null;
}

export default function ItemCard({
  item,
  rank,
  period,
  onProductClick,
}: ItemCardProps) {
  const { settings, loading } = useAdminSettings();
  const { config } = useAppConfig();
  const [currentRating, setCurrentRating] = useState<ItemRelevanceRating>(null);
  const [isStarred, setIsStarred] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [inSavedItems, setInSavedItems] = useState(false);
  const [inDigestItems, setInDigestItems] = useState(false);
  const [hasFullText, setHasFullText] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [showFullText, setShowFullText] = useState(false);
  const bibcode =
    item.category === "research" ? extractBibcodeFromUrl(item.url) : null;

  // Load stored rating, starred status, favorite status, and library membership on mount
  // Always check database state, not just local state
  useEffect(() => {
    let isMounted = true;

    const loadMetadata = async () => {
      console.log(
        `[ItemCard] Loading metadata for item: ${item.id} - ${item.title.substring(0, 50)}...`,
      );
      try {
        // Always fetch library status from database to ensure accurate state
        // Add timestamp to prevent caching issues
        const libraryUrl = `/api/items/${encodeURIComponent(item.id)}/libraries?t=${Date.now()}`;
        const libraryRes = await fetch(libraryUrl);

        if (!isMounted) return;

        if (libraryRes?.ok) {
          const data = await libraryRes.json();
          // Always set from database response, ensuring accurate state
          if (isMounted) {
            const savedBool = Boolean(data.inSavedItems);
            const digestBool = Boolean(data.inDigestItems);
            setInSavedItems(savedBool);
            setInDigestItems(digestBool);
          }
        } else {
          // If API call fails, reset to false
          if (isMounted) {
            setInSavedItems(false);
            setInDigestItems(false);
          }
        }

        // Load other metadata in parallel
        const fulltextUrl = `/api/items/${encodeURIComponent(item.id)}/fulltext`;

        const [relevanceRes, favoriteRes, fulltextRes] = await Promise.all([
          config.adminUIEnabled
            ? fetch(
                `/api/admin/item-relevance?itemId=${encodeURIComponent(item.id)}`,
              )
            : Promise.resolve(null),
          bibcode
            ? fetch(`/api/papers/${encodeURIComponent(bibcode)}/favorite`)
            : Promise.resolve(null),
          fetch(fulltextUrl),
        ]);

        if (!isMounted) return;

        if (relevanceRes?.ok) {
          const data = await relevanceRes.json();
          if (data.rating !== undefined && isMounted) {
            setCurrentRating(data.rating);
          }
          if (data.starred !== undefined && isMounted) {
            setIsStarred(data.starred);
          }
        }

        if (favoriteRes?.ok && isMounted) {
          const data = await favoriteRes.json();
          setIsFavorite(data.isFavorite || false);
        }

        if (fulltextRes?.ok && isMounted) {
          try {
            const data = await fulltextRes.json();
            const hasFullTextValue = data.hasFullText || false;
            setHasFullText(hasFullTextValue);
            if (hasFullTextValue) {
              console.log(
                `[ItemCard] ✅ Full text available for: ${item.title.substring(0, 50)}...`,
              );
            } else {
              console.log(
                `[ItemCard] ❌ No full text for: ${item.title.substring(0, 50)}... (hasFullText: ${data.hasFullText})`,
              );
            }
          } catch (parseError) {
            console.error("Error parsing fulltext response:", parseError);
            setHasFullText(false);
          }
        } else if (fulltextRes && !fulltextRes.ok && isMounted) {
          // API call failed, ensure hasFullText is false
          console.warn(
            `[ItemCard] Fulltext API failed for ${item.id}: ${fulltextRes.status}`,
          );
          setHasFullText(false);
        } else if (!fulltextRes && isMounted) {
          // No response (network error, etc.)
          console.warn(
            `[ItemCard] Fulltext API call failed (no response) for ${item.id}`,
          );
          setHasFullText(false);
        }
      } catch (error) {
        console.error("Error loading item metadata:", error);
        // On error, still try to check library status
        if (isMounted) {
          try {
            const libraryRes = await fetch(
              `/api/items/${encodeURIComponent(item.id)}/libraries?t=${Date.now()}`,
            );
            if (libraryRes?.ok) {
              const data = await libraryRes.json();
              setInSavedItems(Boolean(data.inSavedItems));
              setInDigestItems(Boolean(data.inDigestItems));
            }
          } catch (libraryError) {
            console.error("Error loading library status:", libraryError);
          }
        }
      }
    };

    loadMetadata();

    return () => {
      isMounted = false;
    };
  }, [item.id, item.title, bibcode, config.adminUIEnabled]);

  // Force library status check when component becomes visible again (handles navigation back)
  // This ensures we always check the database state, even if useEffect dependencies haven't changed
  useEffect(() => {
    const checkLibraryStatus = async () => {
      try {
        const libraryRes = await fetch(
          `/api/items/${encodeURIComponent(item.id)}/libraries?t=${Date.now()}`,
        );
        if (libraryRes?.ok) {
          const data = await libraryRes.json();
          setInSavedItems(Boolean(data.inSavedItems));
          setInDigestItems(Boolean(data.inDigestItems));
        }
      } catch (error) {
        console.error("Error checking library status on visibility:", error);
      }
    };

    // Check immediately when component mounts or becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkLibraryStatus();
      }
    };

    // Check on focus (when user switches back to tab/window)
    const handleFocus = () => {
      checkLibraryStatus();
    };

    // Check immediately when component mounts (handles remount after navigation)
    checkLibraryStatus();

    // Also check when the page is loaded/visible
    if (document.visibilityState === "visible") {
      checkLibraryStatus();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [item.id]);

  // Also check library status when component becomes visible (handles navigation back)
  useEffect(() => {
    const checkLibraryStatus = async () => {
      try {
        const libraryRes = await fetch(
          `/api/items/${encodeURIComponent(item.id)}/libraries?t=${Date.now()}`,
        );
        if (libraryRes?.ok) {
          const data = await libraryRes.json();
          setInSavedItems(Boolean(data.inSavedItems));
          setInDigestItems(Boolean(data.inDigestItems));
        }
      } catch (error) {
        console.error("Error checking library status on visibility:", error);
      }
    };

    // Check when page becomes visible (user navigates back)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkLibraryStatus();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Also check on focus (when user switches back to tab)
    const handleFocus = () => {
      checkLibraryStatus();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [item.id]);

  const handleRateItem = async (
    itemId: string,
    rating: ItemRelevanceRating,
    notes?: string,
  ) => {
    try {
      const response = await fetch("/api/admin/item-relevance", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ itemId, rating, notes }),
      });

      if (!response.ok) {
        throw new Error(`API error ${response.status}`);
      }

      setCurrentRating(rating);
    } catch (error) {
      console.error("Error rating item:", error);
      throw error;
    }
  };

  const handleToggleFavorite = async () => {
    if (!bibcode) {
      console.warn("Cannot favorite: no bibcode extracted from URL", item.url);
      return;
    }

    setFavoriteLoading(true);
    const wasFavorite = isFavorite;
    try {
      const method = isFavorite ? "DELETE" : "POST";
      const response = await fetch(
        `/api/papers/${encodeURIComponent(bibcode)}/favorite`,
        {
          method,
        },
      );

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        console.error("Failed to toggle favorite:", errorData);
        return;
      }

      const data = await response.json();
      setIsFavorite(data.isFavorite || false);

      // Trigger section processing if favoriting (not unfavoriting)
      if (!wasFavorite && data.isFavorite) {
        // The favorite endpoint already triggers section processing, but we can also call it explicitly
        fetch(`/api/papers/${encodeURIComponent(bibcode)}/process-sections`, {
          method: "POST",
        }).catch((err) =>
          console.error("Failed to trigger section processing:", err),
        );
      }
    } catch (error) {
      console.error("Error toggling favorite:", error);
    } finally {
      setFavoriteLoading(false);
    }
  };

  const handleToggleSavedItems = async () => {
    setLibraryLoading(true);
    try {
      const method = inSavedItems ? "DELETE" : "POST";
      const response = await fetch(
        `/api/saved-items${method === "DELETE" ? `?itemId=${encodeURIComponent(item.id)}` : ""}`,
        {
          method,
          headers:
            method === "POST" ? { "Content-Type": "application/json" } : {},
          body:
            method === "POST" ? JSON.stringify({ itemId: item.id }) : undefined,
        },
      );

      if (!response.ok) {
        throw new Error("Failed to toggle saved items");
      }

      // Dispatch custom event to notify other components
      window.dispatchEvent(new CustomEvent("saved-items-changed"));

      // Reload library status to ensure it's in sync with the server
      const libraryRes = await fetch(
        `/api/items/${encodeURIComponent(item.id)}/libraries?t=${Date.now()}`,
      );
      if (libraryRes?.ok) {
        const data = await libraryRes.json();
        setInSavedItems(Boolean(data.inSavedItems));
        setInDigestItems(Boolean(data.inDigestItems));
      } else {
        // Fallback to optimistic update if reload fails
        setInSavedItems(!inSavedItems);
      }
    } catch (error) {
      console.error("Error toggling saved items:", error);
    } finally {
      setLibraryLoading(false);
    }
  };

  const handleToggleDigestItems = async () => {
    setLibraryLoading(true);
    try {
      const method = inDigestItems ? "DELETE" : "POST";
      const response = await fetch(
        `/api/digest-items${method === "DELETE" ? `?itemId=${encodeURIComponent(item.id)}` : ""}`,
        {
          method,
          headers:
            method === "POST" ? { "Content-Type": "application/json" } : {},
          body:
            method === "POST" ? JSON.stringify({ itemId: item.id }) : undefined,
        },
      );

      if (!response.ok) {
        throw new Error("Failed to toggle digest items");
      }

      // Dispatch custom event to notify other components
      window.dispatchEvent(new CustomEvent("digest-items-changed"));

      // Reload library status to ensure it's in sync with the server
      const libraryRes = await fetch(
        `/api/items/${encodeURIComponent(item.id)}/libraries?t=${Date.now()}`,
      );
      if (libraryRes?.ok) {
        const data = await libraryRes.json();
        setInSavedItems(Boolean(data.inSavedItems));
        setInDigestItems(Boolean(data.inDigestItems));
      } else {
        // Fallback to optimistic update if reload fails
        setInDigestItems(!inDigestItems);
      }
    } catch (error) {
      console.error("Error toggling digest items:", error);
    } finally {
      setLibraryLoading(false);
    }
  };

  // Use a ref to track the container element for intersection observer
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Check library status when component becomes visible in viewport
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const checkLibraryStatus = async () => {
      try {
        const libraryRes = await fetch(
          `/api/items/${encodeURIComponent(item.id)}/libraries?t=${Date.now()}`,
        );
        if (libraryRes?.ok) {
          const data = await libraryRes.json();
          setInSavedItems(Boolean(data.inSavedItems));
          setInDigestItems(Boolean(data.inDigestItems));
        }
      } catch (error) {
        console.error("Error checking library status on intersection:", error);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            checkLibraryStatus();
          }
        });
      },
      { threshold: 0.1 },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [item.id]);

  return (
    <div
      ref={containerRef}
      className="border border-surface-border rounded-lg p-4 hover:border-gray-400 hover:bg-surface/80 transition-all hover:shadow-md"
    >
      {/* Main row with rank, score, and title */}
      <div className="flex items-start gap-4">
        {/* Rank number */}
        {rank !== undefined && (
          <div className="flex-shrink-0 pt-1">
            <span className="text-2xl font-bold text-black w-8 text-right">
              {rank}
            </span>
          </div>
        )}

        {/* Score and title */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            {!loading && settings.enableItemRelevanceTuning && (
              <span className="text-sm font-semibold text-gray-700 bg-surface/50 px-2 py-1 rounded">
                {item.finalScore.toFixed(2)}
              </span>
            )}
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-semibold text-black hover:text-gray-700 transition-colors line-clamp-2"
            >
              {item.title}
            </a>
          </div>

          {/* Metadata line: source, tags, date, and rating button */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted mb-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-700">
                {item.sourceTitle}
              </span>
              <span>•</span>

              {/* Tags */}
              {item.llmScore.tags.length > 0 && (
                <>
                  <div className="flex flex-wrap gap-1">
                    {item.llmScore.tags.map((tag, tagIndex) => (
                      <span
                        key={`${item.id}-tag-${tagIndex}-${tag}`}
                        className="inline-block px-1.5 py-0.5 bg-surface border border-surface-border rounded text-gray-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <span>•</span>
                </>
              )}

              {/* Date - use createdAt for day period or research day/week/month, otherwise use publishedAt */}
              <span>
                {formatDate(
                  (period === "day" ||
                    (item.category === "research" && period !== "all")) &&
                    item.createdAt
                    ? item.createdAt
                    : item.publishedAt,
                )}
              </span>
            </div>

            {/* Action buttons - right aligned */}
            <div className="flex items-center gap-1">
              {/* Full text icon */}
              <button
                onClick={() => hasFullText && setShowFullText(true)}
                disabled={!hasFullText}
                className={`p-1.5 rounded transition-colors ${
                  hasFullText
                    ? "text-black hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
                    : "text-gray-300 cursor-default"
                }`}
                title={
                  hasFullText ? "View full text" : "Full text not available"
                }
              >
                <FileText className="w-4 h-4" />
              </button>

              {/* Saved items library (folder-heart) - for all item types */}
              <button
                onClick={handleToggleSavedItems}
                disabled={libraryLoading}
                className={`p-1.5 rounded transition-colors ${
                  inSavedItems
                    ? "text-yellow-600 bg-yellow-50"
                    : "text-gray-400 hover:text-yellow-600 hover:bg-yellow-50"
                } disabled:opacity-50`}
                title={
                  inSavedItems
                    ? "Remove from saved items"
                    : "Add to saved items"
                }
              >
                <FolderHeart className="w-4 h-4" />
              </button>

              {/* Digest items library (file-heart) */}
              <button
                onClick={handleToggleDigestItems}
                disabled={libraryLoading}
                className={`p-1.5 rounded transition-colors ${
                  inDigestItems
                    ? "text-yellow-600 bg-yellow-50"
                    : "text-gray-400 hover:text-yellow-600 hover:bg-yellow-50"
                } disabled:opacity-50`}
                title={
                  inDigestItems
                    ? "Remove from digest items"
                    : "Add to digest items"
                }
              >
                <FileHeart className="w-4 h-4" />
              </button>

              {/* Bookmark button for research papers only (ADS library) */}
              {item.category === "research" && bibcode && (
                <button
                  onClick={handleToggleFavorite}
                  disabled={favoriteLoading}
                  className={`p-1.5 rounded transition-colors ${
                    isFavorite
                      ? "text-yellow-600 bg-yellow-50"
                      : "text-gray-400 hover:text-yellow-600 hover:bg-yellow-50"
                  } disabled:opacity-50`}
                  title={
                    isFavorite
                      ? "Remove from bookmarked library"
                      : "Add to bookmarked library"
                  }
                >
                  <Bookmark
                    className={`w-4 h-4 ${isFavorite ? "fill-current" : ""}`}
                  />
                </button>
              )}

              {/* Rating button - only in dev mode */}
              {!loading &&
                config.adminUIEnabled &&
                settings.enableItemRelevanceTuning && (
                  <ItemRelevanceBadge
                    itemId={item.id}
                    currentRating={currentRating}
                    onRatingChange={handleRateItem}
                    starred={isStarred}
                    onStarChange={(starred) => setIsStarred(starred)}
                    readOnly={false}
                  />
                )}
            </div>
          </div>

          {/* Category badge and product mentions */}
          <div className="flex flex-wrap items-center gap-2">
            {item.category && (
              <span
                className={`inline-block badge text-xs ${getCategoryColor(item.category)}`}
              >
                {formatCategoryName(item.category)}
              </span>
            )}

            {/* Product mentions */}
            {item.productMentions && item.productMentions.length > 0 && (
              <ProductBadgeList
                productIds={item.productMentions}
                onProductClick={onProductClick}
                size="sm"
              />
            )}
          </div>
        </div>

        {/* External link icon */}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 text-black hover:text-gray-700 transition-colors mt-1"
          title="Open in new tab"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </div>

      {/* Full text viewer modal */}
      <FullTextViewer
        itemId={item.id}
        itemTitle={item.title}
        isOpen={showFullText}
        onClose={() => setShowFullText(false)}
      />
    </div>
  );
}
