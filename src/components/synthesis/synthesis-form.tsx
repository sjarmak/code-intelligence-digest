/**
 * Synthesis form for newsletter and podcast generation
 */

"use client";

import React, { useState } from "react";
import { type Category } from "@/src/lib/model";

interface SynthesisFormProps {
  onGenerate: (params: SynthesisParams) => Promise<void>;
  isLoading?: boolean;
  type: "newsletter" | "podcast";
}

export interface SynthesisParams {
  type: "newsletter" | "podcast";
  categories: Category[];
  period: "week" | "month";
  limit: number;
  prompt?: string;
  voiceStyle?: "conversational" | "technical" | "executive";
}

const ALLOWED_CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "product_news",
  "community",
  "research",
];

const CATEGORY_LABELS: Record<Category, string> = {
  newsletters: "Newsletters",
  podcasts: "Podcasts",
  tech_articles: "Tech Articles",
  ai_news: "AI News",
  product_news: "Product News",
  community: "Community",
  research: "Research",
};

export function SynthesisForm({
  onGenerate,
  isLoading = false,
  type,
}: SynthesisFormProps) {
  const [selectedCategories, setSelectedCategories] = useState<Category[]>(
    ALLOWED_CATEGORIES
  );
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [limit, setLimit] = useState(50);
  const [prompt, setPrompt] = useState(
    "Focus on code search, coding agents, context management for agents, information retrieval for code, and developer productivity with AI tools. Prioritize research papers, technical articles, and product announcements that demonstrate actual progress in these areas. Filter out benchmarking studies that don't address practical developer needs."
  );
  const [voiceStyle, setVoiceStyle] = useState<"conversational" | "technical" | "executive">(
    "conversational"
  );

  const handleCategoryToggle = (category: Category) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedCategories.length === 0) {
      alert("Please select at least one category");
      return;
    }

    await onGenerate({
      type,
      categories: selectedCategories,
      period,
      limit,
      prompt: prompt || undefined,
      ...(type === "podcast" && { voiceStyle }),
    });
  };

  return (
    <div className="bg-surface rounded-lg border border-surface-border shadow-sm">
      <div className="border-b border-surface-border px-6 py-4">
        <h2 className="text-lg font-bold text-black">
          {type === "newsletter" ? "Generate Newsletter" : "Generate Podcast"}
        </h2>
        <p className="text-sm text-muted mt-1">
          {type === "newsletter"
            ? "Create a curated newsletter from selected content categories"
            : "Create an episode transcript from selected content"}
        </p>
      </div>
      <div className="px-6 py-4">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Categories */}
          <div>
            <label className="block text-sm font-semibold text-black mb-3">Content Categories</label>
            <div className="grid grid-cols-2 gap-3">
              {ALLOWED_CATEGORIES.map((category) => (
                <div key={category} className="flex items-center">
                  <input
                    type="checkbox"
                    id={category}
                    checked={selectedCategories.includes(category)}
                    onChange={() => handleCategoryToggle(category)}
                    disabled={isLoading}
                    className="rounded border-surface-border text-black focus:ring-black bg-surface"
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

          {/* Period */}
          <div>
            <label className="block text-sm font-semibold text-black mb-3">Time Period</label>
            <div className="space-y-2">
              <div className="flex items-center">
                <input
                  type="radio"
                  id="week"
                  name="period"
                  value="week"
                  checked={period === "week"}
                  onChange={(e) => setPeriod(e.target.value as "week" | "month")}
                  disabled={isLoading}
                  className="text-black focus:ring-black"
                />
                <label htmlFor="week" className="ml-2 text-sm text-foreground cursor-pointer">
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
                  onChange={(e) => setPeriod(e.target.value as "week" | "month")}
                  disabled={isLoading}
                  className="text-black focus:ring-black"
                />
                <label htmlFor="month" className="ml-2 text-sm text-foreground cursor-pointer">
                  This Month (30 days)
                </label>
              </div>
            </div>
          </div>

          {/* Limit */}
          <div>
            <label htmlFor="limit" className="block text-sm font-semibold text-black mb-2">
              Item Limit
            </label>
            <input
              id="limit"
              type="number"
              min="1"
              max="50"
              value={limit}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLimit(Math.max(1, Math.min(50, parseInt(e.target.value) || 15)))}
              disabled={isLoading}
              className="block w-20 px-3 py-2 border border-surface-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-black bg-surface text-black"
            />
            <p className="text-xs text-muted mt-1">Max items to retrieve (1-50)</p>
          </div>

          {/* Voice Style (Podcast only) */}
          {type === "podcast" && (
            <div>
              <label htmlFor="voiceStyle" className="block text-sm font-semibold text-black mb-2">
                Voice Style
              </label>
              <select
                id="voiceStyle"
                value={voiceStyle}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setVoiceStyle(e.target.value as "conversational" | "technical" | "executive")}
                disabled={isLoading}
                className="block w-full px-3 py-2 border border-surface-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-black bg-surface text-black"
              >
                <option value="conversational">Conversational</option>
                <option value="technical">Technical</option>
                <option value="executive">Executive</option>
              </select>
            </div>
          )}

          {/* Prompt */}
          <div>
            <label htmlFor="prompt" className="block text-sm font-semibold text-black mb-2">
              Optional Guidance (Prompt)
            </label>
            <textarea
              id="prompt"
              placeholder={
                type === "newsletter"
                  ? "e.g., Focus on code search and developer productivity. Emphasize actionable takeaways."
                  : "e.g., Create an engaging episode about AI agents for code review. Target tech leads."
              }
              value={prompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
              disabled={isLoading}
              rows={4}
              className="block w-full px-3 py-2 border border-surface-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-black resize-none bg-surface text-black placeholder-muted"
            />
            <p className="text-xs text-muted mt-1">
              Leave empty for a comprehensive {type === "newsletter" ? "digest" : "episode"}
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 px-4 bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white font-medium rounded-md text-sm transition-colors"
          >
            {isLoading ? (
              <>
                Generating...
              </>
            ) : (
              <>
                {type === "newsletter" ? "Generate Newsletter" : "Generate Podcast"}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
