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

interface StructuredIntelItem {
  competitor: string;
  date: string | null;
  title: string;
  source: string;
  source_type: string;
  url: string;
  update_type: string;
  overlap_with_sourcegraph: string[];
  summary: string;
  why_it_matters: string;
  threat_level: 'high' | 'medium' | 'low' | 'negative';
  confidence: 'high' | 'medium' | 'low';
  novelty_score: number;
  relevance_score: number;
  actionability: string[];
  evidence_notes: string[];
}

interface StructuredIntelPayload {
  periodDays: number;
  topPerCompetitor: number;
  topOverall: number;
  generatedAt: string;
  items: StructuredIntelItem[];
  pipeline_trace?: CompetitorIntelPipelineTraceView;
}

interface CompetitorIntelPipelineTraceView {
  schemaVersion?: number;
  periodDays: number;
  topPerCompetitor: number;
  topOverall: number;
  internalDocsLoaded: number;
  competitors: Array<{
    competitorId: string;
    competitor: string;
    tier: number;
    queriesGenerated: number;
    retrieval: {
      internalCandidates: number;
      webCandidates: number;
      strategicBackfill: number;
      strategicUrlBackfill: number;
      recentDomainDocs: number;
      blogFromWeb: number;
      blogListing: number;
      rawMerged: number;
      afterDbHydrate: number;
      afterMetadataHydrate: number;
    };
    filters: {
      input: number;
      kept: number;
      droppedNoisyUrl: number;
      droppedCommunity: number;
      droppedNarrativeNoise: number;
      droppedHowToNoise: number;
      droppedOperationalNoise: number;
      droppedUndated: number;
      droppedOutOfWindow: number;
      droppedWeakSignal: number;
      droppedOtherCompetitorDomain: number;
      droppedWeakAttribution: number;
    };
    clustering: {
      clusters: number;
      rankedAboveThreshold: number;
      diversifiedSelected: number;
    };
    selectedTitles: string[];
  }>;
  global: {
    beforeGlobalDedupe: number;
    afterGlobalDedupe: number;
    afterPostProcess: number;
    finalItems: number;
  };
  interpretable_steps?: Array<{ id: string; label: string; detail: string; metrics?: Record<string, number | string> }>;
}

/** Subset of `ContentIdeasOutput.pipeline_trace` for display (avoid coupling to full agent module). */
interface ContentIdeasPipelineTraceView {
  schemaVersion?: number;
  focus?: string | null;
  retrieval: {
    market_brief: AgentRetrievalTraceView;
    competitor_intel: AgentRetrievalTraceView;
  };
  ranking?: {
    goal: string;
    totalRanked: number;
    sampleSize: number;
    documents: Array<{
      rank: number;
      title: string;
      url?: string;
      source: string;
      baseScore: number;
      goalScore: number;
      agentScore: number;
    }>;
  };
  pool: { after_dedupe_urls: number; ranked_count: number };
  candidate_gates: Array<{ name: string; passed: number; dropped: number }>;
  selection: {
    min_score_threshold: number;
    selection_pool_size: number;
    selected_top_urls: string[];
  };
  refinement_stages?: Array<{ stage: string; count: number }>;
  interpretable_steps?: Array<{ id: string; label: string; detail: string; metrics?: Record<string, number | string> }>;
}

interface AgentRetrievalTraceView {
  goal: string;
  periodDays: number;
  effectiveQuery?: string;
  postgres: {
    categories: Array<{ category: string; itemsLoaded: number; perCategoryCap: number }>;
    fts?: { query: string; period: string; limit: number; hits: number };
  };
  web: {
    timeRange?: string;
    competitorDomains?: number;
    queries: Array<{
      query: string;
      topic: string;
      numResults: number;
      domains?: number;
      hits: number;
      kind: string;
    }>;
  };
  merge: {
    postgresIn: number;
    webIn: number;
    mergedUnique: number;
    postgresCappedTo: number;
    webCappedTo: number;
    caps?: { maxPostgresDocs: number; maxWebDocs: number };
    countsMerged?: { postgres: number; web: number };
    blockedDropped: { postgres: number; web: number };
    dedupedByIdOrUrl: number;
  };
  configSnapshot?: {
    goal: string;
    primaryCategories: string[];
    timeHorizonDays: number;
    maxPostgresDocs: number;
    maxWebDocs: number;
  };
  date: {
    cutoffIso: string;
    requirePublishedDate: boolean;
    beforeFilter: number;
    afterHydrate: number;
    afterFilter: number;
    droppedMissingDate?: number;
    droppedTooOld?: number;
    inferredDatesApplied?: number;
  };
}

interface ContentIdeasLlmStageView {
  status?: string;
  provider?: string;
  model?: string;
  error?: string;
}

interface ContentIdeasLlmDebugView {
  structured_synthesis_timed_out?: boolean;
  structured_synthesis?: ContentIdeasLlmStageView;
  report_writer?: ContentIdeasLlmStageView;
  final_output?: string;
}

function getContentIdeasPipelineTrace(
  meta: Record<string, unknown> | null
): ContentIdeasPipelineTraceView | null {
  if (!meta) return null;
  const sp = meta.structuredPayload;
  if (!sp || typeof sp !== 'object') return null;
  const pt = (sp as Record<string, unknown>).pipeline_trace;
  if (!pt || typeof pt !== 'object') return null;
  return pt as ContentIdeasPipelineTraceView;
}

function getContentIdeasLlmDebug(
  meta: Record<string, unknown> | null
): ContentIdeasLlmDebugView | null {
  if (!meta) return null;
  const topLevel = meta.llmDebug;
  if (topLevel && typeof topLevel === 'object') return topLevel as ContentIdeasLlmDebugView;
  const structuredPayload = meta.structuredPayload;
  if (!structuredPayload || typeof structuredPayload !== 'object') return null;
  const llmDebug = (structuredPayload as Record<string, unknown>).llm_debug;
  if (!llmDebug || typeof llmDebug !== 'object') return null;
  return llmDebug as ContentIdeasLlmDebugView;
}

function formatLlmStageLabel(label: string, stage?: ContentIdeasLlmStageView): string | null {
  if (!stage?.status) return null;
  const modelBits = [stage.model, stage.provider ? `via ${stage.provider}` : null].filter(Boolean).join(' ');
  if (stage.status === 'success') return `${label}: ${modelBits || 'LLM'}`;
  if (stage.status === 'skipped') return `${label}: skipped`;
  if (stage.status === 'timeout') return `${label}: timeout`;
  if (stage.status === 'parse_fallback') return `${label}: parse fallback`;
  if (stage.status === 'normalization_fallback') return `${label}: normalization fallback`;
  if (stage.status === 'not_configured') return `${label}: LLM not configured`;
  return `${label}: error`;
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

  const structuredIntel = parseStructuredIntel(report);
  const competitorTrace =
    report.agentId === 'competitive_intel' ? structuredIntel?.pipeline_trace ?? null : null;
  const pipelineTrace =
    report.agentId === 'gtm_content' ? getContentIdeasPipelineTrace(report.outputMetadata) : null;
  const contentIdeasLlmDebug =
    report.agentId === 'gtm_content' ? getContentIdeasLlmDebug(report.outputMetadata) : null;
  const llmStatusLines = contentIdeasLlmDebug
    ? [
        formatLlmStageLabel('Structured synthesis', contentIdeasLlmDebug.structured_synthesis),
        formatLlmStageLabel('Report writer', contentIdeasLlmDebug.report_writer),
        contentIdeasLlmDebug.final_output === 'template_markdown' ? 'Final output: template fallback' : null,
        contentIdeasLlmDebug.final_output === 'llm_report_writer' ? 'Final output: LLM-written' : null,
      ].filter((line): line is string => Boolean(line))
    : [];

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
            {llmStatusLines.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {llmStatusLines.map((line) => (
                  <span
                    key={line}
                    className="inline-flex items-center rounded-full border border-gray-300 bg-gray-50 px-2.5 py-1 text-xs text-gray-700"
                  >
                    {line}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {pipelineTrace && <RetrievalTracePanel trace={pipelineTrace} />}
        {competitorTrace && <CompetitorIntelTracePanel trace={competitorTrace} />}
        {structuredIntel ? (
          <StructuredCompetitorIntel payload={structuredIntel} />
        ) : (
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
        )}
      </main>
    </div>
  );
}

function CompetitorIntelTracePanel({ trace }: { trace: CompetitorIntelPipelineTraceView }) {
  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50/50 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Competitor intel · pipeline trace</h2>
        {trace.schemaVersion != null && (
          <span className="text-xs font-mono px-2 py-0.5 rounded border border-sky-300 bg-white">
            schema v{trace.schemaVersion}
          </span>
        )}
      </div>
      <p className="text-sm text-muted">
        Internal + web candidate gathering, strict attribution filters, per-competitor clustering, then global dedupe and selection.
      </p>
      <div className="rounded-lg border border-surface-border bg-white p-3 text-sm space-y-1">
        <p>
          <strong>Window:</strong> last {trace.periodDays} days · top {trace.topPerCompetitor} per competitor · cap {trace.topOverall} overall
        </p>
        <p>
          <strong>Input:</strong> {trace.internalDocsLoaded} internal docs loaded across {trace.competitors.length} competitors
        </p>
        <p>
          <strong>Global:</strong> {trace.global.beforeGlobalDedupe} pre-global → {trace.global.afterGlobalDedupe} deduped →{' '}
          {trace.global.afterPostProcess} cleaned → {trace.global.finalItems} final items
        </p>
      </div>
      <div className="grid gap-3">
        {trace.competitors.map((entry) => (
          <div key={entry.competitorId} className="rounded-lg border border-surface-border bg-white p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{entry.competitor}</h3>
              <span className="text-xs text-muted">tier {entry.tier}</span>
              <span className="text-xs text-muted">{entry.queriesGenerated} queries</span>
            </div>
            <div className="text-xs space-y-1">
              <p>
                <strong>Retrieval:</strong> internal {entry.retrieval.internalCandidates} · web {entry.retrieval.webCandidates} · backfill{' '}
                {entry.retrieval.strategicBackfill + entry.retrieval.strategicUrlBackfill} · domain {entry.retrieval.recentDomainDocs} · blog{' '}
                {entry.retrieval.blogFromWeb + entry.retrieval.blogListing}
              </p>
              <p>
                <strong>Hydration:</strong> merged {entry.retrieval.rawMerged} → DB {entry.retrieval.afterDbHydrate} → metadata{' '}
                {entry.retrieval.afterMetadataHydrate}
              </p>
              <p>
                <strong>Filters:</strong> kept {entry.filters.kept}/{entry.filters.input} · weak attribution {entry.filters.droppedWeakAttribution} · weak signal{' '}
                {entry.filters.droppedWeakSignal} · old {entry.filters.droppedOutOfWindow} · undated {entry.filters.droppedUndated}
              </p>
              <p>
                <strong>Noise dropped:</strong> URLs {entry.filters.droppedNoisyUrl} · community {entry.filters.droppedCommunity} · narrative{' '}
                {entry.filters.droppedNarrativeNoise} · how-to {entry.filters.droppedHowToNoise} · operational {entry.filters.droppedOperationalNoise} · other competitor domain{' '}
                {entry.filters.droppedOtherCompetitorDomain}
              </p>
              <p>
                <strong>Selection:</strong> clusters {entry.clustering.clusters} · ranked {entry.clustering.rankedAboveThreshold} · selected{' '}
                {entry.clustering.diversifiedSelected}
              </p>
              {entry.selectedTitles.length > 0 && (
                <p>
                  <strong>Selected titles:</strong> {entry.selectedTitles.join(' | ')}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      {trace.interpretable_steps && trace.interpretable_steps.length > 0 && (
        <details className="text-sm rounded-lg border border-surface-border bg-white p-3" open>
          <summary className="cursor-pointer font-medium text-foreground">Interpretable steps (ordered)</summary>
          <ol className="mt-2 space-y-2 list-decimal list-inside text-xs">
            {trace.interpretable_steps.map((step) => (
              <li key={step.id}>
                <strong className="text-foreground">{step.label}</strong>
                <span className="text-muted"> — {step.detail}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-foreground">Raw trace JSON</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded border border-surface-border bg-gray-50 p-3 text-xs">
          {JSON.stringify(trace, null, 2)}
        </pre>
      </details>
    </section>
  );
}

function RetrievalTracePanel({ trace }: { trace: ContentIdeasPipelineTraceView }) {
  const goalBlock = (label: string, t: AgentRetrievalTraceView) => (
    <div key={label} className="rounded-lg border border-surface-border bg-gray-50 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{label}</h3>
      <p className="text-xs text-muted">
        goal={t.goal} · periodDays={t.periodDays}
        {t.effectiveQuery ? ` · query: ${t.effectiveQuery}` : ''}
      </p>
      <div className="text-xs space-y-1">
        <p>
          <strong>Postgres:</strong>{' '}
          {t.postgres.categories.map((c) => `${c.category}: ${c.itemsLoaded}/${c.perCategoryCap}`).join(' · ') ||
            '—'}
        </p>
        {t.postgres.fts && (
          <p>
            <strong>FTS:</strong> {t.postgres.fts.hits} hits · period {t.postgres.fts.period} · limit{' '}
            {t.postgres.fts.limit} · &quot;{t.postgres.fts.query.slice(0, 120)}
            {t.postgres.fts.query.length > 120 ? '…' : ''}&quot;
          </p>
        )}
        <p>
          <strong>Web:</strong> {t.web.queries.length} queries
          {t.web.timeRange ? ` · timeRange=${t.web.timeRange}` : ''}
          {t.web.competitorDomains != null ? ` · competitorDomains=${t.web.competitorDomains}` : ''}
        </p>
        <ul className="list-disc list-inside pl-1 space-y-0.5 max-h-32 overflow-y-auto">
          {t.web.queries.map((q, i) => (
            <li key={i}>
              [{q.kind}/{q.topic}] {q.hits}/{q.numResults} — {q.query.slice(0, 100)}
              {q.query.length > 100 ? '…' : ''}
            </li>
          ))}
        </ul>
        {t.configSnapshot && (
          <p>
            <strong>Config snapshot:</strong> {t.configSnapshot.primaryCategories.length} categories · caps pg{' '}
            {t.configSnapshot.maxPostgresDocs} / web {t.configSnapshot.maxWebDocs} · horizon {t.configSnapshot.timeHorizonDays}d
          </p>
        )}
        <p>
          <strong>Merge:</strong> pg in {t.merge.postgresIn} · web in {t.merge.webIn} · caps{' '}
          {t.merge.caps
            ? `${t.merge.caps.maxPostgresDocs} / ${t.merge.caps.maxWebDocs}`
            : `${t.merge.postgresCappedTo} / ${t.merge.webCappedTo}`}
          {t.merge.countsMerged
            ? ` · merged from pg ${t.merge.countsMerged.postgres} · web ${t.merge.countsMerged.web}`
            : ''}
          {' · unique '}
          {t.merge.mergedUnique} · dedup skips {t.merge.dedupedByIdOrUrl} · domain-blocked pg{' '}
          {t.merge.blockedDropped.postgres}/web {t.merge.blockedDropped.web}
        </p>
        <p>
          <strong>Date filter:</strong> cutoff {t.date.cutoffIso} · requireDate={String(t.date.requirePublishedDate)}{' '}
          · {t.date.beforeFilter} → hydrate → {t.date.afterHydrate} → {t.date.afterFilter} after filter
          {t.date.droppedMissingDate != null ? ` · dropped missing date: ${t.date.droppedMissingDate}` : ''}
          {t.date.droppedTooOld != null ? ` · dropped too old: ${t.date.droppedTooOld}` : ''}
        </p>
      </div>
    </div>
  );

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Content agent · retrieval trace</h2>
        {trace.schemaVersion != null && (
          <span className="text-xs font-mono px-2 py-0.5 rounded border border-amber-300 bg-white">
            schema v{trace.schemaVersion}
          </span>
        )}
      </div>
      <p className="text-sm text-muted">
        Versioned trace: goal config → retrieval → merge → dates → ranking sample → gates → refinement.{' '}
        <span className="text-muted">
          (Disable storage: <code className="text-xs bg-white px-1 rounded border">CONTENT_IDEAS_PIPELINE_TRACE=0</code>.)
        </span>
      </p>
      {trace.focus != null && trace.focus !== '' && (
        <p className="text-sm">
          <strong>Focus:</strong> {trace.focus}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {goalBlock('Market brief pool', trace.retrieval.market_brief)}
        {goalBlock('Competitor intel pool', trace.retrieval.competitor_intel)}
      </div>
      <div className="rounded-lg border border-surface-border bg-white p-3 text-sm space-y-1">
        <p>
          <strong>Combined pool:</strong> {trace.pool.after_dedupe_urls} URLs after dedupe · {trace.pool.ranked_count}{' '}
          ranked for shortlist
        </p>
        <p>
          <strong>Selection:</strong> min score {trace.selection.min_score_threshold} · pool size{' '}
          {trace.selection.selection_pool_size} · top URLs {trace.selection.selected_top_urls.length}
        </p>
        <ul className="list-disc list-inside text-xs max-h-24 overflow-y-auto">
          {trace.candidate_gates.map((g) => (
            <li key={g.name}>
              {g.name}: passed {g.passed}, dropped {g.dropped}
            </li>
          ))}
        </ul>
      </div>
      {trace.refinement_stages && trace.refinement_stages.length > 0 && (
        <div className="rounded-lg border border-surface-border bg-white p-3">
          <h3 className="text-sm font-semibold mb-2">Refinement pipeline</h3>
          <div className="flex flex-wrap gap-2 text-xs">
            {trace.refinement_stages.map((s) => (
              <span key={s.stage} className="px-2 py-1 rounded border border-gray-200 bg-gray-50">
                {s.stage.replace(/_/g, ' ')}: <strong>{s.count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
      {trace.ranking && trace.ranking.documents.length > 0 && (
        <div className="rounded-lg border border-surface-border bg-white p-3 overflow-x-auto">
          <h3 className="text-sm font-semibold mb-2">
            Ranking sample (goal {trace.ranking.goal}, {trace.ranking.totalRanked} ranked, top {trace.ranking.sampleSize})
          </h3>
          <p className="mb-2 text-xs text-muted">
            Compare <strong className="text-foreground">base</strong> vs <strong className="text-foreground">goal</strong> vs{" "}
            <strong className="text-foreground">agent</strong> to see whether ICP / format / competitor weighting is moving items beyond raw digest score.
          </p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b text-left text-muted">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">goal</th>
                <th className="py-1 pr-2">agent</th>
                <th className="py-1 pr-2">base</th>
                <th className="py-1">title / source</th>
              </tr>
            </thead>
            <tbody>
              {trace.ranking.documents.map((d) => (
                <tr key={d.rank} className="border-b border-gray-100">
                  <td className="py-1 pr-2 font-mono">{d.rank}</td>
                  <td className="py-1 pr-2">{d.goalScore.toFixed(3)}</td>
                  <td className="py-1 pr-2">{d.agentScore.toFixed(3)}</td>
                  <td className="py-1 pr-2">{d.baseScore.toFixed(3)}</td>
                  <td className="py-1">
                    {d.title.slice(0, 72)}
                    {d.title.length > 72 ? '…' : ''}{' '}
                    <span className="text-muted">({d.source})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {trace.interpretable_steps && trace.interpretable_steps.length > 0 && (
        <details className="text-sm rounded-lg border border-surface-border bg-white p-3" open>
          <summary className="cursor-pointer font-medium text-foreground">Interpretable steps (ordered)</summary>
          <ol className="mt-2 space-y-2 list-decimal list-inside text-xs">
            {trace.interpretable_steps.map((step) => (
              <li key={step.id}>
                <strong className="text-foreground">{step.label}</strong>
                <span className="text-muted"> — {step.detail}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-foreground">Raw trace JSON</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded border border-surface-border bg-gray-50 p-3 text-xs">
          {JSON.stringify(trace, null, 2)}
        </pre>
      </details>
    </section>
  );
}

function parseStructuredIntel(report: ReportDetail): StructuredIntelPayload | null {
  const isCompetitorIntel = report.agentId === 'competitive_intel';
  const isStructured = report.outputMetadata && report.outputMetadata.structuredOutput === true;
  if (!isCompetitorIntel || !isStructured) return null;

  const structuredPayload = report.outputMetadata?.structuredPayload;
  if (structuredPayload && typeof structuredPayload === 'object') {
    const parsed = structuredPayload as StructuredIntelPayload;
    if (Array.isArray(parsed.items)) return parsed;
  }

  if (!report.outputMarkdown) return null;

  const fenced = report.outputMarkdown.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? report.outputMarkdown.trim();
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as StructuredIntelPayload;
    if (!Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function StructuredCompetitorIntel({ payload }: { payload: StructuredIntelPayload }) {
  const threatClass = (level: string): string => {
    if (level === 'high') return 'bg-red-100 text-red-800 border-red-200';
    if (level === 'medium') return 'bg-amber-100 text-amber-800 border-amber-200';
    if (level === 'negative') return 'bg-blue-100 text-blue-800 border-blue-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-gray-50 p-4">
        <p className="text-sm text-muted">
          {payload.items.length} items · {payload.periodDays}d window · Top {payload.topPerCompetitor} per competitor
        </p>
      </div>
      {payload.items.map((item, idx) => (
        <article key={`${item.url}-${idx}`} className="rounded-lg border border-surface-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium px-2 py-1 rounded border border-gray-300 bg-gray-100">
              {item.competitor}
            </span>
            <span className={`text-xs font-medium px-2 py-1 rounded border ${threatClass(item.threat_level)}`}>
              threat: {item.threat_level}
            </span>
            <span className="text-xs text-muted">
              confidence: {item.confidence}
            </span>
            {item.date && <span className="text-xs text-muted">{item.date}</span>}
          </div>

          <h2 className="mt-3 text-lg font-semibold">{item.title}</h2>
          <p className="mt-1 text-sm text-muted">{item.summary}</p>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-gray-100 border border-gray-200">{item.update_type}</span>
            {item.overlap_with_sourcegraph.map((s) => (
              <span key={s} className="px-2 py-1 rounded bg-slate-100 border border-slate-200">
                {s}
              </span>
            ))}
          </div>

          <p className="mt-3 text-sm"><strong>Why it matters:</strong> {item.why_it_matters}</p>
          <p className="mt-2 text-sm">
            <strong>Actionability:</strong> {item.actionability.join(', ')}
          </p>
          <p className="mt-2 text-sm">
            <strong>Scores:</strong> relevance {item.relevance_score} · novelty {item.novelty_score}
          </p>
          {item.evidence_notes.length > 0 && (
            <p className="mt-2 text-sm">
              <strong>Evidence:</strong> {item.evidence_notes.join(' | ')}
            </p>
          )}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-3 text-sm font-medium underline"
          >
            {item.source} ({item.source_type})
          </a>
        </article>
      ))}
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
