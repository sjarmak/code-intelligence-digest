/**
 * "Publish to website" control — sends a generated newsletter/podcast to the
 * personal website's /digest library via POST /api/publish-digest. Lets the user
 * confirm cadence, summary, and topics before publishing (no heuristic scraping).
 */

"use client";

import React, { useState } from "react";

interface PublishItem {
  title: string;
  url: string;
  source?: string;
  category?: string;
}

interface PublishToWebsiteProps {
  kind: "newsletter" | "podcast";
  defaultTitle: string;
  defaultSummary: string;
  defaultTopics: string[];
  bodyMarkdown: string;
  items?: PublishItem[];
  highlights?: string[];
  audioUrl?: string | null;
  /** Podcast duration as "MM:SS" or "HH:MM:SS"; parsed to seconds. */
  durationStr?: string;
}

interface PublishState {
  status: "idle" | "loading" | "done" | "error";
  slug?: string;
  message?: string;
}

function durationToSeconds(value?: string): number | undefined {
  if (!value) return undefined;
  const parts = value.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function PublishToWebsite({
  kind,
  defaultTitle,
  defaultSummary,
  defaultTopics,
  bodyMarkdown,
  items,
  highlights,
  audioUrl,
  durationStr,
}: PublishToWebsiteProps) {
  const [open, setOpen] = useState(false);
  const [cadence, setCadence] = useState<"daily" | "weekly" | "manual">("manual");
  const [title, setTitle] = useState(defaultTitle);
  const [summary, setSummary] = useState(defaultSummary);
  const [topics, setTopics] = useState(defaultTopics.join(", "));
  const [push, setPush] = useState(false);
  const [state, setState] = useState<PublishState>({ status: "idle" });

  const handlePublish = async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/publish-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          cadence,
          summary: summary.trim(),
          topics: topics
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          bodyMarkdown,
          items: items ?? [],
          highlights: highlights ?? [],
          audioUrl: audioUrl ?? undefined,
          durationSec: durationToSeconds(durationStr),
          push,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setState({ status: "error", message: data.error ?? response.statusText });
        return;
      }
      setState({ status: "done", slug: data.slug, message: data.pushed ? "published & pushed" : "committed locally" });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "Request failed" });
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-2 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700 font-medium transition-colors whitespace-nowrap"
      >
        Publish to website
      </button>
    );
  }

  return (
    <div className="w-full bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">Publish to /digest</p>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-gray-900">
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-gray-600 space-y-1">
          <span className="block font-medium">Cadence</span>
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as typeof cadence)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-900"
          >
            <option value="manual">Curated (manual)</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        <label className="text-xs text-gray-600 space-y-1">
          <span className="block font-medium">Topics (comma-separated)</span>
          <input
            value={topics}
            onChange={(e) => setTopics(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-900"
            placeholder="evals, agent-memory"
          />
        </label>
      </div>

      <label className="text-xs text-gray-600 space-y-1 block">
        <span className="block font-medium">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-900"
        />
      </label>

      <label className="text-xs text-gray-600 space-y-1 block">
        <span className="block font-medium">Summary</span>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-900"
          placeholder="2–3 sentence summary shown on the digest card"
        />
      </label>

      {kind === "podcast" && !audioUrl && (
        <p className="text-xs text-amber-700">Render the audio first to include the podcast episode; otherwise this publishes as text only.</p>
      )}

      <label className="flex items-center gap-2 text-xs text-gray-600">
        <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />
        Push to live site after committing
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={handlePublish}
          disabled={state.status === "loading" || !title.trim() || !summary.trim()}
          className="px-3 py-2 text-xs sm:text-sm bg-black hover:bg-gray-800 rounded-md text-white font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {state.status === "loading" ? "Publishing…" : "Publish"}
        </button>
        {state.status === "done" && (
          <span className="text-xs text-green-700">✓ {state.slug} — {state.message}</span>
        )}
        {state.status === "error" && <span className="text-xs text-red-700">{state.message}</span>}
      </div>
    </div>
  );
}
