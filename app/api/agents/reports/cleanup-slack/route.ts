/**
 * POST /api/agents/reports/cleanup-slack
 * Delete Slack report messages posted by this bot in a channel for the past N days.
 * Body: { channelId?: string, days?: number, dryRun?: boolean }
 */

import { NextResponse } from "next/server";
import { auth } from "@/src/auth";
import {
  deleteSlackMessage,
  getSlackIdentity,
  listSlackChannelMessages,
  listSlackThreadReplies,
} from "@/src/lib/integrations/slack";

interface SlackMsg {
  ts: string;
  text?: string;
  user?: string;
  bot_id?: string;
  app_id?: string;
  thread_ts?: string;
  reply_count?: number;
}

function parseSlackTsReference(ref: string): string | null {
  const raw = ref.trim();
  if (!raw) return null;

  if (/^\d+\.\d+$/.test(raw)) return raw;

  // Slack message URLs typically contain /p1741207079116899
  const pMatch = raw.match(/\/p(\d{16,})/);
  if (pMatch?.[1]) {
    const digits = pMatch[1];
    const sec = digits.slice(0, 10);
    const frac = digits.slice(10);
    return `${sec}.${frac}`;
  }

  return null;
}

function isLikelyReportMessage(msg: SlackMsg): boolean {
  const t = (msg.text ?? "").toLowerCase();
  if (!t) return false;
  return (
    t.includes("report id:") ||
    t.includes("top takeaways") ||
    t.includes("source links") ||
    t.includes("competitor intel") ||
    t.includes("market brief") ||
    t.includes("content ideas") ||
    t.includes("pdf attachment")
  );
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
        { error: "Slack is not configured. Set SLACK_BOT_TOKEN." },
        { status: 503 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      channelId?: unknown;
      days?: unknown;
      dryRun?: unknown;
      messageRefs?: unknown;
      includeThread?: unknown;
    };
    const channelId =
      (typeof body.channelId === "string" && body.channelId.trim()) || defaultChannelId;
    if (!channelId) {
      return NextResponse.json(
        {
          error:
            "Slack channel is not configured. Provide channelId in request or set SLACK_REPORT_CHANNEL_ID.",
        },
        { status: 400 }
      );
    }

    const daysRaw = typeof body.days === "number" ? body.days : 14;
    const days = Math.max(1, Math.min(365, Math.floor(daysRaw)));
    const dryRun = Boolean(body.dryRun);
    const includeThread = body.includeThread !== false;
    const oldest = String(Math.floor(Date.now() / 1000) - days * 24 * 60 * 60);

    const { userId, botId } = await getSlackIdentity({ token: slackToken });
    const toDelete = new Map<string, SlackMsg>();

    const refs = Array.isArray(body.messageRefs)
      ? body.messageRefs.filter((x): x is string => typeof x === "string")
      : [];
    const parsedRefs = refs.map(parseSlackTsReference).filter((x): x is string => Boolean(x));

    if (parsedRefs.length > 0) {
      for (const ts of parsedRefs) {
        toDelete.set(ts, { ts, text: "targeted" });
        if (!includeThread) continue;
        try {
          const replies = await listSlackThreadReplies({
            token: slackToken,
            channelId,
            threadTs: ts,
          });
          for (const reply of replies) {
            const authoredByThisBot =
              (userId && reply.user === userId) || (botId && reply.bot_id === botId);
            if (!authoredByThisBot) continue;
            toDelete.set(reply.ts, reply);
          }
        } catch {
          // ignore when ts is not a parent thread or replies scope missing
        }
      }
    } else {
      let cursor: string | undefined;
      const parents: SlackMsg[] = [];

      for (let page = 0; page < 10; page += 1) {
        const batch = await listSlackChannelMessages({
          token: slackToken,
          channelId,
          oldest,
          cursor,
          limit: 200,
        });
        for (const msg of batch.messages) {
          const authoredByThisBot =
            (userId && msg.user === userId) || (botId && msg.bot_id === botId);
          if (!authoredByThisBot) continue;
          if (!isLikelyReportMessage(msg)) continue;
          parents.push(msg);
        }
        if (!batch.nextCursor) break;
        cursor = batch.nextCursor;
      }

      for (const msg of parents) {
        toDelete.set(msg.ts, msg);
        const isParent = msg.thread_ts == null || msg.thread_ts === msg.ts;
        if (!includeThread || !isParent || !msg.reply_count || msg.reply_count <= 0) continue;

        try {
          const replies = await listSlackThreadReplies({
            token: slackToken,
            channelId,
            threadTs: msg.ts,
          });
          for (const reply of replies) {
            const authoredByThisBot =
              (userId && reply.user === userId) || (botId && reply.bot_id === botId);
            if (!authoredByThisBot) continue;
            toDelete.set(reply.ts, reply);
          }
        } catch {
          // If reply listing fails due scope/channel constraints, still delete parent candidates.
        }
      }
    }

    const targets = Array.from(toDelete.values()).sort((a, b) => Number(a.ts) - Number(b.ts));
    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        message: `Would delete ${targets.length} Slack message(s) from last ${days} day(s).`,
        count: targets.length,
        sample: targets.slice(0, 20).map((m) => ({
          ts: m.ts,
          text: (m.text ?? "").slice(0, 120),
        })),
      });
    }

    let deleted = 0;
    const failures: Array<{ ts: string; error: string }> = [];
    for (const target of targets) {
      try {
        await deleteSlackMessage({ token: slackToken, channelId, ts: target.ts });
        deleted += 1;
      } catch (err) {
        failures.push({
          ts: target.ts,
          error: err instanceof Error ? err.message : "delete_failed",
        });
      }
    }

    return NextResponse.json({
      success: failures.length === 0,
      message:
        failures.length === 0
          ? `Deleted ${deleted} Slack message(s).`
          : `Deleted ${deleted} of ${targets.length}. ${failures.length} failed.`,
      deleted,
      total: targets.length,
      failures,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cleanup failed." },
      { status: 500 }
    );
  }
}
