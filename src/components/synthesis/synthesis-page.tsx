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

  const handleGenerate = async (params: SynthesisParams) => {
    setIsLoading(true);
    setError(null);

    try {
      const endpoint =
        type === "newsletter"
          ? "/api/newsletter/generate"
          : "/api/podcast/generate";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: params.categories,
          period: params.period,
          limit: params.limit,
          ...(params.prompt && { prompt: params.prompt }),
          ...(type === "podcast" && { voiceStyle: params.voiceStyle }),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API error: ${response.statusText}`);
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error occurred";
      setError(message);
      console.error("Generation error:", err);
    } finally {
      setIsLoading(false);
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
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
          <p className="text-sm font-semibold text-red-200">Error</p>
          <p className="text-sm text-red-100 mt-1">{error}</p>
        </div>
      )}

      {/* Success Alert */}
      {result && !isLoading && (
        <div className="bg-green-900/30 border border-green-700 rounded-lg p-4">
          <p className="text-sm font-semibold text-green-200">Success</p>
          <p className="text-sm text-green-100 mt-1">
            {type === "newsletter" ? "Newsletter" : "Podcast"} generated successfully!
          </p>
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
