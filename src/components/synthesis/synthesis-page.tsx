/**
 * Synthesis page wrapper with form and results
 */

"use client";

import React, { useState } from "react";
import { SynthesisForm, type SynthesisParams } from "./synthesis-form";
import { NewsletterViewer } from "./newsletter-viewer";
import { PodcastViewer } from "./podcast-viewer";

interface NewsletterResult {
  id: string;
  title: string;
  generatedAt: string;
  categories: string[];
  period: string;
  itemsRetrieved: number;
  itemsIncluded: number;
  summary: string;
  markdown: string;
  html: string;
  themes: string[];
  generationMetadata: {
    promptUsed: string;
    modelUsed: string;
    tokensUsed: number;
    duration: string;
    promptProfile?: Record<string, unknown>;
    rerankApplied: boolean;
  };
}

interface PodcastResult {
  id: string;
  title: string;
  generatedAt: string;
  categories: string[];
  period: string;
  duration: string;
  itemsRetrieved: number;
  itemsIncluded: number;
  transcript: string;
  segments: Array<{
    title: string;
    startTime: string;
    endTime: string;
    duration: number;
    itemsReferenced: Array<{
      id: string;
      title: string;
      url: string;
      sourceTitle: string;
    }>;
    highlights: string[];
  }>;
  showNotes: string;
  generationMetadata: {
    promptUsed: string;
    modelUsed: string;
    tokensUsed: number;
    voiceStyle: string;
    duration: string;
    promptProfile?: Record<string, unknown>;
  };
}

type SynthesisResult = NewsletterResult | PodcastResult;

interface SynthesisPageProps {
  type: "newsletter" | "podcast";
}

export function SynthesisPage({ type }: SynthesisPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);

  // Load from localStorage on mount (client-side only)
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(`synthesis-result-${type}`);
      if (saved) {
        setResult(JSON.parse(saved));
      }
    } catch (e) {
      console.warn("Failed to load from localStorage:", e);
    }
    setIsHydrated(true);
  }, [type]);

  // Persist result to localStorage on change (client-side only)
  React.useEffect(() => {
    if (isHydrated && result) {
      try {
        localStorage.setItem(`synthesis-result-${type}`, JSON.stringify(result));
      } catch (e) {
        console.warn("Failed to save to localStorage:", e);
      }
    }
  }, [result, type, isHydrated]);

  const handleGenerate = async (params: SynthesisParams) => {
    setIsLoading(true);
    setError(null);
    setLoadingProgress(0);

    // Simulate progress updates while waiting
    const progressInterval = setInterval(() => {
      setLoadingProgress(prev => Math.min(prev + Math.random() * 15, 90));
    }, 1000);

    try {
      const endpoint =
        type === "newsletter"
          ? "/api/newsletter/generate"
          : "/api/podcast/generate";

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min timeout

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: params.categories,
          period: params.period,
          limit: params.limit,
          ...(params.prompt && { prompt: params.prompt }),
          ...(type === "podcast" && { voiceStyle: params.voiceStyle }),
          ...(params.period === "custom" && params.customDateRange && {
            customDateRange: params.customDateRange,
          }),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      clearInterval(progressInterval);
      setLoadingProgress(95);

      if (!response.ok) {
        let errorMessage = `API error: ${response.statusText}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // If response isn't JSON, use the status text
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setLoadingProgress(100);
      setResult(data);
    } catch (err) {
      clearInterval(progressInterval);
      let message = "Unknown error occurred";
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          message = `Request timed out. ${type === "newsletter" ? "Newsletter" : "Podcast"} generation is taking too long. Try reducing the item limit or period.`;
        } else {
          message = err.message;
        }
      }
      setError(message);
      console.error("Generation error:", err);
    } finally {
      setIsLoading(false);
      setLoadingProgress(0);
    }
  };

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <div className="mb-4">
        <a
          href="/"
          className="inline-block px-4 py-2 rounded-md text-sm font-medium transition-colors bg-surface border border-surface-border text-muted hover:text-foreground"
        >
          ← Back to Home
        </a>
      </div>

      {/* Header */}
      <div className="space-y-2 mb-6">
        <h1 className="text-3xl font-bold text-white">
           {type === "newsletter" ? "Newsletter" : "Podcast"} Generator
         </h1>
        <p className="text-muted">
          {type === "newsletter"
            ? "Generate a curated newsletter from your selected content categories"
            : "Generate a podcast episode transcript from your selected content"}
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-4">
          <p className="text-sm font-semibold text-red-900">Error</p>
          <p className="text-sm text-red-800 mt-1">{error}</p>
        </div>
      )}

      {/* Success Alert */}
      {result && !isLoading && (
        <div className="bg-gray-100 border border-black rounded-lg p-4">
          <p className="text-sm font-semibold text-black">Success</p>
          <p className="text-sm text-black mt-1">
            {type === "newsletter" ? "Newsletter" : "Podcast"} generated successfully!
          </p>
        </div>
      )}

      {/* Progress Bar */}
      {isLoading && (
        <div className="bg-surface rounded-lg border border-surface-border p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-foreground">Generating {type}...</p>
            <p className="text-xs text-muted">{Math.round(loadingProgress)}%</p>
          </div>
          <div className="w-full bg-surface-border rounded-full h-2 overflow-hidden">
            <div
              className="bg-black h-full rounded-full transition-all duration-300"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Column - Sticky */}
        <div className="lg:col-span-1">
          <div className="sticky top-4">
            <SynthesisForm
              type={type}
              onGenerate={handleGenerate}
              isLoading={isLoading}
            />
          </div>
        </div>

        {/* Results Column */}
        <div className="lg:col-span-2">
          {result ? (
            <>
              {type === "newsletter" ? (
                <NewsletterViewer {...(result as NewsletterResult)} />
              ) : (
                <PodcastViewer {...(result as PodcastResult)} />
              )}
            </>
          ) : (
            <div className="bg-surface rounded-lg border border-surface-border p-12 text-center">
              <p className="text-muted">
                {type === "newsletter"
                  ? "Configure your newsletter settings and click 'Generate Newsletter' to get started"
                  : "Configure your podcast and click 'Generate Podcast' to get started"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
