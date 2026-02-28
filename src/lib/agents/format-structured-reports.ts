import type { ContentIdeasOutput } from "./content-ideas";
import type { RankedCompetitorIntelItem } from "./competitor-intel";
import type { MarketBriefOutput } from "./market-brief";

function esc(s: string | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

  const allReinforces =
    payload.executive_delta.length > 0 &&
    payload.executive_delta.every((item) => item.playbook_alignment === "reinforces");

  payload.executive_delta.forEach((item, i) => {
    lines.push(`### ${i + 1}. ${item.title}`);
    if (!allReinforces) {
      lines.push(`- Alignment: **${item.playbook_alignment}**`);
    }
    lines.push(`- Segment impact: ${item.segment_impact.join(", ")}`);
    lines.push(`- Persona impact: ${item.persona_impact.join(", ")}`);
    lines.push(`- Why it matters: ${item.why_it_matters}`);
    lines.push(`- Recommended owner/action: **${item.recommended_action.owner}** - ${item.recommended_action.action}`);
    lines.push("- Sources:");
    if (item.evidence.length === 0) {
      lines.push("  - No linked source available");
    } else {
      item.evidence.forEach((e) => {
        const label = `${e.source} (${e.date}, ${e.confidence})`;
        lines.push(`  - [${label}](${e.url})`);
      });
    }
    lines.push("");
  });

  if (payload.watch_items.length > 0) {
    lines.push("## Watch Items", "");
    payload.watch_items.forEach((item, i) => {
      lines.push(`### ${i + 1}. ${item.title}`);
      lines.push(`- ${item.summary}`);
      lines.push("- Sources:");
      if (item.evidence.length === 0) {
        lines.push("  - No linked source available");
      } else {
        item.evidence.forEach((e) => {
          const label = `${e.source} (${e.date}, ${e.confidence})`;
          lines.push(`  - [${label}](${e.url})`);
        });
      }
      lines.push("");
    });
  }

  if (payload.invalidations_to_monitor.length > 0) {
    lines.push("## Invalidations To Monitor", ...payload.invalidations_to_monitor.map((x) => `- ${x}`), "");
  }

  return lines.join("\n");
}

export function formatContentIdeasMarkdown(title: string, payload: ContentIdeasOutput): string {
  const lines: string[] = [
    `# ${title}`,
    `Generated: ${payload.generated_at}`,
    `Playbook version: ${payload.playbook_version}`,
    "",
    ...(payload.selection_debug
      ? [
          `Selection mix (target -> achieved): beachhead ${payload.selection_debug.target_mix.beachhead} -> ${payload.selection_debug.achieved_mix.beachhead}, adjacent ${payload.selection_debug.target_mix.adjacent} -> ${payload.selection_debug.achieved_mix.adjacent}, broader ${payload.selection_debug.target_mix.broader} -> ${payload.selection_debug.achieved_mix.broader}`,
          "",
        ]
      : []),
    "## Prioritized Ideas",
    "",
  ];

  if (payload.ideas.length === 0) {
    lines.push("No compliant, high-signal content ideas identified in this run.", "");
  }

  payload.ideas.forEach((idea, i) => {
    lines.push(`### ${i + 1}. ${idea.title}`);
    lines.push(`- Segment/persona: **${idea.target_segment}** / **${idea.target_persona}**`);
    lines.push(`- Stage: **${idea.funnel_stage}**`);
    lines.push(`- Priority score: **${idea.priority_score}**`);
    lines.push(`- Thesis: ${idea.thesis}`);
    lines.push(`- Why now: ${idea.why_now}`);
    lines.push(`- Core claim: ${idea.core_claim}`);
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
        lines.push(`  - [${source.title}](${source.url}) (${source.source}, ${source.date})`)
      );
    }
    lines.push("");
  });

  return lines.join("\n");
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
    `Top per competitor: ${payload.topPerCompetitor}`,
    "",
    "## Prioritized Developments",
    "",
  ];

  if (payload.items.length === 0) {
    lines.push("No high-signal, Sourcegraph-overlap competitor updates identified in this run.", "");
    return lines.join("\n");
  }

  payload.items.forEach((item, i) => {
    lines.push(`### ${i + 1}. ${item.competitor}: ${item.title}`);
    lines.push(`- Date/source: ${item.date ?? "unknown"} (${item.date_confidence}) | **${item.source_type}** | ${item.source}`);
    lines.push(`- URL: [Open source](${item.url})`);
    lines.push(`- Threat/confidence: **${item.threat_level}** / **${item.confidence}**`);
    lines.push(`- Update type: ${item.update_type}`);
    lines.push(`- Overlap with Sourcegraph: ${item.overlap_with_sourcegraph.join(", ") || "none"}`);
    lines.push(`- Summary: ${item.summary}`);
    lines.push(`- Why it matters: ${item.why_it_matters}`);
    lines.push(`- Actionability: ${item.actionability.join(" | ")}`);
    lines.push(`<details><summary><strong>Evidence notes</strong></summary><div>${esc(item.evidence_notes.join(" | "))}</div></details>`);
    lines.push("");
  });

  return lines.join("\n");
}
