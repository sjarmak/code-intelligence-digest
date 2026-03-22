/**
 * POST /api/agents/reports/send-email
 * Send one or more agent reports to the signed-in user's email.
 * Body: { reportKeys: string[] } e.g. ["market_brief:abc-123", "content_ideas:def-456"]
 * Requires: RESEND_API_KEY, session with user.email. Optional: FROM_EMAIL (default onboarding@resend.dev for testing).
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Resend } from "resend";
import { marked } from "marked";
import { auth } from "@/src/auth";
import { initializeDatabase } from "@/src/lib/db/index";
import { getReport, isAgentReportsDbEnabled } from "@/src/lib/agents/report-storage";

const REPORT_DIR = path.join(process.cwd(), ".data", "agent-reports");
const VALID_GOALS = ["content_ideas", "market_brief", "competitor_intel"] as const;
const GOAL_LABELS: Record<string, string> = {
  content_ideas: "Content Ideas",
  market_brief: "Market Brief",
  competitor_intel: "Competitor Intel",
};

async function fetchReportContent(
  goal: string,
  id: string,
  userId: string
): Promise<{ goal: string; id: string; content: string; generatedAt: string } | null> {
  if (!VALID_GOALS.includes(goal as (typeof VALID_GOALS)[number])) return null;

  if (isAgentReportsDbEnabled()) {
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

/** Remove debug/tuning lines from content ideas reports (including old cached reports). */
function stripContentIdeasDebugLines(markdown: string): string {
  return markdown
    .split("\n")
    .filter(
      (line) =>
        !line.includes("Selection mix (target -> achieved)") &&
        !line.includes("Priority score: **")
    )
    .join("\n");
}

/** Make HTML email-safe: replace <details>/<summary> with plain blocks (many clients don't support them). */
function emailSafeHtml(html: string): string {
  return html
    .replace(/<details[^>]*>/gi, "<div style='margin:0.5rem 0 1rem;'>")
    .replace(/<\/details>/gi, "</div>")
    .replace(/<summary[^>]*>/gi, "<strong style='display:block;margin-bottom:0.25rem;'>")
    .replace(/<\/summary>/gi, "</strong>");
}

function markdownToEmailHtml(markdown: string, goal?: string): string {
  const cleaned =
    goal === "content_ideas" ? stripContentIdeasDebugLines(markdown) : markdown;
  let rawHtml = marked.parse(cleaned, { async: false }) as string;
  rawHtml = emailSafeHtml(rawHtml);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Report</title>
  <style type="text/css">
    .report-body h1 { font-size: 1.5rem; font-weight: 700; margin: 1.5rem 0 0.5rem; color: #111827; }
    .report-body h2 { font-size: 1.25rem; font-weight: 600; margin: 1.25rem 0 0.5rem; color: #111827; }
    .report-body h3 { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.5rem; color: #374151; }
    .report-body p { margin: 0.5rem 0 1rem; }
    .report-body ul, .report-body ol { margin: 0.5rem 0 1rem; padding-left: 1.5rem; }
    .report-body li { margin: 0.25rem 0; }
    .report-body a { color: #2563eb; text-decoration: underline; }
    .report-body strong { font-weight: 600; }
    .report-body code { background: #f3f4f6; padding: 0.125rem 0.375rem; border-radius: 4px; font-size: 0.9em; }
  </style>
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #1a1a1a; background-color: #f5f5f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden;">
          <tr>
            <td style="padding: 32px 28px;">
              <div style="font-size: 14px; color: #6b7280; margin-bottom: 8px;">Code Intelligence Digest · Agent Report</div>
              <div style="border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px;"></div>
              <div class="report-body" style="word-wrap: break-word;">${rawHtml}</div>
              <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
                You received this because you requested agent reports from Code Intelligence Digest.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    const email = (session.user as { email?: string | null }).email?.trim();
    if (!email) {
      return NextResponse.json(
        { error: "No email address on your account. Add an email in your profile to receive reports." },
        { status: 400 }
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Email sending is not configured. Set RESEND_API_KEY in .env.local (local) or in your host's environment (e.g. Render dashboard). Get an API key at https://resend.com/api-keys",
        },
        { status: 503 }
      );
    }

    const body = (await req.json()) as { reportKeys?: unknown };
    const reportKeys = Array.isArray(body.reportKeys) ? body.reportKeys : [];
    if (reportKeys.length === 0) {
      return NextResponse.json({ error: "Provide reportKeys (e.g. [\"market_brief:abc-123\"])." }, { status: 400 });
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

    const reports: { goal: string; id: string; content: string; generatedAt: string }[] = [];
    for (const { goal, id } of parsed) {
      const report = await fetchReportContent(goal, id, session.user.id);
      if (report) reports.push(report);
    }

    if (reports.length === 0) {
      return NextResponse.json({ error: "None of the requested reports could be found." }, { status: 404 });
    }

    const from =
      process.env.FROM_EMAIL?.trim() || "Code Intel Digest <onboarding@resend.dev>";
    const resend = new Resend(apiKey);
    const results: { goal: string; id: string; sent: boolean; error?: string }[] = [];

    for (const report of reports) {
      const label = GOAL_LABELS[report.goal] ?? report.goal;
      const generated = new Date(report.generatedAt);
      const dateStr = generated.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
      const subject = `${label} Agent Report – ${dateStr}`;
      const html = markdownToEmailHtml(report.content, report.goal);

      const { data, error } = await resend.emails.send({
        from,
        to: [email],
        subject,
        html,
      });

      if (error) {
        results.push({ goal: report.goal, id: report.id, sent: false, error: error.message });
      } else {
        results.push({ goal: report.goal, id: report.id, sent: true });
      }
    }

    const sent = results.filter((r) => r.sent).length;
    const failed = results.filter((r) => !r.sent);
    const failedDetail =
      failed.length > 0
        ? failed
            .map(
              (r) =>
                `${GOAL_LABELS[r.goal] ?? r.goal}: ${r.error ?? "unknown error"}`
            )
            .join("; ")
        : "";
    return NextResponse.json({
      success: true,
      message: sent === reports.length
        ? `Sent ${sent} report(s) to ${email}.`
        : `Sent ${sent} of ${reports.length} report(s). Failed: ${failedDetail}`,
      results,
    });
  } catch (error) {
    console.error("Send report email error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send email." },
      { status: 500 }
    );
  }
}
