/**
 * Podcast viewer component
 */

"use client";

import React, { useState, useCallback } from "react";

/**
 * Render markdown text as formatted HTML
 * Handles headings, lists, links, and bold text
 */
function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: string[] = [];
  let listKey = 0;

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${listKey++}`} className="list-disc list-inside space-y-1 my-2 ml-4">
          {currentList.map((item, idx) => (
            <li key={idx} className="text-sm text-foreground">
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };

  const renderInlineMarkdown = (line: string): React.ReactNode => {
    // Handle links [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let partKey = 0;

    while ((match = linkRegex.exec(line)) !== null) {
      // Add text before link
      if (match.index > lastIndex) {
        const beforeText = line.substring(lastIndex, match.index);
        parts.push(renderBold(beforeText, partKey++));
      }
      // Add link
      parts.push(
        <a
          key={partKey++}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-black hover:underline"
        >
          {match[1]}
        </a>
      );
      lastIndex = match.index + match[0].length;
    }
    // Add remaining text
    if (lastIndex < line.length) {
      parts.push(renderBold(line.substring(lastIndex), partKey++));
    }

    return parts.length > 0 ? <>{parts}</> : renderBold(line, 0);
  };

  const renderBold = (text: string, key: number): React.ReactNode => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={key}>
        {parts.map((part, idx) => {
          if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
            return <strong key={idx} className="font-semibold">{part.slice(2, -2)}</strong>;
          }
          return part;
        })}
      </span>
    );
  };

  lines.forEach((line, lineIdx) => {
    const trimmed = line.trim();

    // Headings
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={lineIdx} className="text-base font-semibold text-black mt-4 mb-2">
          {renderInlineMarkdown(trimmed.substring(4))}
        </h3>
      );
    } else if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={lineIdx} className="text-lg font-semibold text-black mt-6 mb-3">
          {renderInlineMarkdown(trimmed.substring(3))}
        </h2>
      );
    } else if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <h1 key={lineIdx} className="text-xl font-bold text-black mt-6 mb-4">
          {renderInlineMarkdown(trimmed.substring(2))}
        </h1>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      // List items
      const listItem = trimmed.substring(2).trim();
      if (listItem) {
        currentList.push(listItem);
      }
    } else if (trimmed === '') {
      // Empty line - flush list and add spacing
      flushList();
      elements.push(<div key={lineIdx} className="h-2" />);
    } else {
      // Regular paragraph
      flushList();
      elements.push(
        <p key={lineIdx} className="text-sm text-foreground my-2 leading-relaxed">
          {renderInlineMarkdown(trimmed)}
        </p>
      );
    }
  });

  flushList(); // Flush any remaining list items

  return <div className="space-y-2">{elements}</div>;
}

interface AudioState {
  isLoading: boolean;
  audioUrl: string | null;
  error: string | null;
  provider: string;
  voice: string;
}

interface PodcastSegment {
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
}

interface PodcastViewerProps {
  id: string;
  title: string;
  generatedAt: string;
  categories: string[];
  period: string;
  duration: string;
  itemsRetrieved: number;
  itemsIncluded: number;
  transcript: string;
  segments: PodcastSegment[];
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

/**
 * Format category name from slug to human-readable
 */
function formatCategoryName(slug: string): string {
  const specialCases: Record<string, string> = {
    'ai': 'AI',
  };

  return slug
    .split('_')
    .map(word => specialCases[word.toLowerCase()] || word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function PodcastViewer({
  id,
  title,
  generatedAt,
  categories,
  period,
  duration,
  // itemsRetrieved is in props for consistency but displayed via itemsIncluded
  itemsIncluded,
  transcript,
  segments,
  showNotes,
  generationMetadata,
}: PodcastViewerProps) {
  const [activeTab, setActiveTab] = useState<"segments" | "transcript" | "shownotes" | "metadata" | "audio">("segments");
  const [generatedDate, setGeneratedDate] = useState("");
  const [audioState, setAudioState] = useState<AudioState>({
    isLoading: false,
    audioUrl: null,
    error: null,
    provider: "openai",
    voice: "alloy",
  });

  React.useEffect(() => {
    setGeneratedDate(new Date(generatedAt).toLocaleString());
  }, [generatedAt]);

  const handleRenderAudio = useCallback(async () => {
    setAudioState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch("/api/podcast/render-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          provider: audioState.provider,
          voice: audioState.voice,
          format: "mp3",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to render audio: ${response.statusText}`);
      }

      const data = await response.json();
      setAudioState(prev => ({
        ...prev,
        isLoading: false,
        audioUrl: data.audioUrl,
      }));
      setActiveTab("audio");
    } catch (error) {
      setAudioState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to render audio",
      }));
    }
  }, [transcript, audioState.provider, audioState.voice]);

  const handleCopyTranscript = () => {
    navigator.clipboard.writeText(transcript);
    alert("Transcript copied to clipboard!");
  };

  const handleDownloadTranscript = () => {
    const element = document.createElement("a");
    element.setAttribute("href", `data:text/plain;charset=utf-8,${encodeURIComponent(transcript)}`);
    element.setAttribute("download", `${id}-transcript.txt`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleDownloadShowNotes = () => {
    const element = document.createElement("a");
    element.setAttribute("href", `data:text/markdown;charset=utf-8,${encodeURIComponent(showNotes)}`);
    element.setAttribute("download", `${id}-show-notes.md`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <div className="bg-surface rounded-lg border border-surface-border shadow-sm p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-black break-words">{title}</h2>
            <p className="text-sm text-muted mt-1">{generatedDate}</p>
          </div>
          <div className="text-left sm:text-right flex-shrink-0">
            <p className="text-2xl font-bold text-black">{duration}</p>
            <p className="text-xs text-muted">Episode Duration</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 pt-4 border-t border-surface-border">
          <div className="bg-gray-100 rounded p-2 sm:p-3 border border-gray-400 min-w-0">
            <p className="text-xs text-gray-700 font-semibold truncate">Period</p>
            <p className="text-base sm:text-lg font-bold text-black truncate">{period}</p>
          </div>
          <div className="bg-gray-100 rounded p-2 sm:p-3 border border-gray-400 min-w-0">
            <p className="text-xs text-gray-700 font-semibold truncate">Items</p>
            <p className="text-base sm:text-lg font-bold text-black truncate">{itemsIncluded}</p>
          </div>
          <div className="bg-gray-100 rounded p-2 sm:p-3 border border-gray-400 min-w-0 overflow-hidden">
            <p className="text-xs text-gray-700 font-semibold truncate">Voice</p>
            <p className="text-sm sm:text-lg font-bold text-black capitalize truncate overflow-hidden text-ellipsis whitespace-nowrap">{generationMetadata.voiceStyle}</p>
          </div>
        </div>

        {/* Categories */}
        <div className="pt-4 border-t border-surface-border">
          <p className="text-xs font-semibold text-muted uppercase mb-2">Categories</p>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <span key={cat} className="inline-block px-2 py-1 bg-gray-50 text-gray-600 text-xs rounded border border-gray-400">
                {formatCategoryName(cat)}
              </span>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={handleCopyTranscript}
            className="px-3 py-2 text-xs sm:text-sm border border-surface-border rounded hover:bg-surface hover:border-foreground text-foreground font-medium transition-colors whitespace-nowrap"
          >
            Copy Transcript
          </button>
          <button
            onClick={handleDownloadTranscript}
            className="px-3 py-2 text-xs sm:text-sm border border-surface-border rounded hover:bg-surface hover:border-foreground text-foreground font-medium transition-colors whitespace-nowrap"
          >
            Download TXT
          </button>
          <button
            onClick={handleDownloadShowNotes}
            className="px-3 py-2 text-xs sm:text-sm border border-surface-border rounded hover:bg-surface hover:border-foreground text-foreground font-medium transition-colors whitespace-nowrap"
          >
            Show Notes
          </button>
          <button
            onClick={handleRenderAudio}
            disabled={audioState.isLoading}
            className="px-3 py-2 text-xs sm:text-sm bg-black text-white rounded hover:bg-gray-800 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {audioState.isLoading ? "Rendering Audio..." : audioState.audioUrl ? "Re-render Audio" : "Render Audio"}
          </button>
        </div>

        {/* Audio Error */}
        {audioState.error && (
          <div className="bg-red-50 border border-red-300 rounded-lg p-3 text-red-700 text-sm">
            {audioState.error}
          </div>
        )}

      </div>

      {/* Content Card with Tabs */}
      <div className="bg-surface rounded-lg border border-surface-border shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="border-b border-surface-border flex overflow-x-auto scrollbar-hide">
          {(["segments", "transcript", "shownotes", "audio", "metadata"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition-colors cursor-pointer flex-shrink-0 ${
                activeTab === tab
                  ? "border-black text-black"
                  : "border-transparent text-muted hover:text-foreground hover:border-gray-300"
              }`}
            >
              {tab === "segments" && "Segments"}
              {tab === "transcript" && "Transcript"}
              {tab === "shownotes" && "Show Notes"}
              {tab === "audio" && "Audio"}
              {tab === "metadata" && "Metadata"}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-4 sm:p-6">
          {activeTab === "segments" && (
            <div className="space-y-3">
              {segments.length === 0 ? (
                <p className="text-muted py-8 text-center">No segments available</p>
              ) : (
                segments.map((segment, idx) => (
                  <div key={idx} className="border border-surface-border rounded-lg p-3 sm:p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-black break-words">{segment.title}</h3>
                        <p className="text-xs text-muted mt-1">
                          {segment.startTime} – {segment.endTime}
                        </p>
                      </div>
                    </div>

                    {/* Highlights */}
                    {segment.highlights && segment.highlights.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-foreground">Key Points</p>
                        <ul className="text-sm text-foreground space-y-1 list-disc list-inside">
                          {segment.highlights.map((highlight, hIdx) => (
                            <li key={hIdx}>{highlight}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Referenced Items */}
                    {segment.itemsReferenced && segment.itemsReferenced.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-foreground">References</p>
                        <div className="space-y-1">
                          {segment.itemsReferenced.map((item) => (
                            <a
                              key={item.id}
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-sm text-black hover:underline break-words"
                            >
                              {item.title}
                              <span className="text-muted text-xs ml-2 break-words">({item.sourceTitle})</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "transcript" && (
            <pre className="bg-white p-4 rounded border border-surface-border overflow-x-auto text-xs sm:text-sm text-black max-h-[600px] overflow-y-auto break-words whitespace-pre-wrap">
              {transcript}
            </pre>
          )}

          {activeTab === "shownotes" && (
            <div className="bg-white p-4 sm:p-6 rounded border border-surface-border max-h-[600px] overflow-y-auto">
              {renderMarkdown(showNotes)}
            </div>
          )}

          {activeTab === "audio" && (
            <div className="space-y-4">
              {audioState.audioUrl ? (
                <div className="space-y-4">
                  <div className="bg-gray-100 rounded-lg p-4 border border-gray-300">
                    <p className="text-sm text-gray-600 mb-3">Audio rendered successfully. Click play to listen:</p>
                    <audio controls className="w-full" src={audioState.audioUrl}>
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={audioState.audioUrl}
                      download={`${id}-audio.mp3`}
                      className="px-3 py-2 text-xs sm:text-sm bg-black !text-white rounded hover:bg-gray-800 font-medium transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Download MP3
                    </a>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted mb-4">No audio generated yet.</p>
                  <button
                    onClick={handleRenderAudio}
                    disabled={audioState.isLoading}
                    className="px-4 py-2 text-xs sm:text-sm bg-black text-white rounded hover:bg-gray-800 font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {audioState.isLoading ? "Rendering Audio..." : "Render Audio"}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "metadata" && (
            <div className="space-y-2 text-sm text-black">
              <p>
                <strong>ID:</strong> <code className="bg-gray-100 px-2 py-1 rounded text-xs border border-gray-300 text-black">{id}</code>
              </p>
              <p>
                <strong>Generated:</strong> {generatedDate}
              </p>
              <p>
                <strong>Period:</strong> {period}
              </p>
              <p>
                <strong>Duration:</strong> {duration}
              </p>
              <p>
                <strong>Model:</strong> {generationMetadata.modelUsed}
              </p>
              <p>
                <strong>Tokens:</strong> {generationMetadata.tokensUsed}
              </p>
              <p>
                <strong>Voice Style:</strong> <span className="capitalize">{generationMetadata.voiceStyle}</span>
              </p>
              <p>
                <strong>Generation Time:</strong> {generationMetadata.duration}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
