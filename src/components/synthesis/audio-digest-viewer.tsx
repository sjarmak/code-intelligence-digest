/**
 * Audio Digest viewer component
 */

"use client";

import React, { useState } from "react";

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
    } else if (trimmed.startsWith('> ')) {
      // Blockquote
      flushList();
      elements.push(
        <blockquote key={lineIdx} className="border-l-4 border-gray-300 pl-4 my-2 italic text-sm text-gray-700">
          {renderInlineMarkdown(trimmed.substring(2))}
        </blockquote>
      );
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

interface AudioDigestSegment {
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

interface AudioDigestViewerProps {
  id: string;
  title: string;
  generatedAt: string;
  categories: string[];
  period: string;
  duration: string;
  itemsRetrieved: number;
  itemsIncluded: number;
  transcript: string;
  segments: AudioDigestSegment[];
  showNotes: string;
  generationMetadata: {
    promptUsed: string;
    modelUsed: string;
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

interface AudioState {
  isLoading: boolean;
  audioUrl: string | null;
  error: string | null;
  provider: string;
  voice: string;
}

export function AudioDigestViewer({
  id,
  title,
  generatedAt,
  categories,
  period,
  duration,
  itemsIncluded,
  transcript,
  segments,
  showNotes,
  generationMetadata,
}: AudioDigestViewerProps) {
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

  const handleRenderAudio = React.useCallback(async () => {
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

      if (!data.audioUrl) {
        throw new Error("Server returned success but no audio URL");
      }

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
            <p className="text-xs text-muted">Estimated Duration</p>
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
            <p className="text-xs text-gray-700 font-semibold truncate">Segments</p>
            <p className="text-sm sm:text-lg font-bold text-black truncate overflow-hidden text-ellipsis whitespace-nowrap">{segments.length}</p>
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
            onClick={handleRenderAudio}
            disabled={audioState.isLoading}
            className="px-3 py-2 text-xs sm:text-sm bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white font-medium rounded transition-colors whitespace-nowrap"
          >
            {audioState.isLoading ? "Rendering..." : "Render Audio"}
          </button>
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
            Download Show Notes
          </button>
        </div>

        {/* Audio Error */}
        {audioState.error && (
          <div className="mt-2 p-2 bg-red-50 border border-red-300 rounded text-sm text-red-800">
            {audioState.error}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-surface rounded-lg border border-surface-border shadow-sm">
        <div className="border-b border-surface-border">
          <nav className="flex -mb-px">
            <button
              onClick={() => setActiveTab("segments")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "segments"
                  ? "border-black text-black"
                  : "border-transparent text-muted hover:text-foreground hover:border-gray-300"
              }`}
            >
              Segments
            </button>
            <button
              onClick={() => setActiveTab("transcript")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "transcript"
                  ? "border-black text-black"
                  : "border-transparent text-muted hover:text-foreground hover:border-gray-300"
              }`}
            >
              Transcript
            </button>
            <button
              onClick={() => setActiveTab("shownotes")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "shownotes"
                  ? "border-black text-black"
                  : "border-transparent text-muted hover:text-foreground hover:border-gray-300"
              }`}
            >
              Show Notes
            </button>
            <button
              onClick={() => setActiveTab("metadata")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "metadata"
                  ? "border-black text-black"
                  : "border-transparent text-muted hover:text-foreground hover:border-gray-300"
              }`}
            >
              Metadata
            </button>
            <button
              onClick={() => setActiveTab("audio")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "audio"
                  ? "border-black text-black"
                  : "border-transparent text-muted hover:text-foreground hover:border-gray-300"
              }`}
            >
              Audio
            </button>
          </nav>
        </div>

        <div className="p-4 sm:p-6">
          {activeTab === "segments" && (
            <div className="space-y-4">
              {segments.length === 0 ? (
                <p className="text-sm text-muted">No segments available.</p>
              ) : (
                segments.map((segment, idx) => (
                  <div key={idx} className="border border-surface-border rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <h3 className="text-lg font-semibold text-black">{segment.title}</h3>
                      <span className="text-sm text-muted whitespace-nowrap ml-4">
                        {segment.startTime} - {segment.endTime}
                      </span>
                    </div>
                    {segment.itemsReferenced.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted uppercase mb-2">Referenced Items</p>
                        <ul className="space-y-1">
                          {segment.itemsReferenced.map((item) => (
                            <li key={item.id} className="text-sm">
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-black hover:underline"
                              >
                                {item.title}
                              </a>
                              <span className="text-muted ml-2">({item.sourceTitle})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {segment.highlights.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted uppercase mb-2">Highlights</p>
                        <ul className="list-disc list-inside space-y-1">
                          {segment.highlights.map((highlight, hIdx) => (
                            <li key={hIdx} className="text-sm text-foreground">{highlight}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "transcript" && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                  {transcript}
                </pre>
              </div>
            </div>
          )}

          {activeTab === "shownotes" && (
            <div className="space-y-4">
              <div className="prose prose-sm max-w-none">
                {renderMarkdown(showNotes)}
              </div>
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
                  <div className="space-y-4 max-w-md mx-auto">
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-black">Provider</label>
                      <select
                        value={audioState.provider}
                        onChange={(e) => setAudioState(prev => ({ ...prev, provider: e.target.value }))}
                        className="px-3 py-2 border border-surface-border rounded text-sm"
                      >
                        <option value="openai">OpenAI</option>
                        <option value="elevenlabs">ElevenLabs</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-black">Voice</label>
                      <select
                        value={audioState.voice}
                        onChange={(e) => setAudioState(prev => ({ ...prev, voice: e.target.value }))}
                        className="px-3 py-2 border border-surface-border rounded text-sm"
                      >
                        <option value="alloy">Alloy</option>
                        <option value="echo">Echo</option>
                        <option value="fable">Fable</option>
                        <option value="onyx">Onyx</option>
                        <option value="nova">Nova</option>
                        <option value="shimmer">Shimmer</option>
                      </select>
                    </div>
                    <button
                      onClick={handleRenderAudio}
                      disabled={audioState.isLoading}
                      className="px-4 py-2 text-xs sm:text-sm bg-black text-white rounded hover:bg-gray-800 font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {audioState.isLoading ? "Rendering Audio..." : "Render Audio"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "metadata" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-muted uppercase mb-1">Model</p>
                  <p className="text-sm text-foreground">{generationMetadata.modelUsed}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted uppercase mb-1">Generation Time</p>
                  <p className="text-sm text-foreground">{generationMetadata.duration}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs font-semibold text-muted uppercase mb-1">Prompt</p>
                  <p className="text-sm text-foreground bg-gray-50 rounded p-2 border border-gray-200">
                    {generationMetadata.promptUsed || "None"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
