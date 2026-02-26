'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AGENTS } from '@/src/config/agent-jobs';

const JOB_NAMES: Record<string, string> = {
  daily_competitor_report: 'Daily competitor report',
  weekly_competitor_summary: 'Weekly competitor summary',
  daily_icp_brief: 'Daily ICP/market brief',
  daily_content_ideas: 'Daily content ideas',
};

interface ReportDetail {
  id: string;
  agentId: string;
  jobId: string;
  title: string;
  outputMarkdown: string | null;
  outputMetadata: Record<string, unknown> | null;
  createdAt: number;
}

export const dynamic = 'force-dynamic';

export default function ReportViewPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError('Missing report id');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/reports/${id}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error('Report not found');
          throw new Error(await res.text());
        }
        const data = (await res.json()) as ReportDetail;
        if (!cancelled) setReport(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const agentName = (aid: string) => AGENTS.find((a) => a.id === aid)?.name ?? aid;
  const jobName = (jid: string) => JOB_NAMES[jid] ?? jid;
  const formatDate = (ts: number) =>
    new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  if (loading) {
    return (
      <div className="min-h-screen bg-white text-black">
        <div className="max-w-4xl mx-auto px-4 py-8">Loading…</div>
      </div>
    );
  }
  if (error || !report) {
    return (
      <div className="min-h-screen bg-white text-black">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <p className="text-red-600">{error ?? 'Report not found'}</p>
          <Link href="/reports" className="mt-4 inline-block text-black hover:underline">
            ← Back to Reports
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <header className="border-b border-surface-border sticky top-0 z-10 bg-surface">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="space-y-2">
            <Link
              href="/reports"
              className="inline-block text-sm font-medium text-muted hover:text-foreground"
            >
              ← Back to Reports
            </Link>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-muted text-sm">
                {agentName(report.agentId)} · {jobName(report.jobId)}
              </span>
              <span className="text-muted text-sm">{formatDate(report.createdAt)}</span>
            </div>
            <h1 className="text-2xl font-bold">{report.title}</h1>
            {report.outputMetadata && typeof report.outputMetadata.itemCount === 'number' && (
              <p className="text-sm text-muted">
                Based on {report.outputMetadata.itemCount} source items
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div
          className="prose prose-sm max-w-none prose-p:whitespace-pre-wrap prose-headings:font-semibold prose-a:text-black prose-a:underline"
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {report.outputMarkdown ? (
            <ReportMarkdown text={report.outputMarkdown} />
          ) : (
            <p className="text-muted">No content.</p>
          )}
        </div>
      </main>
    </div>
  );
}

/** Minimal markdown rendering: paragraphs, headers, bold, lists, links. */
function ReportMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let keyCounter = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^###\s/.test(line)) {
      out.push(<h3 key={keyCounter++} className="text-lg font-semibold mt-4 mb-1">{line.replace(/^###\s*/, '')}</h3>);
      i++;
      continue;
    }
    if (/^##\s/.test(line)) {
      out.push(<h2 key={keyCounter++} className="text-xl font-semibold mt-6 mb-2">{line.replace(/^##\s*/, '')}</h2>);
      i++;
      continue;
    }
    if (/^#\s/.test(line)) {
      out.push(<h1 key={keyCounter++} className="text-2xl font-bold mt-6 mb-2">{line.replace(/^#\s*/, '')}</h1>);
      i++;
      continue;
    }
    if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && (/^[-*]\s/.test(lines[i]) || /^\d+\.\s/.test(lines[i]))) {
        items.push(lines[i].replace(/^[-*]\s/, '').replace(/^\d+\.\s/, ''));
        i++;
      }
      out.push(
        <ul key={keyCounter++} className="list-disc list-inside my-2 space-y-1">
          {items.map((item, j) => (
            <li key={j}>{inlineFormat(item)}</li>
          ))}
        </ul>
      );
      continue;
    }
    if (line.trim() === '') {
      out.push(<br key={keyCounter++} />);
      i++;
      continue;
    }
    out.push(<p key={keyCounter++} className="my-2">{inlineFormat(line)}</p>);
    i++;
  }
  return <>{out}</>;
}

function inlineFormat(s: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let rest = s;
  let key = 0;
  while (rest.length > 0) {
    const bold = /^\*\*([^*]+)\*\*/.exec(rest);
    const link = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
    if (bold) {
      parts.push(<strong key={key++}>{bold[1]}</strong>);
      rest = rest.slice(bold[0].length);
      continue;
    }
    if (link) {
      parts.push(
        <a key={key++} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-black underline">
          {link[1]}
        </a>
      );
      rest = rest.slice(link[0].length);
      continue;
    }
    const next = rest.match(/\*\*|[^*\[]+/);
    if (next) {
      parts.push(next[0].startsWith('**') ? null : next[0]);
      rest = rest.slice(next[0].length);
      continue;
    }
    parts.push(rest);
    break;
  }
  return <>{parts.filter(Boolean)}</>;
}
