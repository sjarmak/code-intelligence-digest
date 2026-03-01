import type { ContentIdeasOutput } from "./content-ideas";
import type { RankedCompetitorIntelItem } from "./competitor-intel";
import type { MarketBriefOutput } from "./market-brief";
import { getCompetitorIntelEntries } from "../../config/competitor-intel";

function esc(s: string | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Strip leading [PDF] (or similar) from document titles for display. */
export function stripPdfPrefix(title: string): string {
  return (title ?? "").replace(/^\s*\[PDF\]\s*/i, "").trim() || (title ?? "");
}

/** Human-readable labels for report output (engineers/executives). */
const UPDATE_TYPE_LABELS: Record<string, string> = {
  market_proof: "Market proof",
  product_launch: "Product launch",
  product_update: "Product update",
  pricing_packaging: "Pricing & packaging",
  security_enterprise: "Security & enterprise",
};

const OVERLAP_LABELS: Record<string, string> = {
  deep_search: "Deep search",
  code_search: "Code search",
  code_navigation: "Code navigation",
  mcp: "MCP",
  agent_context: "Agent context",
  batch_changes: "Batch changes",
  insights: "Insights",
  monitoring: "Monitoring",
  governance: "Governance",
  enterprise_control: "Enterprise control",
  large_codebase_understanding: "Large codebase understanding",
  monorepo_multi_repo: "Monorepo / multi-repo",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  primary: "Primary source",
  internal_curated: "Curated",
  secondary: "Secondary",
  community: "Community",
};

const OPPORTUNITY_LABELS: Record<string, string> = {
  high_opportunity: "High",
  medium_opportunity: "Medium",
  low_opportunity: "Low",
  monitor_only: "Monitor only",
};

const DATE_CONFIDENCE_LABELS: Record<string, string> = {
  exact: "Exact date",
  inferred: "Inferred",
  unknown: "Unknown",
};

function formatLabel(value: string, labels: Record<string, string>): string {
  return labels[value] ?? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatOverlap(values: string[]): string {
  if (!values.length) return "None";
  return values.map((v) => formatLabel(v, OVERLAP_LABELS)).join(", ");
}

function formatActionability(values: string[]): string {
  const labels: Record<string, string> = {
    product: "Product",
    messaging: "Messaging",
    exec: "Executive",
    sales: "Sales",
    monitoring: "Monitoring",
  };
  return values.map((v) => formatLabel(v, labels)).join(", ");
}

export function formatMarketBriefMarkdown(title: string, payload: MarketBriefOutput): string {
  const lines: string[] = [
    `# ${title}`,
    `Generated: ${payload.brief_date}`,
    `Playbook version: ${payload.playbook_version}`,
    "",
    "## Executive Delta",
    "",
  ];

  if (payload.executive_delta.length === 0) {
    lines.push("No high-confidence GTM deltas identified in this run.", "");
  }

  payload.executive_delta.forEach((item, i) => {
    lines.push(`### ${i + 1}. ${stripPdfPrefix(item.title)}`);
    lines.push(`- Segment impact: ${item.segment_impact.join(", ")}`);
    lines.push(`- Persona impact: ${item.persona_impact.join(", ")}`);
    lines.push(`- Why it matters: ${item.why_it_matters}`);
    if (item.evidence_quality_note) {
      lines.push(`- Evidence quality: ${item.evidence_quality_note}`);
    }
    lines.push(`- Sourcegraph opportunity: **${item.integration_opportunity}**`);
    lines.push(`- Sourcegraph integration play:`);
    item.sourcegraph_integration_play.forEach((play) => lines.push(`  - ${play}`));
    lines.push(`- Recommended owner/action: **${item.recommended_action.owner}** - ${item.recommended_action.action}`);
    lines.push("- Sources:");
    if (item.evidence.length === 0) {
      lines.push("  - No linked source available");
    } else {
      item.evidence.forEach((e) => {
        const label = `${e.source} (${e.confidence})`;
        lines.push(`  - [${label}](${e.url})`);
      });
    }
    lines.push("");
  });

  if (payload.watch_items.length > 0) {
    lines.push("## Watch Items", "");
    payload.watch_items.forEach((item, i) => {
      lines.push(`### ${i + 1}. ${stripPdfPrefix(item.title)}`);
      lines.push(`- ${item.summary}`);
      lines.push("- Sources:");
      if (item.evidence.length === 0) {
        lines.push("  - No linked source available");
      } else {
        item.evidence.forEach((e) => {
          const label = `${e.source} (${e.confidence})`;
          lines.push(`  - [${label}](${e.url})`);
        });
      }
      lines.push("");
    });
  }

  if (payload.invalidations_to_monitor.length > 0) {
    lines.push(
      "## Invalidations To Monitor",
      ...payload.invalidations_to_monitor.map((x) => `- ${stripPdfPrefix(x)}`),
      ""
    );
  }

  return lines.join("\n");
}

export function formatContentIdeasMarkdown(title: string, payload: ContentIdeasOutput): string {
  const lines: string[] = [
    `# ${title}`,
    `Generated: ${payload.generated_at}`,
    `Playbook version: ${payload.playbook_version}`,
    "",
    "## Prioritized Ideas",
    "",
  ];

  if (payload.ideas.length === 0) {
    lines.push("No compliant, high-signal content ideas identified in this run.", "");
  }

  payload.ideas.forEach((idea, i) => {
    lines.push(`### ${i + 1}. ${stripPdfPrefix(idea.title)}`);
    lines.push(`- Segment/persona: **${idea.target_segment}** / **${idea.target_persona}**`);
    lines.push(`- Stage: **${idea.funnel_stage}**`);
    lines.push(`- Thesis: ${idea.thesis}`);
    lines.push(`- Why now: ${idea.why_now}`);
    lines.push(`- Core claim: ${idea.core_claim}`);
    if (idea.evidence_quality_note) {
      lines.push(`- Evidence quality: ${idea.evidence_quality_note}`);
    }
    lines.push(`- Sourcegraph opportunity: **${idea.integration_opportunity}**`);
    lines.push(`- Sourcegraph integration play:`);
    idea.sourcegraph_integration_play.forEach((play) => lines.push(`  - ${play}`));
    lines.push(`- Primary format: **${idea.distribution_plan.primary_format}**`);
    lines.push(`- Recommended venue: ${idea.distribution_plan.recommended_venue}`);
    lines.push(`- Channel strategy: ${idea.distribution_plan.channel_strategy}`);
    lines.push(`- Setup plan:`);
    idea.distribution_plan.setup_steps.forEach((step) => lines.push(`  - ${step}`));
    lines.push(`- Key insights:`);
    idea.key_insights.forEach((insight) => lines.push(`  - ${insight}`));
    lines.push(`- Content outline:`);
    idea.content_outline.forEach((outline) => lines.push(`  - ${outline}`));
    lines.push(`- Sources:`);
    if (idea.sources.length === 0) {
      lines.push("  - No linked source available");
    } else {
      idea.sources.forEach((source) =>
        lines.push(`  - [${stripPdfPrefix(source.title)}](${source.url}) (${source.source})`)
      );
    }
    lines.push("");
  });

  return lines.join("\n");
}

function formatOneCompetitorItem(item: RankedCompetitorIntelItem, index: number): string[] {
  const lines: string[] = [];
  lines.push(`### ${index + 1}. ${stripPdfPrefix(item.title)}`);
  const sourceLink = item.url ? `[${item.source}](${item.url})` : item.source;
  const dateConfLabel = formatLabel(item.date_confidence, DATE_CONFIDENCE_LABELS);
  const sourceTypeLabel = formatLabel(item.source_type, SOURCE_TYPE_LABELS);
  lines.push(`- Date/source: ${item.date ?? "Unknown"} (${dateConfLabel}) · **${sourceTypeLabel}** · ${sourceLink}`);
  if (item.url) {
    lines.push(`- Link: [View article](${item.url})`);
  }
  lines.push(`- Confidence: **${item.confidence.charAt(0).toUpperCase() + item.confidence.slice(1)}**`);
  lines.push(`- Update type: ${formatLabel(item.update_type, UPDATE_TYPE_LABELS)}`);
  lines.push(`- Overlap with Sourcegraph: ${formatOverlap(item.overlap_with_sourcegraph)}`);
  lines.push(`- Summary: ${item.summary}`);
  lines.push(`- Why it matters: ${item.why_it_matters}`);
  const oppLabel = formatLabel(item.integration_opportunity, OPPORTUNITY_LABELS);
  lines.push(`- Sourcegraph opportunity: **${oppLabel}**`);
  lines.push(`- Sourcegraph integration play: ${item.sourcegraph_integration_play.join(" · ")}`);
  lines.push(`- Actionability: ${formatActionability(item.actionability)}`);
  const evidence = item.evidence_notes.length > 0 ? item.evidence_notes.join(" | ") : "No evidence notes captured";
  lines.push(`<details><summary><strong>Evidence notes</strong></summary><div>${esc(evidence)}</div></details>`);
  lines.push("");
  return lines;
}

export function formatCompetitorIntelMarkdown(
  title: string,
  payload: {
    generatedAt: string;
    periodDays: number;
    topPerCompetitor: number;
    items: RankedCompetitorIntelItem[];
  },
): string {
  const lines: string[] = [
    `# ${title}`,
    `Generated: ${payload.generatedAt}`,
    `Window: last ${payload.periodDays} days`,
    "",
  ];

  const byCompetitor = new Map<string, RankedCompetitorIntelItem[]>();
  for (const item of payload.items) {
    const list = byCompetitor.get(item.competitor) ?? [];
    list.push(item);
    byCompetitor.set(item.competitor, list);
  }

  const competitorOrder = getCompetitorIntelEntries().map((c) => c.display_name);

  for (const displayName of competitorOrder) {
    const items = byCompetitor.get(displayName) ?? [];
    if (items.length === 0) continue;

    lines.push(`## ${displayName}`);
    lines.push("");
    items.forEach((item, i) => {
      lines.push(...formatOneCompetitorItem(item, i));
    });
  }

  return lines.join("\n");
}
