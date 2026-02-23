'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AGENTS, AGENT_JOBS } from '@/src/config/agent-jobs';

const JOB_NAMES: Record<string, string> = {
  daily_competitor_report: 'Daily competitor report',
  weekly_competitor_summary: 'Weekly competitor summary',
  daily_icp_brief: 'Daily ICP/market brief',
  daily_content_ideas: 'Daily content ideas',
};

interface RunSummary {
  id: string;
  agentId: string;
  jobId: string;
  title: string;
  createdAt: number;
}

export const dynamic = 'force-dynamic';

async function fetchRuns(): Promise<RunSummary[]> {
  const res = await fetch('/api/reports?limit=80');
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { runs: RunSummary[] };
  return data.runs ?? [];
}

export default function ReportsPage() {
  const { status: sessionStatus, data: session } = useSession();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runSelection, setRunSelection] = useState<string>('runAllDaily');
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const list = await fetchRuns();
      setRuns(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await fetchRuns();
        if (!cancelled) setRuns(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load reports');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleRun = async () => {
    setRunMessage(null);
    setRunning(true);
    try {
      const body =
        runSelection === 'runAllDaily'
          ? { runAllDaily: true }
          : (() => {
              const [agentId, jobId] = runSelection.split(':');
              return { agentId, jobId };
            })();
      const res = await fetch('/api/reports/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        runAllDaily?: boolean;
        title?: string;
        results?: Array<{ title?: string; error?: string }>;
      };
      if (!res.ok) {
        if (res.status === 401) {
          setRunMessage('Sign in to run report generation.');
          return;
        }
        setRunMessage(data.error ?? 'Run failed');
        return;
      }
      if (data.runAllDaily && data.results) {
        const ok = data.results.filter((r) => !r.error).length;
        const fail = data.results.filter((r) => r.error).length;
        setRunMessage(fail === 0 ? `Generated ${ok} report(s).` : `Generated ${ok}, ${fail} failed.`);
      } else if (data.title) {
        setRunMessage(`Generated: ${data.title}`);
      } else {
        setRunMessage('Done.');
      }
      await loadRuns();
    } catch (e) {
      setRunMessage(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setRunning(false);
    }
  };

  const agentName = (id: string) => AGENTS.find((a) => a.id === id)?.name ?? id;
  const jobName = (id: string) => JOB_NAMES[id] ?? id;
  const formatDate = (ts: number) => new Date(ts * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' });

  const isSignedIn = sessionStatus === 'authenticated' && session?.user;

  return (
    <div className="min-h-screen bg-white text-black">
      <header className="border-b border-surface-border sticky top-0 z-10 bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="space-y-4">
            <div>
              <Link
                href="/"
                className="inline-block px-4 py-2 rounded-md text-sm font-medium transition-colors bg-surface border border-surface-border text-muted hover:text-foreground"
              >
                ← Back to Home
              </Link>
            </div>
            <div>
              <h1 className="text-3xl font-bold">Reports</h1>
              <p className="text-muted mt-2">
                GTM and marketing agent outputs: competitive intel, ICP briefs, and content ideas
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Generate reports (manual run) */}
        <section className="mb-8 p-4 border border-surface-border rounded-lg bg-gray-50/50">
          <h2 className="text-lg font-semibold mb-2">Generate reports</h2>
          {!isSignedIn ? (
            <p className="text-muted text-sm">
              <Link href="/login" className="text-black font-medium hover:underline">Sign in</Link> to run report generation manually.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[200px]">
                <label htmlFor="run-select" className="block text-sm font-medium text-muted mb-1">Job</label>
                <select
                  id="run-select"
                  value={runSelection}
                  onChange={(e) => setRunSelection(e.target.value)}
                  disabled={running}
                  className="w-full px-3 py-2 border border-surface-border rounded-md bg-white text-sm"
                >
                  <option value="runAllDaily">Run all daily jobs</option>
                  {AGENT_JOBS.map((j) => (
                    <option key={`${j.agentId}:${j.jobId}`} value={`${j.agentId}:${j.jobId}`}>
                      {agentName(j.agentId)} — {j.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleRun}
                disabled={running}
                className="px-4 py-2 rounded-md text-sm font-medium bg-black text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {running ? 'Running…' : 'Run'}
              </button>
              {runMessage && (
                <span className={`text-sm ${runMessage.startsWith('Generated') || runMessage === 'Done.' ? 'text-green-700' : 'text-amber-700'}`}>
                  {runMessage}
                </span>
              )}
            </div>
          )}
        </section>

        {loading && <p className="text-muted">Loading reports…</p>}
        {error && <p className="text-red-600">{error}</p>}
        {!loading && !error && runs.length === 0 && (
          <p className="text-muted">No reports yet. Run a job above or use the daily cron to generate reports.</p>
        )}
        {!loading && !error && runs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border border-surface-border text-left">
              <thead>
                <tr className="border-b border-surface-border bg-gray-50">
                  <th className="p-3 font-medium">Agent</th>
                  <th className="p-3 font-medium">Job</th>
                  <th className="p-3 font-medium">Title</th>
                  <th className="p-3 font-medium">Date</th>
                  <th className="p-3 font-medium">View</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-surface-border hover:bg-gray-50/50">
                    <td className="p-3">{agentName(r.agentId)}</td>
                    <td className="p-3">{jobName(r.jobId)}</td>
                    <td className="p-3">{r.title}</td>
                    <td className="p-3 text-muted">{formatDate(r.createdAt)}</td>
                    <td className="p-3">
                      <Link
                        href={`/reports/${r.id}`}
                        className="text-black font-medium hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
