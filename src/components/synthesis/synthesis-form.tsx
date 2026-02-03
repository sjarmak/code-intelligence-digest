/**
 * Synthesis form for newsletter and podcast generation
 */

"use client";

import React, { useState, useEffect } from "react";
import { type Category } from "@/src/lib/model";
import { SavedItemsView } from "@/src/components/digest/saved-items-view";

interface SynthesisFormProps {
  onGenerate: (params: SynthesisParams) => Promise<void>;
  isLoading?: boolean;
  type: "newsletter" | "podcast" | "audio-digest";
}

export interface SynthesisParams {
  type: "newsletter" | "podcast" | "audio-digest";
  sourceMode: "auto" | "manual" | "categories";
  categories?: Category[];
  period?: "week" | "month" | "all" | "custom";
  limit?: number;
  selectedItemIds?: string[];
  prompt?: string;
  voiceStyle?: "conversational" | "technical" | "executive";
  duration?: number; // Duration in minutes (for audio-digest)
  customDateRange?: {
    startDate: string; // ISO date string (YYYY-MM-DD)
    endDate: string; // ISO date string (YYYY-MM-DD)
  };
}

const ALLOWED_CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "ai_dev",
  "product_news",
  "community",
  "research",
  "marketing",
];

const CATEGORY_LABELS: Record<Category, string> = {
  newsletters: "Newsletters",
  podcasts: "Podcasts",
  tech_articles: "Tech Articles",
  ai_news: "AI News",
  ai_dev: "AI Dev",
  product_news: "Product News",
  community: "Community",
  research: "Research",
  marketing: "Marketing",
};

export function SynthesisForm({
  onGenerate,
  isLoading = false,
  type,
}: SynthesisFormProps) {
  const [selectedCategories, setSelectedCategories] =
    useState<Category[]>(ALLOWED_CATEGORIES);
  const [period, setPeriod] = useState<"week" | "month" | "all" | "custom">(
    "week",
  );
  const [customDateRange, setCustomDateRange] = useState<{
    startDate: string;
    endDate: string;
  }>({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
  });
  const [limit, setLimit] = useState(50);
  const [prompt, setPrompt] = useState(
    "Focus on content relevant to building benchmarks to evaluate the value of augmenting coding agents with code search and codebase understanding tools in enterprise codebases to improve developer workflows.",
  );
  const [voiceStyle, setVoiceStyle] = useState<
    "conversational" | "technical" | "executive"
  >("conversational");
  const [duration, setDuration] = useState(30); // Duration in minutes for audio-digest
  const [podcastMode, setPodcastMode] = useState<
    "conversational" | "highlights"
  >("conversational"); // For podcast type
  const [sourceMode, setSourceMode] = useState<
    "auto" | "manual" | "categories"
  >("auto");
  const [digestItemsCount, setDigestItemsCount] = useState(0);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
    new Set(),
  );

  // Load digest items count on mount
  useEffect(() => {
    const loadDigestCount = async () => {
      try {
        const response = await fetch("/api/digest-items");
        if (response.ok) {
          const data = await response.json();
          setDigestItemsCount(data.count || 0);
        }
      } catch (error) {
        console.error("Failed to load digest items count:", error);
      }
    };
    loadDigestCount();
  }, []);

  const handleCategoryToggle = (category: Category) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (sourceMode === "auto") {
      if (digestItemsCount === 0) {
        alert(
          "No items in digest library. Please add items to your digest library first.",
        );
        return;
      }
    } else {
      // Manual mode
      if (selectedItemIds.size === 0) {
        alert("Please select at least one item from your saved items library");
        return;
      }
    }

    // Validation based on source mode
    if (sourceMode === "categories") {
      // Categories mode: validate categories, period, limit
      if (selectedCategories.length === 0) {
        alert("Please select at least one category");
        return;
      }

      if (period === "custom") {
        // Validate custom date range
        if (!customDateRange.startDate || !customDateRange.endDate) {
          alert("Please select both start and end dates for custom range");
          return;
        }
        const start = new Date(customDateRange.startDate);
        const end = new Date(customDateRange.endDate);
        if (start > end) {
          alert("Start date must be before end date");
          return;
        }
        if (end > new Date()) {
          alert("End date cannot be in the future");
          return;
        }
      }
    }

    // If podcast mode is "highlights", route to audio-digest
    const effectiveType =
      type === "podcast" && podcastMode === "highlights"
        ? "audio-digest"
        : type;

    await onGenerate({
      type: effectiveType,
      sourceMode,
      ...(sourceMode === "manual"
        ? {
            selectedItemIds: Array.from(selectedItemIds),
          }
        : sourceMode === "categories"
          ? {
              categories: selectedCategories,
              period,
              limit,
              ...(period === "custom" && { customDateRange }),
            }
          : {
              // Auto mode: no additional params needed, uses all items from digest library
            }),
      prompt: prompt || undefined,
      ...(effectiveType === "podcast" && { voiceStyle }),
      ...(effectiveType === "audio-digest" && { duration }),
    });
  };

  return (
    <div className="bg-surface rounded-lg border border-surface-border shadow-sm">
      <div className="border-b border-surface-border px-6 py-4">
        <h2 className="text-lg font-bold text-black">
          {type === "newsletter"
            ? "Generate Newsletter"
            : type === "podcast"
              ? "Generate Podcast"
              : "Generate Audio Digest"}
        </h2>
        <p className="text-sm text-muted mt-1">
          {type === "newsletter"
            ? "Create a curated newsletter from selected content categories"
            : type === "podcast"
              ? "Create an episode transcript from selected content"
              : "Generate an audio digest with highlights from articles and research papers"}
        </p>
      </div>
      <div className="px-6 py-4">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Source Mode Selector */}
          <div>
            <label className="block text-sm font-semibold text-black mb-3">
              Source Mode
            </label>
            <div className="space-y-2">
              <div className="flex items-center">
                <input
                  type="radio"
                  id="auto"
                  name="sourceMode"
                  value="auto"
                  checked={sourceMode === "auto"}
                  onChange={(e) =>
                    setSourceMode(
                      e.target.value as "auto" | "manual" | "categories",
                    )
                  }
                  disabled={isLoading}
                  className="accent-black focus:ring-black"
                />
                <label
                  htmlFor="auto"
                  className="ml-2 text-sm text-foreground cursor-pointer"
                >
                  Auto (use all Digest Library items)
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                  id="manual"
                  name="sourceMode"
                  value="manual"
                  checked={sourceMode === "manual"}
                  onChange={(e) =>
                    setSourceMode(
                      e.target.value as "auto" | "manual" | "categories",
                    )
                  }
                  disabled={isLoading}
                  className="accent-black focus:ring-black"
                />
                <label
                  htmlFor="manual"
                  className="ml-2 text-sm text-foreground cursor-pointer"
                >
                  Manual (select from Saved Items Library)
                </label>
              </div>
              <div className="flex items-center">
                <input
                  type="radio"
                  id="categories"
                  name="sourceMode"
                  value="categories"
                  checked={sourceMode === "categories"}
                  onChange={(e) =>
                    setSourceMode(
                      e.target.value as "auto" | "manual" | "categories",
                    )
                  }
                  disabled={isLoading}
                  className="accent-black focus:ring-black"
                />
                <label
                  htmlFor="categories"
                  className="ml-2 text-sm text-foreground cursor-pointer"
                >
                  Categories & Time Period
                </label>
              </div>
            </div>
            {sourceMode === "auto" && (
              <p className="text-xs text-muted mt-2">
                {digestItemsCount === 0
                  ? "No items in digest library. Add items to your digest library first."
                  : `Using ${digestItemsCount} item${digestItemsCount !== 1 ? "s" : ""} from digest library.`}
              </p>
            )}
            {sourceMode === "manual" && (
              <p className="text-xs text-muted mt-2">
                Select items from your saved items library below.
              </p>
            )}
            {sourceMode === "categories" && (
              <p className="text-xs text-muted mt-2">
                Select categories, time period, and item limit to filter items.
              </p>
            )}
          </div>

          {/* Manual Mode: Saved Items Selection */}
          {sourceMode === "manual" && (
            <div className="border border-surface-border rounded-lg p-4 max-h-96 overflow-y-auto">
              <SavedItemsView
                selectedItemIds={selectedItemIds}
                onSelectionChange={setSelectedItemIds}
                showCheckboxes={true}
              />
            </div>
          )}

          {/* Categories - only show in categories mode */}
          {sourceMode === "categories" && (
            <div>
              <label className="block text-sm font-semibold text-black mb-3">
                Content Categories
              </label>
              <div className="grid grid-cols-2 gap-3">
                {ALLOWED_CATEGORIES.map((category) => (
                  <div key={category} className="flex items-center">
                    <input
                      type="checkbox"
                      id={category}
                      checked={selectedCategories.includes(category)}
                      onChange={() => handleCategoryToggle(category)}
                      disabled={isLoading}
                      className="rounded border-surface-border accent-black focus:ring-black bg-surface"
                    />
                    <label
                      htmlFor={category}
                      className="ml-2 text-sm text-foreground cursor-pointer"
                    >
                      {CATEGORY_LABELS[category]}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Period - only show in categories mode */}
          {sourceMode === "categories" && (
            <div>
              <label className="block text-sm font-semibold text-black mb-3">
                Time Period
              </label>
              <div className="space-y-2">
                <div className="flex items-center">
                  <input
                    type="radio"
                    id="week"
                    name="period"
                    value="week"
                    checked={period === "week"}
                    onChange={(e) =>
                      setPeriod(
                        e.target.value as "week" | "month" | "all" | "custom",
                      )
                    }
                    disabled={isLoading}
                    className="accent-black focus:ring-black"
                  />
                  <label
                    htmlFor="week"
                    className="ml-2 text-sm text-foreground cursor-pointer"
                  >
                    This Week (7 days)
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    type="radio"
                    id="month"
                    name="period"
                    value="month"
                    checked={period === "month"}
                    onChange={(e) =>
                      setPeriod(
                        e.target.value as "week" | "month" | "all" | "custom",
                      )
                    }
                    disabled={isLoading}
                    className="accent-black focus:ring-black"
                  />
                  <label
                    htmlFor="month"
                    className="ml-2 text-sm text-foreground cursor-pointer"
                  >
                    This Month (30 days)
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    type="radio"
                    id="all"
                    name="period"
                    value="all"
                    checked={period === "all"}
                    onChange={(e) =>
                      setPeriod(
                        e.target.value as "week" | "month" | "all" | "custom",
                      )
                    }
                    disabled={isLoading}
                    className="accent-black focus:ring-black"
                  />
                  <label
                    htmlFor="all"
                    className="ml-2 text-sm text-foreground cursor-pointer"
                  >
                    All Time (90 days)
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    type="radio"
                    id="custom"
                    name="period"
                    value="custom"
                    checked={period === "custom"}
                    onChange={(e) =>
                      setPeriod(
                        e.target.value as "week" | "month" | "all" | "custom",
                      )
                    }
                    disabled={isLoading}
                    className="accent-black focus:ring-black"
                  />
                  <label
                    htmlFor="custom"
                    className="ml-2 text-sm text-foreground cursor-pointer"
                  >
                    Custom Range
                  </label>
                </div>
              </div>
              {period === "custom" && (
                <div className="mt-3 space-y-3 pl-6 border-l-2 border-surface-border">
                  <div>
                    <label
                      htmlFor="startDate"
                      className="block text-xs font-medium text-foreground mb-1"
                    >
                      Start Date
                    </label>
                    <input
                      type="date"
                      id="startDate"
                      value={customDateRange.startDate}
                      onChange={(e) =>
                        setCustomDateRange((prev) => ({
                          ...prev,
                          startDate: e.target.value,
                        }))
                      }
                      disabled={isLoading}
                      max={new Date().toISOString().split("T")[0]}
                      className="block w-full px-3 py-2 border border-surface-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-black bg-surface text-black"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="endDate"
                      className="block text-xs font-medium text-foreground mb-1"
                    >
                      End Date
                    </label>
                    <input
                      type="date"
                      id="endDate"
                      value={customDateRange.endDate}
                      onChange={(e) =>
                        setCustomDateRange((prev) => ({
                          ...prev,
                          endDate: e.target.value,
                        }))
                      }
                      disabled={isLoading}
                      max={new Date().toISOString().split("T")[0]}
                      className="block w-full px-3 py-2 border border-surface-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-black bg-surface text-black"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Limit - only show in categories mode */}
          {sourceMode === "categories" && (
            <div>
              <label
                htmlFor="limit"
                className="block text-sm font-semibold text-black mb-2"
              >
                Item Limit
              </label>
              <input
                id="limit"
                type="number"
                min="1"
                max="50"
                value={limit}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setLimit(
                    Math.max(1, Math.min(50, parseInt(e.target.value) || 15)),
                  )
                }
                disabled={isLoading}
                className="block w-20 px-3 py-2 border border-surface-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-black bg-surface text-black"
              />
              <p className="text-xs text-muted mt-1">
                Max items to retrieve (1-50)
              </p>
            </div>
          )}

          {/* Mode Selector (Podcast only) */}
          {type === "podcast" && (
            <div>
              <label
                htmlFor="podcastMode"
                className="block text-sm font-semibold text-black mb-2"
              >
                Mode
              </label>
              <select
                id="podcastMode"
                value={podcastMode}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setPodcastMode(
                    e.target.value as "conversational" | "highlights",
                  )
                }
                disabled={isLoading}
                className="block w-full px-3 py-2 border border-surface-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-black bg-surface text-black"
              >
                <option value="conversational">Conversational</option>
                <option value="highlights">Read Highlights</option>
              </select>
              <p className="text-xs text-muted mt-1">
                {podcastMode === "conversational"
                  ? "Generate a conversational podcast episode"
                  : "Generate an audio digest reading highlights from articles and papers"}
              </p>
            </div>
          )}

          {/* Voice Style (Podcast only, conversational mode) */}
          {type === "podcast" && podcastMode === "conversational" && (
            <div>
              <label
                htmlFor="voiceStyle"
                className="block text-sm font-semibold text-black mb-2"
              >
                Voice Style
              </label>
              <select
                id="voiceStyle"
                value={voiceStyle}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setVoiceStyle(
                    e.target.value as
                      | "conversational"
                      | "technical"
                      | "executive",
                  )
                }
                disabled={isLoading}
                className="block w-full px-3 py-2 border border-surface-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-black bg-surface text-black"
              >
                <option value="conversational">Conversational</option>
                <option value="technical">Technical</option>
                <option value="executive">Executive</option>
              </select>
            </div>
          )}

          {/* Duration (Podcast highlights mode or audio-digest) */}
          {(type === "audio-digest" ||
            (type === "podcast" && podcastMode === "highlights")) && (
            <div>
              <label
                htmlFor="duration"
                className="block text-sm font-semibold text-black mb-2"
              >
                Target Duration (minutes)
              </label>
              <input
                id="duration"
                type="number"
                min="15"
                max="120"
                value={duration}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDuration(
                    Math.max(15, Math.min(120, parseInt(e.target.value) || 30)),
                  )
                }
                disabled={isLoading}
                className="block w-24 px-3 py-2 border border-surface-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-black bg-surface text-black"
              />
              <p className="text-xs text-muted mt-1">
                Target duration: 15-120 minutes
              </p>
            </div>
          )}

          {/* Prompt */}
          <div>
            <label
              htmlFor="prompt"
              className="block text-sm font-semibold text-black mb-2"
            >
              Optional Guidance (Prompt)
            </label>
            <textarea
              id="prompt"
              placeholder={
                type === "newsletter"
                  ? "e.g., Focus on content relevant to building benchmarks for coding agents and code search."
                  : type === "podcast"
                    ? "e.g., Create an engaging episode about benchmarking coding agents with codebase understanding tools."
                    : "e.g., Focus on content relevant to building benchmarks to evaluate the value of augmenting coding agents with code search."
              }
              value={prompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setPrompt(e.target.value)
              }
              disabled={isLoading}
              rows={4}
              className="block w-full px-3 py-2 border border-surface-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none bg-surface text-black placeholder-muted"
            />
            <p className="text-xs text-muted mt-1">
              Leave empty for a comprehensive{" "}
              {type === "newsletter"
                ? "digest"
                : type === "podcast"
                  ? "episode"
                  : "audio digest"}
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 px-4 text-white font-medium rounded-md text-sm transition-colors bg-black hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? (
              <>Generating...</>
            ) : (
              <>
                {type === "newsletter"
                  ? "Generate Newsletter"
                  : type === "podcast"
                    ? "Generate Podcast"
                    : "Generate Audio Digest"}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
