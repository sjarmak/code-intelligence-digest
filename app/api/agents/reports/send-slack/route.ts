/**
 * POST /api/agents/reports/send-slack
 * Send one or more agent reports to Slack:
 * - parent message: takeaways + linked bullets
 * - thread reply: full report markdown
 * - thread attachment: PDF
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { auth } from "@/src/auth";
import { initializeDatabase } from "@/src/lib/db/index";
import { getReport, useReportDb } from "@/src/lib/agents/report-storage";
import {
  extractTakeawaysAndLinks,
  postSlackMessage,
  type SlackBlock,
  uploadSlackFileToThread,
} from "@/src/lib/integrations/slack";
import { renderReportPdf } from "@/src/lib/pdf/simple-report-pdf";

const REPORT_DIR = path.join(process.cwd(), ".data", "agent-reports");
const VALID_GOALS = ["content_ideas", "market_brief", "competitor_intel"] as const;
const GOAL_LABELS: Record<string, string> = {
  content_ideas: "Content Ideas",
  market_brief: "Market Brief",
  competitor_intel: "Competitor Intel",
};

function normalizeCompetitorMarkdown(markdown: string): string {
  return markdown
    .replace(/^###\s+\d+\.\s+/gm, "### ")
    .replace(/^(\d+)\.\s+/gm, "- ");
}

interface MarketBriefSummary {
  title: string;
  why: string;
  links: Array<{ title: string; url: string }>;
}

interface CompetitorSectionSummary {
  competitor: string;
  summary: string;
  links: Array<{ title: string; url: string }>;
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function summarizeCompetitorReport(markdown: string): CompetitorSectionSummary[] {
  const lines = markdown.split(/\r?\n/);
  const sectionStarts: Array<{ name: string; index: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^##\s+(.+)$/);
    if (m?.[1]) sectionStarts.push({ name: m[1].trim(), index: i });
  }

  const result: CompetitorSectionSummary[] = [];
  for (let i = 0; i < sectionStarts.length; i += 1) {
    const current = sectionStarts[i];
    const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : lines.length;
    const section = lines.slice(current.index + 1, end);

    let summary = "";
    const links: Array<{ title: string; url: string }> = [];
    const seen = new Set<string>();
    let currentItemTitle = "";

    for (const raw of section) {
      const line = raw.trim();
      const itemTitle = line.match(/^###\s+(.+)$/);
      if (itemTitle?.[1]) {
        currentItemTitle = itemTitle[1].trim();
        continue;
      }
      const summaryMatch = line.match(/^- \*\*Summary:\*\*\s*(.+)$/);
      if (summaryMatch?.[1] && !summary) {
        summary = summaryMatch[1].trim();
      }
      const linkMatch = line.match(/^- \*\*Link:\*\*\s*(https?:\/\/[^\s)]+)$/);
      if (linkMatch?.[1]) {
        const url = linkMatch[1].trim();
        if (seen.has(url)) continue;
        seen.add(url);
        links.push({
          title: currentItemTitle || hostnameFromUrl(url),
          url,
        });
      }
    }

    if (!summary) {
      summary = "New activity detected in this period.";
    }

    result.push({
      competitor: current.name,
      summary,
      links: links.slice(0, 3),
    });
  }

  return result;
}

function summarizeMarketBrief(markdown: string): MarketBriefSummary[] {
  const cleanInline = (value: string): string =>
    value
      .replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[*_]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const isBulletLine = (line: string): boolean =>
    /^[-*+•]\s+/.test(line.trim());

  const bulletValue = (line: string): string =>
    line.trim().replace(/^[-*+•]\s+/, "").trim();

  const sourceUrlsFromLine = (line: string): string[] => {
    const found: string[] = [];
    const re = /(https?:\/\/[^\s,|)]+)|\b([a-z0-9.-]+\.[a-z]{2,})(\/[^\s,|)]*)?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const url = m[1]
        ? m[1]
        : `https://${(m[2] ?? "").replace(/^www\./, "www.")}${m[3] ?? ""}`;
      if (url) found.push(url);
    }
    return found;
  };

  const lines = markdown.split(/\r?\n/);
  const out: MarketBriefSummary[] = [];
  let i = 0;
  while (i < lines.length) {
    const h = lines[i].match(/^###\s+(?:\d+\.\s+)?(.+)$/);
    if (!h?.[1]) {
      i += 1;
      continue;
    }

    const title = cleanInline(h[1].trim());
    let why = "";
    const links: Array<{ title: string; url: string }> = [];
    const seen = new Set<string>();

    i += 1;
    let firstBullet = "";
    let inSourcesBlock = false;
    for (; i < lines.length; i += 1) {
      const rawLine = lines[i];
      const line = rawLine.trim();
      if (/^###\s+(?:\d+\.\s+)?/.test(line)) break;
      if (/^##\s+/.test(line)) break;

      const bulletText = isBulletLine(line) ? bulletValue(line) : "";
      if (bulletText && !firstBullet) firstBullet = cleanInline(bulletText);

      const whyMatch = line.match(
        /^[-*+•]?\s*\*?\*?(Why(?:\s+this)?\s+matters?|Summary)\*?\*?:\s*(.+)$/i
      );
      if (whyMatch?.[2] && !why) why = cleanInline(whyMatch[2].trim());

      if (!why && /^[-*+•]?\s*\*\*Summary:\*\*\s*(.+)$/i.test(line)) {
        const summary = line.match(/^[-*+•]?\s*\*\*Summary:\*\*\s*(.+)$/i);
        if (summary?.[1]) why = cleanInline(summary[1].trim());
      }

      const mdLinks = Array.from(line.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g));
      for (const mdLink of mdLinks) {
        const text = mdLink[1]?.trim();
        const url = mdLink[2]?.trim();
        if (!url || !text) continue;
        if (!seen.has(url)) {
          seen.add(url);
          links.push({ title: cleanInline(text), url });
        }
      }

      const sourcesLine = line.match(/^[-*+•]?\s*\*?\*?Sources?\*?\*?:\s*(.*)$/i);
      if (sourcesLine?.[1]) {
        inSourcesBlock = true;
        const urls = sourceUrlsFromLine(sourcesLine[1]);
        for (const url of urls) {
          if (seen.has(url)) continue;
          seen.add(url);
          links.push({ title: hostnameFromUrl(url), url });
        }
        continue;
      }

      // Support multi-line source lists after a "Sources:" line.
      if (inSourcesBlock) {
        if (!line) {
          inSourcesBlock = false;
          continue;
        }
        if (!isBulletLine(line) && !/^https?:\/\//i.test(line) && !/[a-z0-9.-]+\.[a-z]{2,}/i.test(line)) {
          inSourcesBlock = false;
          continue;
        }
        const urls = sourceUrlsFromLine(line);
        for (const url of urls) {
          if (seen.has(url)) continue;
          seen.add(url);
          links.push({ title: hostnameFromUrl(url), url });
        }
      }
    }

    // Avoid noisy fallback values like "Segment impact" when no actual why/summary exists.
    const noisyFallback = /^(segment impact|persona impact|evidence quality|recommended owner\/action|sources?)\b/i.test(
      firstBullet
    );

    out.push({
      title,
      why: cleanInline(
        why || (!noisyFallback ? firstBullet : "") || "Relevant GTM signal identified in this period."
      ),
      links: links.slice(0, 3),
    });
    if (out.length >= 4) break;
  }
  return out;
}

async function fetchReportContent(
  goal: string,
  id: string,
  userId: string
): Promise<{ goal: string; id: string; content: string; generatedAt: string } | null> {
  if (!VALID_GOALS.includes(goal as (typeof VALID_GOALS)[number])) return null;

  if (useReportDb()) {
    await initializeDatabase();
    const row = await getReport(goal, id, userId);
    return row;
  }

  const goalDir = path.join(REPORT_DIR, goal);
  const filePath = path.join(goalDir, `${id}.md`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const stat = fs.statSync(filePath);
    return {
      goal,
      id: path.basename(filePath, ".md"),
      content,
      generatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function buildParentMessage(args: {
  goal: string;
  reportId: string;
  generatedAt: string;
  markdown: string;
}): { text: string; blocks: SlackBlock[] } {
  const label = GOAL_LABELS[args.goal] ?? args.goal;
  const dateStr = new Date(args.generatedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  if (args.goal === "competitor_intel") {
    const sections = summarizeCompetitorReport(args.markdown);
    const fallbackText = `${label} report (${dateStr})`;
    const blocks: SlackBlock[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${label}* · ${dateStr}`,
        },
      },
    ];

    for (const section of sections) {
      const linksText =
        section.links.length > 0
          ? section.links.map((l) => `• <${l.url}|${l.title}>`).join("\n")
          : "• No links found";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*${section.competitor}*\n` +
            `• ${section.summary}\n` +
            `*Links*\n${linksText}`,
        },
      });
    }

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Report ID: \`${args.reportId}\``,
      },
    });

    return {
      text: fallbackText,
      blocks,
    };
  }

  if (args.goal === "market_brief") {
    const sections = summarizeMarketBrief(args.markdown);
    const fallbackText = `${label} report (${dateStr})`;
    const blocks: SlackBlock[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${label}* · ${dateStr}` },
      },
    ];

    for (const s of sections) {
      const linksText =
        s.links.length > 0
          ? s.links.map((l) => `• <${l.url}|${l.title}>`).join("\n")
          : "• No links found";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${s.title}*\n• ${s.why}\n*Links*\n${linksText}`,
        },
      });
      blocks.push({ type: "divider" });
    }

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `Report ID: \`${args.reportId}\`` },
    });

    return { text: fallbackText, blocks };
  }

  const extracted = extractTakeawaysAndLinks(args.markdown);
  const takeaways = extracted.takeaways.length > 0
    ? extracted.takeaways
    : ["Report generated successfully. Open thread for full details."];
  const links = extracted.links;

  const takeawaysText = takeaways.map((t) => `• ${t}`).join("\n");
  const linksText =
    links.length > 0
      ? links.map((l) => `• <${l.url}|${l.title}>`).join("\n")
      : "• No explicit links found in this report";

  const text =
    `${label} report (${dateStr})\n` +
    `Top takeaways:\n${takeawaysText}\n` +
    `Sources:\n${linksText}`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${label}* · ${dateStr}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Top takeaways*\n${takeawaysText}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Source links*\n${linksText}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Report ID: \`${args.reportId}\``,
        },
      },
    ],
  };
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    const slackToken = process.env.SLACK_BOT_TOKEN?.trim();
    const defaultChannelId = process.env.SLACK_REPORT_CHANNEL_ID?.trim();
    if (!slackToken) {
      return NextResponse.json(
        {
          error:
            "Slack is not configured. Set SLACK_BOT_TOKEN in your environment.",
        },
        { status: 503 }
      );
    }

    const body = (await req.json()) as { reportKeys?: unknown; channelId?: unknown };
    const reportKeys = Array.isArray(body.reportKeys) ? body.reportKeys : [];
    const requestedChannelId =
      typeof body.channelId === "string" && body.channelId.trim().length > 0
        ? body.channelId.trim()
        : undefined;
    const channelId = requestedChannelId ?? defaultChannelId;

    if (!channelId) {
      return NextResponse.json(
        {
          error:
            "Slack channel is not configured. Provide channelId in request or set SLACK_REPORT_CHANNEL_ID.",
        },
        { status: 400 }
      );
    }

    if (reportKeys.length === 0) {
      return NextResponse.json(
        { error: "Provide reportKeys (e.g. [\"market_brief:abc-123\"])." },
        { status: 400 }
      );
    }

    const parsed: { goal: string; id: string }[] = [];
    for (const key of reportKeys) {
      if (typeof key !== "string") continue;
      const [goal, id] = key.split(":");
      if (goal && id && VALID_GOALS.includes(goal as (typeof VALID_GOALS)[number])) {
        parsed.push({ goal, id });
      }
    }
    if (parsed.length === 0) {
      return NextResponse.json({ error: "No valid reportKeys." }, { status: 400 });
    }

    const results: Array<{
      goal: string;
      id: string;
      sent: boolean;
      threadTs?: string;
      error?: string;
    }> = [];

    for (const { goal, id } of parsed) {
      const report = await fetchReportContent(goal, id, session.user.id);
      if (!report) {
        results.push({ goal, id, sent: false, error: "Report not found" });
        continue;
      }

      try {
        const normalizedContent =
          report.goal === "competitor_intel"
            ? normalizeCompetitorMarkdown(report.content)
            : report.content;

        const parent = buildParentMessage({
          goal: report.goal,
          reportId: report.id,
          generatedAt: report.generatedAt,
          markdown: normalizedContent,
        });
        const parentMsg = await postSlackMessage({
          token: slackToken,
          channelId,
          text: parent.text,
          blocks: parent.blocks,
        });

        const label = GOAL_LABELS[goal] ?? goal;
        const timestamp = new Date(report.generatedAt).toISOString().slice(0, 10);
        const safeLabel = label.toLowerCase().replace(/\s+/g, "-");
        const pdfTitle = `${label} Report ${timestamp}`;
        const pdfFilename = `${safeLabel}-${timestamp}.pdf`;
        const pdfBuffer = await renderReportPdf(normalizedContent, pdfTitle);
        await uploadSlackFileToThread({
          token: slackToken,
          channelId,
          threadTs: parentMsg.ts,
          filename: pdfFilename,
          title: pdfTitle,
          content: pdfBuffer,
        });

        results.push({
          goal: report.goal,
          id: report.id,
          sent: true,
          threadTs: parentMsg.ts,
        });
      } catch (err) {
        results.push({
          goal: report.goal,
          id: report.id,
          sent: false,
          error: err instanceof Error ? err.message : "Slack send failed",
        });
      }
    }

    const sent = results.filter((r) => r.sent).length;
    const failed = results.filter((r) => !r.sent);
    const failedDetail = failed
      .map((r) => `${GOAL_LABELS[r.goal] ?? r.goal}: ${r.error ?? "unknown"}`)
      .join("; ");

    return NextResponse.json({
      success: sent > 0,
      message:
        failed.length === 0
          ? `Sent ${sent} report(s) to Slack channel ${channelId}.`
          : `Sent ${sent} of ${results.length} report(s). Failed: ${failedDetail}`,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send to Slack." },
      { status: 500 }
    );
  }
}
