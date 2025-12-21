/**
 * Podcast viewer component
 */

"use client";

import React, { useState } from "react";

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
  const [activeTab, setActiveTab] = useState<"segments" | "transcript" | "shownotes" | "metadata">("segments");

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

  const generatedDate = new Date(generatedAt).toLocaleString();

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-600 mt-1">{generatedDate}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-blue-600">⏱️ {duration}</p>
            <p className="text-xs text-gray-500">Episode Duration</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-200">
          <div className="bg-blue-50 rounded p-3 border border-blue-200">
            <p className="text-xs text-blue-600 font-semibold">Period</p>
            <p className="text-lg font-bold text-blue-900">{period}</p>
          </div>
          <div className="bg-purple-50 rounded p-3 border border-purple-200">
            <p className="text-xs text-purple-600 font-semibold">Items</p>
            <p className="text-lg font-bold text-purple-900">{itemsIncluded}</p>
          </div>
          <div className="bg-green-50 rounded p-3 border border-green-200">
            <p className="text-xs text-green-600 font-semibold">Voice</p>
            <p className="text-lg font-bold text-green-900 capitalize">{generationMetadata.voiceStyle}</p>
          </div>
        </div>

        {/* Categories */}
        <div className="pt-4 border-t border-gray-200">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Categories</p>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <span key={cat} className="inline-block px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                {cat}
              </span>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleCopyTranscript}
            className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 text-gray-700 font-medium"
          >
            📋 Copy Transcript
          </button>
          <button
            onClick={handleDownloadTranscript}
            className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 text-gray-700 font-medium"
          >
            ⬇️ Download TXT
          </button>
          <button
            onClick={handleDownloadShowNotes}
            className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 text-gray-700 font-medium"
          >
            📝 Show Notes
          </button>
        </div>
      </div>

      {/* Content Card with Tabs */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="border-b border-gray-200 flex overflow-x-auto">
          {(["segments", "transcript", "shownotes", "metadata"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab === "segments" && "Segments"}
              {tab === "transcript" && "Transcript"}
              {tab === "shownotes" && "Show Notes"}
              {tab === "metadata" && "Metadata"}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === "segments" && (
            <div className="space-y-3">
              {segments.length === 0 ? (
                <p className="text-gray-500 py-8 text-center">No segments available</p>
              ) : (
                segments.map((segment, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-gray-900">{segment.title}</h3>
                        <p className="text-xs text-gray-500 mt-1">
                          {segment.startTime} – {segment.endTime}
                        </p>
                      </div>
                    </div>

                    {/* Highlights */}
                    {segment.highlights.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-600">Key Points</p>
                        <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                          {segment.highlights.map((highlight, hIdx) => (
                            <li key={hIdx}>{highlight}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Referenced Items */}
                    {segment.itemsReferenced.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-600">References</p>
                        <div className="space-y-1">
                          {segment.itemsReferenced.map((item) => (
                            <a
                              key={item.id}
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-sm text-blue-600 hover:underline"
                            >
                              {item.title}
                              <span className="text-gray-500 text-xs ml-2">({item.sourceTitle})</span>
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
            <pre className="bg-gray-50 p-4 rounded border border-gray-200 overflow-x-auto text-sm text-gray-700 max-h-[600px] overflow-y-auto">
              {transcript}
            </pre>
          )}

          {activeTab === "shownotes" && (
            <pre className="bg-gray-50 p-4 rounded border border-gray-200 overflow-x-auto text-sm text-gray-700 max-h-[600px] overflow-y-auto font-sans">
              {showNotes}
            </pre>
          )}

          {activeTab === "metadata" && (
            <div className="space-y-2 text-sm">
              <p>
                <strong>ID:</strong> <code className="bg-gray-100 px-2 py-1 rounded text-xs">{id}</code>
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
