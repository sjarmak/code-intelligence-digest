"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Download, FileDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

const AGENT_GOALS = ["content_ideas", "market_brief", "competitor_intel"] as const;
const GOAL_LABELS: Record<string, string> = {
  content_ideas: "Content Ideas",
  market_brief: "Market Brief",
  competitor_intel: "Competitor Intel",
};

interface ReportMeta {
  goal: string;
  id: string;
  generatedAt: string;
}

interface ReportDetail {
  goal: string;
  id: string;
  generatedAt: string;
  content: string;
}

export default function AgentReportsPage() {
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<ReportDetail | null>(null);
  const [loadingReport, setLoadingReport] = useState<string | null>(null);
  const [selectedGoals, setSelectedGoals] = useState<Set<string>>(new Set(AGENT_GOALS));
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const refetchReports = () => {
    return fetch("/api/agents/reports")
      .then((res) => res.json())
      .then((data) => setReports(data.reports ?? []))
      .catch(() => setReports([]));
  };

  useEffect(() => {
    refetchReports().finally(() => setLoading(false));
  }, []);

  const allSelected = AGENT_GOALS.every((g) => selectedGoals.has(g));
  const toggleAll = () => {
    if (allSelected) setSelectedGoals(new Set());
    else setSelectedGoals(new Set(AGENT_GOALS));
  };
  const toggleGoal = (goal: string) => {
    setSelectedGoals((prev) => {
      const next = new Set(prev);
      if (next.has(goal)) next.delete(goal);
      else next.add(goal);
      return next;
    });
  };

  const handleGenerate = async () => {
    const goals = Array.from(selectedGoals);
    if (goals.length === 0) return;
    setGenerateError(null);
    setGenerating(true);
    try {
      const res = await fetch("/api/agents/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goals }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGenerateError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      await refetchReports();
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleView = async (goal: string, id?: string) => {
    const key = id ? `${goal}-${id}` : goal;
    setLoadingReport(key);
    try {
      const url = id ? `/api/agents/reports/${goal}?id=${encodeURIComponent(id)}` : `/api/agents/reports/${goal}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Not found");
      const data: ReportDetail = await res.json();
      setViewing(data);
    } catch {
      setViewing(null);
    } finally {
      setLoadingReport(null);
    }
  };

  const handleDelete = async (goal: string, id: string) => {
    if (!confirm("Delete this report?")) return;
    try {
      const res = await fetch(`/api/agents/reports/${goal}/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setReports((prev) => prev.filter((r) => r.goal !== goal || r.id !== id));
      if (viewing?.goal === goal && viewing?.id === id) setViewing(null);
    } catch (e) {
      console.error(e);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "Never run";
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const reportContentRef = useRef<HTMLDivElement>(null);

  const copyRawMarkdown = async () => {
    if (!viewing) return;
    try {
      await navigator.clipboard.writeText(viewing.content);
      // Could add a brief toast; for now rely on button state
    } catch {
      // fallback: no clipboard access
    }
  };

  const downloadRawMarkdown = () => {
    if (!viewing) return;
    const blob = new Blob([viewing.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-report-${viewing.goal}-${viewing.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    if (typeof window === "undefined") return;
    // Rely on the browser's native "Save as PDF" from the print dialog.
    window.print();
  };

  if (viewing) {
    return (
      <div className="min-h-screen bg-white text-black flex flex-col">
        <header className="border-b border-gray-200 sticky top-0 z-10 bg-white shrink-0">
          <div className="max-w-4xl mx-auto px-4 py-4">
            <button
              type="button"
              onClick={() => setViewing(null)}
              className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-black mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Agent Reports
            </button>
            <h1 className="text-xl font-bold">
              {GOAL_LABELS[viewing.goal] ?? viewing.goal}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Generated: {formatDate(viewing.generatedAt)}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                onClick={copyRawMarkdown}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Copy className="w-4 h-4" />
                Copy raw markdown
              </button>
              <button
                type="button"
                onClick={downloadRawMarkdown}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Download className="w-4 h-4" />
                Download .md
              </button>
              <button
                type="button"
                onClick={exportPdf}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <FileDown className="w-4 h-4" />
                Export PDF
              </button>
            </div>
          </div>
        </header>
        <main className="max-w-4xl mx-auto w-full px-4 py-6 flex-1 min-h-0 flex flex-col">
          <div
            ref={reportContentRef}
            className="report-markdown flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-6 text-gray-900"
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                h1: ({ children, ...p }) => (
                  <h1 className="text-2xl font-bold mt-6 mb-2 first:mt-0" {...p}>
                    {children}
                  </h1>
                ),
                h2: ({ children, ...p }) => (
                  <h2 className="text-xl font-bold mt-5 mb-2" {...p}>
                    {children}
                  </h2>
                ),
                h3: ({ children, ...p }) => (
                  <h3 className="text-lg font-semibold mt-4 mb-2 break-words" {...p}>
                    {children}
                  </h3>
                ),
                p: ({ children, ...p }) => (
                  <p className="mb-3 leading-relaxed break-words" {...p}>
                    {children}
                  </p>
                ),
                ul: ({ children, ...p }) => (
                  <ul className="list-disc pl-6 mb-3 space-y-1" {...p}>
                    {children}
                  </ul>
                ),
                ol: ({ children, ...p }) => (
                  <ol className="list-decimal pl-6 mb-3 space-y-1" {...p}>
                    {children}
                  </ol>
                ),
                li: ({ children, ...p }) => (
                  <li className="leading-relaxed break-words" {...p}>
                    {children}
                  </li>
                ),
                a: ({ href, children, ...p }) => (
                  <a
                    href={href}
                    className="text-blue-600 underline hover:text-blue-800"
                    target="_blank"
                    rel="noopener noreferrer"
                    {...p}
                  >
                    {children}
                  </a>
                ),
                code: ({ children, ...p }) => (
                  <code
                    className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono"
                    {...p}
                  >
                    {children}
                  </code>
                ),
                pre: ({ children, ...p }) => (
                  <pre
                    className="bg-gray-100 p-4 rounded-lg overflow-x-auto text-sm my-3"
                    {...p}
                  >
                    {children}
                  </pre>
                ),
                blockquote: ({ children, ...p }) => (
                  <blockquote
                    className="border-l-4 border-gray-300 pl-4 my-3 italic text-gray-700"
                    {...p}
                  >
                    {children}
                  </blockquote>
                ),
                hr: () => <hr className="my-4 border-gray-200" />,
                table: ({ children, ...p }) => (
                  <div className="overflow-x-auto my-3" {...p}>
                    <table className="min-w-full border border-gray-200">
                      {children}
                    </table>
                  </div>
                ),
                th: ({ children, ...p }) => (
                  <th
                    className="border border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold"
                    {...p}
                  >
                    {children}
                  </th>
                ),
                td: ({ children, ...p }) => (
                  <td className="border border-gray-200 px-3 py-2" {...p}>
                    {children}
                  </td>
                ),
                details: ({ children, ...p }) => (
                  <details
                    className="my-2 border border-gray-200 rounded-md overflow-hidden"
                    {...p}
                  >
                    {children}
                  </details>
                ),
                summary: ({ children, ...p }) => (
                  <summary
                    className="px-3 py-2 bg-gray-50 cursor-pointer hover:bg-gray-100 font-medium text-sm list-none [&::-webkit-details-marker]:hidden"
                    {...p}
                  >
                    {children}
                  </summary>
                ),
              }}
            >
              {viewing.content}
            </ReactMarkdown>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <header className="border-b border-gray-200 sticky top-0 z-10 bg-white">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-black mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Digest
          </Link>
          <h1 className="text-xl font-bold">Agent Reports</h1>
          <p className="text-sm text-gray-500 mt-1">
            Generate and view Content Ideas, Market Brief, and Competitor Intel reports.
          </p>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Generate reports */}
        <section className="border border-gray-200 rounded-lg p-4 bg-gray-50">
          <h2 className="text-lg font-semibold mb-3">Generate reports</h2>
          <div className="flex flex-wrap items-center gap-4 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium">Select all</span>
            </label>
            {AGENT_GOALS.map((goal) => (
              <label key={goal} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedGoals.has(goal)}
                  onChange={() => toggleGoal(goal)}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">{GOAL_LABELS[goal] ?? goal}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || selectedGoals.size === 0}
              className="px-4 py-2 rounded-md bg-black text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? "Generating…" : "Generate reports"}
            </button>
            {generateError && (
              <p className="text-sm text-red-600">{generateError}</p>
            )}
          </div>
        </section>

        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : (
          <div className="space-y-6">
            {AGENT_GOALS.map((goal) => {
              const runs = reports.filter((r) => r.goal === goal).sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
              return (
                <section key={goal} className="border border-gray-200 rounded-lg p-4">
                  <h2 className="font-semibold text-lg mb-3">{GOAL_LABELS[goal] ?? goal}</h2>
                  {runs.length === 0 ? (
                    <p className="text-sm text-gray-500">No reports yet. Generate above.</p>
                  ) : (
                    <ul className="space-y-2">
                      {runs.map((r) => (
                        <li
                          key={`${r.goal}-${r.id}`}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2 border-b border-gray-100 last:border-0"
                        >
                          <span className="text-sm text-gray-600">{formatDate(r.generatedAt)}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleView(r.goal, r.id)}
                              disabled={loadingReport !== null}
                              className="px-3 py-1.5 rounded-md bg-black text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {loadingReport === `${r.goal}-${r.id}` ? "Loading…" : "View"}
                            </button>
                            <button
                              onClick={() => handleDelete(r.goal, r.id)}
                              className="px-3 py-1.5 rounded-md border border-red-300 text-red-700 text-sm font-medium hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
