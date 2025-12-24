/**
 * Podcast viewer component
 */

"use client";

import React, { useState, useCallback } from "react";

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
      <div className="bg-surface rounded-lg border border-surface-border shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-black">{title}</h2>
            <p className="text-sm text-muted mt-1">{generatedDate}</p>
          </div>
          <div className="text-right">
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
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleCopyTranscript}
            className="px-3 py-2 text-sm border border-surface-border rounded hover:bg-surface hover:border-foreground text-foreground font-medium transition-colors"
          >
            Copy Transcript
          </button>
          <button
            onClick={handleDownloadTranscript}
            className="px-3 py-2 text-sm border border-surface-border rounded hover:bg-surface hover:border-foreground text-foreground font-medium transition-colors"
          >
            Download TXT
          </button>
          <button
            onClick={handleDownloadShowNotes}
            className="px-3 py-2 text-sm border border-surface-border rounded hover:bg-surface hover:border-foreground text-foreground font-medium transition-colors"
          >
            Show Notes
          </button>
          <button
            onClick={handleRenderAudio}
            disabled={audioState.isLoading}
            className="px-3 py-2 text-sm bg-black text-white rounded hover:bg-gray-800 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

        {/* Audio Settings */}
        <div className="flex gap-4 pt-2 border-t border-surface-border">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted">Provider:</label>
            <select
              value={audioState.provider}
              onChange={(e) => setAudioState(prev => ({ ...prev, provider: e.target.value }))}
              className="text-xs px-2 py-1 border border-surface-border rounded bg-surface text-foreground"
            >
              <option value="openai">OpenAI TTS</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="nemo">NVIDIA Nemo</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted">Voice:</label>
            <select
              value={audioState.voice}
              onChange={(e) => setAudioState(prev => ({ ...prev, voice: e.target.value }))}
              className="text-xs px-2 py-1 border border-surface-border rounded bg-surface text-foreground"
            >
              <option value="alloy">Alloy</option>
              <option value="echo">Echo</option>
              <option value="fable">Fable</option>
              <option value="onyx">Onyx</option>
              <option value="nova">Nova</option>
              <option value="shimmer">Shimmer</option>
            </select>
          </div>
        </div>
      </div>

      {/* Content Card with Tabs */}
      <div className="bg-surface rounded-lg border border-surface-border shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="border-b border-surface-border flex overflow-x-auto">
          {(["segments", "transcript", "shownotes", "audio", "metadata"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab
                  ? "border-black text-black"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab === "segments" && "Segments"}
              {tab === "transcript" && "Transcript"}
              {tab === "shownotes" && "Show Notes"}
              {tab === "audio" && (audioState.audioUrl ? "🔊 Audio" : "Audio")}
              {tab === "metadata" && "Metadata"}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === "segments" && (
            <div className="space-y-3">
              {segments.length === 0 ? (
                <p className="text-muted py-8 text-center">No segments available</p>
              ) : (
                segments.map((segment, idx) => (
                  <div key={idx} className="border border-surface-border rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-black">{segment.title}</h3>
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
                              className="block text-sm text-black hover:underline"
                            >
                              {item.title}
                              <span className="text-muted text-xs ml-2">({item.sourceTitle})</span>
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
            <pre className="bg-white p-4 rounded border border-surface-border overflow-x-auto text-sm text-black max-h-[600px] overflow-y-auto">
              {transcript}
            </pre>
          )}

          {activeTab === "shownotes" && (
            <pre className="bg-white p-4 rounded border border-surface-border overflow-x-auto text-sm text-black max-h-[600px] overflow-y-auto font-sans">
              {showNotes}
            </pre>
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
                      className="px-3 py-2 text-sm bg-black text-white rounded hover:bg-gray-800 font-medium transition-colors"
                    >
                      Download MP3
                    </a>
                    <button
                      onClick={handleRenderAudio}
                      disabled={audioState.isLoading}
                      className="px-3 py-2 text-sm border border-surface-border rounded hover:bg-surface text-foreground font-medium transition-colors"
                    >
                      {audioState.isLoading ? "Rendering..." : "Re-render with Different Settings"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted mb-4">No audio generated yet.</p>
                  <p className="text-sm text-muted mb-4">
                    Select your preferred provider and voice settings above, then click &quot;Render Audio&quot; to generate the audio file.
                  </p>
                  <button
                    onClick={handleRenderAudio}
                    disabled={audioState.isLoading}
                    className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800 font-medium transition-colors disabled:opacity-50"
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
