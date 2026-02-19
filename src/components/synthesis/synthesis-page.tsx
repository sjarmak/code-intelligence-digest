/**
 * Synthesis page wrapper with form and results
 */

"use client";

import React, { useState } from "react";
import Link from "next/link";
import { SynthesisForm, type SynthesisParams } from "./synthesis-form";
import { NewsletterViewer } from "./newsletter-viewer";
import { PodcastViewer } from "./podcast-viewer";
import { AudioDigestViewer } from "./audio-digest-viewer";

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

interface AudioDigestResult {
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
    duration: string;
    promptProfile?: Record<string, unknown>;
  };
}

/** Saved podcast from user's list (audio only, no transcript) */
interface SavedPodcastResult {
  saved: true;
  id: string;
  title: string;
  audioUrl: string;
  createdAt: number;
  duration?: string;
}

type SynthesisResult = NewsletterResult | PodcastResult | AudioDigestResult | SavedPodcastResult;

const isNewsletterResult = (result: SynthesisResult): result is NewsletterResult =>
  'markdown' in result && !('saved' in result && result.saved);

const isPodcastResult = (result: SynthesisResult): result is PodcastResult =>
  'voiceStyle' in (result as PodcastResult).generationMetadata;

const isSavedPodcastResult = (result: SynthesisResult): result is SavedPodcastResult =>
  'saved' in result && result.saved && 'audioUrl' in result;

interface SynthesisPageProps {
  type: "newsletter" | "podcast" | "audio-digest";
}

interface PastNewsletterItem {
  id: string;
  title: string;
  createdAt: number;
}

interface PastPodcastItem {
  id: string;
  podcastId?: string;
  title?: string;
  provider: string;
  format: string;
  duration?: string;
  durationSeconds?: number;
  audioUrl: string;
  bytes: number;
  createdAt: number;
}

function formatSavedDate(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function SynthesisPage({ type }: SynthesisPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const resultRef = React.useRef<SynthesisResult | null>(null); // Ref to track result in stream handler

  const [pastNewsletters, setPastNewsletters] = useState<PastNewsletterItem[]>([]);
  const [pastPodcasts, setPastPodcasts] = useState<PastPodcastItem[]>([]);
  const [loadingPastNewsletters, setLoadingPastNewsletters] = useState(false);
  const [loadingPastPodcasts, setLoadingPastPodcasts] = useState(false);

  // Load from localStorage on mount (client-side only)
  // Only load on initial mount, not when type changes (to avoid overwriting new results)
  const hasLoadedFromStorage = React.useRef(false);
  React.useEffect(() => {
    if (hasLoadedFromStorage.current) return; // Only load once
    hasLoadedFromStorage.current = true;

    try {
      const saved = localStorage.getItem(`synthesis-result-${type}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && !parsed.saved) {
          console.log('Loaded result from localStorage on mount:', {
            id: parsed.id,
            title: parsed.title,
            duration: 'duration' in parsed ? parsed.duration : 'N/A',
            generatedAt: parsed.generatedAt,
            type: type
          });
          setResult(parsed);
        }
      }
    } catch (e) {
      console.warn("Failed to load from localStorage:", e);
    }
    setIsHydrated(true);
  }, [type]);

  const fetchPastNewsletters = React.useCallback(async () => {
    if (type !== "newsletter") return;
    setLoadingPastNewsletters(true);
    try {
      const res = await fetch("/api/generated-newsletters");
      if (!res.ok) throw new Error("Failed to load past newsletters");
      const data = await res.json();
      setPastNewsletters(
        (data.newsletters ?? []).map((n: { id: string; title: string; createdAt: number }) => ({
          id: n.id,
          title: n.title,
          createdAt: n.createdAt,
        }))
      );
    } catch (e) {
      console.warn("Failed to fetch past newsletters:", e);
      setPastNewsletters([]);
    } finally {
      setLoadingPastNewsletters(false);
    }
  }, [type]);

  const fetchPastPodcasts = React.useCallback(async () => {
    if (type !== "podcast") return;
    setLoadingPastPodcasts(true);
    try {
      const res = await fetch("/api/user-podcast-audio");
      if (!res.ok) throw new Error("Failed to load past podcasts");
      const data = await res.json();
      setPastPodcasts((data.podcasts ?? []).map((p: PastPodcastItem) => ({ ...p })));
    } catch (e) {
      console.warn("Failed to fetch past podcasts:", e);
      setPastPodcasts([]);
    } finally {
      setLoadingPastPodcasts(false);
    }
  }, [type]);

  React.useEffect(() => {
    if (type === "newsletter") fetchPastNewsletters();
  }, [type, fetchPastNewsletters]);

  React.useEffect(() => {
    if (type === "podcast") fetchPastPodcasts();
  }, [type, fetchPastPodcasts]);

  const handleSelectPastNewsletter = React.useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/generated-newsletters/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("Failed to load newsletter");
      const n = await res.json();
      const createdAtSec = typeof n.createdAt === "number" ? n.createdAt : 0;
      setResult({
        id: n.id,
        title: n.title,
        generatedAt: new Date(createdAtSec * 1000).toISOString(),
        categories: [],
        period: "",
        itemsRetrieved: 0,
        itemsIncluded: 0,
        summary: "",
        markdown: n.markdown ?? "",
        html: n.html ?? "",
        themes: [],
        generationMetadata: {
          promptUsed: "",
          modelUsed: "",
          tokensUsed: 0,
          duration: "",
          rerankApplied: false,
        },
      });
    } catch (e) {
      console.error("Failed to load past newsletter:", e);
      setError(e instanceof Error ? e.message : "Failed to load newsletter");
    }
  }, []);

  const handleDeletePastNewsletter = React.useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/generated-newsletters/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      setPastNewsletters((prev) => prev.filter((n) => n.id !== id));
      setResult((r) => (r && "id" in r && r.id === id ? null : r));
    } catch (e) {
      console.error("Failed to delete newsletter:", e);
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }, []);

  const handleSelectPastPodcast = React.useCallback((p: PastPodcastItem) => {
    setResult({
      saved: true,
      id: p.id,
      title: p.title?.trim() || `Podcast — ${formatSavedDate(p.createdAt)}`,
      audioUrl: p.audioUrl,
      createdAt: p.createdAt,
      duration: p.duration,
    });
  }, []);

  const handleDeletePastPodcast = React.useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/user-podcast-audio/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      setPastPodcasts((prev) => prev.filter((p) => p.id !== id));
      setResult((r) => (r && isSavedPodcastResult(r) && r.id === id ? null : r));
    } catch (e) {
      console.error("Failed to delete podcast:", e);
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }, []);

  // Persist result to localStorage on change (client-side only). Skip saved podcasts (reload from list).
  React.useEffect(() => {
    if (isHydrated && result && !isSavedPodcastResult(result)) {
      try {
        console.log('Saving result to localStorage:', {
          id: result.id,
          title: result.title,
          duration: 'duration' in result ? result.duration : 'N/A',
          generatedAt: result.generatedAt
        });
        localStorage.setItem(`synthesis-result-${type}`, JSON.stringify(result));
      } catch (e) {
        console.warn("Failed to save to localStorage:", e);
      }
    }
  }, [result, type, isHydrated]);

  const handleStreamingGeneration = async (
    endpoint: string,
    params: SynthesisParams,
    effectiveType: string,
    progressInterval: NodeJS.Timeout
  ) => {
    return new Promise<void>((resolve, reject) => {
      // Build request body
      const requestBody = {
        sourceMode: params.sourceMode,
        ...(params.categories && { categories: params.categories }),
        ...(params.period && { period: params.period }),
        ...(params.limit && { limit: params.limit }),
        ...(params.selectedItemIds && { selectedItemIds: params.selectedItemIds }),
        ...(params.prompt && { prompt: params.prompt }),
        ...(effectiveType === "audio-digest" && params.duration && { duration: params.duration }),
        ...(params.period === "custom" && params.customDateRange && {
          customDateRange: params.customDateRange,
        }),
      };

      // POST to create the stream, then use EventSource
      console.log('=== STARTING STREAMING REQUEST ===');
      console.log('Endpoint:', endpoint + '?stream=true');
      console.log('Request body:', JSON.stringify(requestBody, null, 2));

      fetch(endpoint + '?stream=true', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }).then(response => {
        console.log('Response status:', response.status, response.statusText);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.body;
      }).then(body => {
        if (!body) {
          throw new Error("No response body");
        }
        console.log('Stream body received, starting to read...');

        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let lastProgressTime = Date.now();
        const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes of inactivity

        const inactivityTimer = setInterval(() => {
          const timeSinceLastProgress = Date.now() - lastProgressTime;
          if (timeSinceLastProgress > INACTIVITY_TIMEOUT) {
            clearInterval(inactivityTimer);
            reader.cancel();
            reject(new Error(`No progress updates for ${INACTIVITY_TIMEOUT / 1000 / 60} minutes. Generation may have stalled.`));
          }
        }, 30000); // Check every 30 seconds

        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                console.log('Stream ended, result:', resultRef.current);
                // If stream ends without complete event, something went wrong
                if (!resultRef.current) {
                  clearInterval(inactivityTimer);
                  clearInterval(progressInterval);
                  reject(new Error('Stream ended unexpectedly without completion'));
                }
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              // SSE events are separated by double newlines
              const events = buffer.split('\n\n');
              buffer = events.pop() || ''; // Keep incomplete event in buffer

              for (const eventText of events) {
                if (eventText.trim() === '') continue;

                console.log('Processing SSE event text:', eventText.substring(0, 200));

                // Parse SSE format: "event: eventname\ndata: {...}"
                const lines = eventText.split('\n');
                let eventName = '';
                let dataStr = '';

                for (const line of lines) {
                  if (line.startsWith('event: ')) {
                    eventName = line.substring(7).trim();
                  } else if (line.startsWith('data: ')) {
                    dataStr = line.substring(6).trim();
                  }
                }

                console.log('Parsed event:', eventName, 'data length:', dataStr.length);

                if (eventName && dataStr) {
                  try {
                    const parsed = JSON.parse(dataStr);
                    lastProgressTime = Date.now();

                    if (eventName === 'progress') {
                      setProgressMessage(parsed.message || 'Processing...');
                      if (parsed.progress !== undefined) {
                        setLoadingProgress(parsed.progress);
                      } else {
                        // Increment progress slightly if not specified
                        setLoadingProgress(prev => Math.min(prev + 1, 90));
                      }
                    } else if (eventName === 'complete') {
                      console.log('=== COMPLETE EVENT RECEIVED ===');
                      console.log('Raw parsed data:', parsed);
                      console.log('Has id:', 'id' in parsed);
                      console.log('Has duration:', 'duration' in parsed);
                      console.log('Has transcript:', 'transcript' in parsed);

                      clearInterval(inactivityTimer);
                      clearInterval(progressInterval);
                      setLoadingProgress(100);
                      setProgressMessage('Generation complete!');
                      // Set result - this will trigger localStorage save via useEffect
                      // Complete event is always AudioDigestResult when streaming audio-digest
                      const newResult = parsed as AudioDigestResult;
                      console.log('Setting result from complete event:', {
                        id: newResult.id,
                        title: newResult.title,
                        duration: newResult.duration,
                        generatedAt: newResult.generatedAt,
                        transcriptLength: newResult.transcript?.length ?? 0
                      });

                      // Verify the result has all required fields
                      if (!newResult.id || !newResult.generatedAt) {
                        console.error('Invalid result from complete event:', newResult);
                        reject(new Error('Received incomplete result from server'));
                        return;
                      }

                      resultRef.current = newResult;
                      // Force clear old result first, then set new one to ensure React updates
                      console.log('Clearing old result...');
                      setResult(null);
                      // Use requestAnimationFrame to ensure DOM update
                      requestAnimationFrame(() => {
                        console.log('Setting new result in requestAnimationFrame:', newResult.id);
                        setResult(newResult);
                        setIsLoading(false);
                        console.log('New result set, should be visible now. ID:', newResult.id);
                        // Double-check it was set
                        setTimeout(() => {
                          console.log('After 100ms, result state:', resultRef.current?.id);
                        }, 100);
                        resolve();
                      });
                      return;
                    } else if (eventName === 'error') {
                      clearInterval(inactivityTimer);
                      clearInterval(progressInterval);
                      reject(new Error(parsed.error || 'Unknown error'));
                      return;
                    }
                  } catch (e) {
                    console.warn('Failed to parse SSE event:', e, eventText);
                  }
                }
              }
            }
          } catch (error) {
            clearInterval(inactivityTimer);
            clearInterval(progressInterval);
            reject(error);
          }
        };

        processStream();
      }).catch(error => {
        clearInterval(progressInterval);
        reject(error);
      });
    });
  };

  const handleGenerate = async (params: SynthesisParams) => {
    setIsLoading(true);
    setError(null);
    setLoadingProgress(0);
    setProgressMessage('Initializing...');
    setResult(null); // Clear previous result when starting new generation

    // Clear localStorage for this type to avoid showing stale results
    try {
      localStorage.removeItem(`synthesis-result-${type}`);
    } catch (e) {
      // Ignore localStorage errors
    }

    // Simulate progress updates while waiting (for non-streaming)
    // Progress messages should reflect what's actually happening based on sourceMode
    const isDigestLibrary = params.sourceMode === "auto";
    const isManualSelection = params.sourceMode === "manual";

    if (isDigestLibrary) {
      setProgressMessage('Loading items from digest library...');
    } else if (isManualSelection) {
      setProgressMessage('Loading selected items...');
    } else {
      setProgressMessage('Retrieving items from database...');
    }

    const progressInterval = setInterval(() => {
      setLoadingProgress(prev => {
        // Only increment if we haven't reached a high progress yet
        // This prevents jumping to 90% and then going backwards
        if (prev >= 90) {
          return prev; // Don't go above 90% until we get real progress updates
        }
        const increment = Math.random() * 10; // Smaller increments
        const newProgress = Math.min(prev + increment, 90);

        // Update progress message based on sourceMode and progress
        if (isDigestLibrary) {
          if (newProgress < 40) {
            setProgressMessage('Loading items from digest library...');
          } else if (newProgress < 80) {
            setProgressMessage('Generating content...');
          } else {
            setProgressMessage('Finalizing...');
          }
        } else if (isManualSelection) {
          if (newProgress < 40) {
            setProgressMessage('Loading selected items...');
          } else if (newProgress < 80) {
            setProgressMessage('Generating content...');
          } else {
            setProgressMessage('Finalizing...');
          }
        } else {
          // Categories mode - actual retrieval and ranking happens
          if (newProgress < 20) {
            setProgressMessage('Retrieving items from database...');
          } else if (newProgress < 50) {
            setProgressMessage('Ranking and selecting items...');
          } else if (newProgress < 80) {
            setProgressMessage('Generating content...');
          } else {
            setProgressMessage('Finalizing...');
          }
        }
        return newProgress;
      });
    }, 1000);

    let timeoutId: NodeJS.Timeout | null = null;
    let controller: AbortController | null = null;

    try {
      // Use params.type (which may be "audio-digest" if podcast mode is "highlights")
      const effectiveType = params.type || type;
      const endpoint =
        effectiveType === "newsletter"
          ? "/api/newsletter/generate"
          : effectiveType === "podcast"
          ? "/api/podcast/generate"
          : "/api/audio-digest/generate";

      // For audio-digest, use SSE streaming for progress updates
      if (effectiveType === "audio-digest" || type === "audio-digest") {
        await handleStreamingGeneration(endpoint, params, effectiveType, progressInterval);
        return; // Exit early after streaming completes
      }

      // For other types, use regular fetch
      setProgressMessage('Sending request...');
      controller = new AbortController();
      const timeoutDuration = 10 * 60 * 1000; // 10 min for non-audio-digest
      timeoutId = setTimeout(() => {
        controller?.abort();
        console.warn(`Request timeout after ${timeoutDuration / 1000 / 60} minutes`);
      }, timeoutDuration);

      setProgressMessage('Processing request...');
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceMode: params.sourceMode,
          ...(params.categories && { categories: params.categories }),
          ...(params.period && { period: params.period }),
          ...(params.limit && { limit: params.limit }),
          ...(params.selectedItemIds && { selectedItemIds: params.selectedItemIds }),
          ...(params.prompt && { prompt: params.prompt }),
          ...(effectiveType === "podcast" && params.voiceStyle && { voiceStyle: params.voiceStyle }),
          // Note: audio-digest is handled above with streaming, so duration not needed here
          ...(params.period === "custom" && params.customDateRange && {
            customDateRange: params.customDateRange,
          }),
        }),
        signal: controller!.signal,
      });

      if (timeoutId) clearTimeout(timeoutId);
      clearInterval(progressInterval);
      setLoadingProgress(95);
      setProgressMessage('Processing response...');

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
      setProgressMessage('Complete!');
      setResult(data);
      if (type === "newsletter") fetchPastNewsletters();
    } catch (err) {
      console.error('=== Generation error caught ===', err);
      clearInterval(progressInterval);
      if (timeoutId) clearTimeout(timeoutId);
      let message = "Unknown error occurred";
      if (err instanceof Error) {
        console.error('Error details:', {
          name: err.name,
          message: err.message,
          stack: err.stack
        });
        if (err.name === "AbortError" || err.message.includes("aborted")) {
          const typeLabel = type === "newsletter" ? "Newsletter" : type === "podcast" ? "Podcast" : "Audio Digest";
          const effectiveType = params.type || type;
          // For streaming, timeout means inactivity (no progress updates)
          if (effectiveType === "audio-digest" || type === "audio-digest") {
            message = err.message.includes("inactivity")
              ? err.message
              : `No progress updates received. Generation may have stalled. Please check server logs or try again.`;
          } else {
            message = `Request timed out. ${typeLabel} generation is taking too long. Try reducing the item limit or period.`;
          }
        } else {
          message = err.message;
        }
      }
      setError(message);
      setProgressMessage(null);
      console.error("Generation error:", err);
    } finally {
      setIsLoading(false);
      setLoadingProgress(0);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 space-y-6">
      {/* Back Button */}
      <div className="mb-4">
        <Link
          href="/"
          className="inline-block px-4 py-2 rounded-md text-sm font-medium transition-colors bg-surface border border-surface-border text-muted hover:text-foreground"
        >
          ← Back to Home
        </Link>
      </div>

      {/* Header */}
      <div className="space-y-2 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">
               {type === "newsletter" ? "Newsletter" : type === "podcast" ? "Podcast" : "Audio Digest"} Generator
             </h1>
            <p className="text-muted">
              {type === "newsletter"
                ? "Generate a curated newsletter from your selected content categories"
                : type === "podcast"
                ? "Generate a podcast episode transcript from your selected content"
                : "Generate an audio digest with highlights from articles and research papers"}
            </p>
          </div>
        </div>
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
            {type === "newsletter" ? "Newsletter" : type === "podcast" ? "Podcast" : "Audio Digest"} generated successfully!
          </p>
        </div>
      )}

      {/* Progress Bar */}
      {isLoading && (
        <div className="bg-surface rounded-lg border border-surface-border p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-foreground">
              {progressMessage || `Generating ${type}...`}
            </p>
            <p className="text-xs text-muted">{Math.round(loadingProgress)}%</p>
          </div>
          <div className="w-full bg-surface-border rounded-full h-2 overflow-hidden">
            <div
              className="bg-black h-full rounded-full transition-all duration-300"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
          {progressMessage && (
            <p className="text-xs text-muted mt-2">{progressMessage}</p>
          )}
        </div>
      )}

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Column - scrollable when tall (e.g. categories + limit) so all controls are reachable */}
        <div className="lg:col-span-1 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:pr-1">
          <div className="space-y-6">
            {type === "newsletter" && (
              <div className="bg-surface rounded-lg border border-surface-border p-4">
                <h3 className="text-sm font-semibold text-foreground mb-1">Your saved newsletters</h3>
                <p className="text-xs text-muted mb-3">Each generated newsletter is saved automatically. Click one to open it, or delete it.</p>
                {loadingPastNewsletters ? (
                  <p className="text-xs text-muted">Loading…</p>
                ) : pastNewsletters.length === 0 ? (
                  <p className="text-xs text-muted">No saved newsletters yet. Generate one below.</p>
                ) : (
                  <ul className="space-y-2 max-h-60 overflow-y-auto">
                    {pastNewsletters.map((n) => (
                      <li
                        key={n.id}
                        className="flex items-center justify-between gap-2 text-sm border-b border-surface-border pb-2 last:border-0 last:pb-0"
                      >
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => handleSelectPastNewsletter(n.id)}
                            className="text-left font-medium text-foreground hover:underline truncate block w-full"
                          >
                            {n.title || "Untitled"}
                          </button>
                          <p className="text-xs text-muted">{formatSavedDate(n.createdAt)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeletePastNewsletter(n.id)}
                          className="shrink-0 px-2 py-1 text-xs rounded border border-surface-border bg-surface text-muted hover:text-red-600 hover:border-red-300"
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {type === "podcast" && (
              <div className="bg-surface rounded-lg border border-surface-border p-4">
                <h3 className="text-sm font-semibold text-foreground mb-1">Your saved podcasts</h3>
                <p className="text-xs text-muted mb-3">Rendered audio is saved automatically. Click one to play, or delete it.</p>
                {loadingPastPodcasts ? (
                  <p className="text-xs text-muted">Loading…</p>
                ) : pastPodcasts.length === 0 ? (
                  <p className="text-xs text-muted">No saved podcasts yet. Generate and render audio below.</p>
                ) : (
                  <ul className="space-y-2 max-h-60 overflow-y-auto">
                    {pastPodcasts.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 text-sm border-b border-surface-border pb-2 last:border-0 last:pb-0"
                      >
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => handleSelectPastPodcast(p)}
                            className="text-left font-medium text-foreground hover:underline block w-full"
                          >
                            {p.title?.trim() || `Podcast — ${formatSavedDate(p.createdAt)}`}
                            {p.duration ? ` · ${p.duration}` : ""}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeletePastPodcast(p.id)}
                          className="shrink-0 px-2 py-1 text-xs rounded border border-surface-border bg-surface text-muted hover:text-red-600 hover:border-red-300"
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
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
              {isSavedPodcastResult(result) ? (
                <div className="bg-surface rounded-lg border border-surface-border p-6">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <h2 className="text-xl font-semibold text-foreground">{result.title}</h2>
                    <button
                      type="button"
                      onClick={() => handleDeletePastPodcast(result.id)}
                      className="px-3 py-1.5 text-sm rounded border border-surface-border bg-surface text-muted hover:text-red-600 hover:border-red-300"
                    >
                      Delete
                    </button>
                  </div>
                  <p className="text-sm text-muted mb-4">{formatSavedDate(result.createdAt)}</p>
                  <audio
                    controls
                    className="w-full"
                    src={result.audioUrl}
                    preload="metadata"
                  >
                    Your browser does not support the audio element.
                  </audio>
                </div>
              ) : isNewsletterResult(result) ? (
                <NewsletterViewer {...result} />
              ) : isPodcastResult(result) ? (
                <PodcastViewer {...result} />
              ) : (
                <>
                  {/* Debug info - remove in production */}
                  {process.env.NODE_ENV === 'development' && 'generatedAt' in result && (
                    <div className="mb-4 p-2 bg-gray-100 text-xs">
                      Result ID: {result.id},
                      Duration: {'duration' in result ? result.duration : 'N/A'},
                      Generated: {result.generatedAt}
                    </div>
                  )}
                  <AudioDigestViewer {...(result as AudioDigestResult)} />
                </>
              )}
            </>
          ) : (
            <div className="bg-surface rounded-lg border border-surface-border p-12 text-center">
              <p className="text-muted">
                {type === "newsletter"
                  ? "Configure your newsletter settings and click 'Generate Newsletter' to get started"
                  : type === "podcast"
                  ? "Configure your podcast and click 'Generate Podcast' to get started"
                  : "Configure your audio digest settings and click 'Generate Audio Digest' to get started"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
