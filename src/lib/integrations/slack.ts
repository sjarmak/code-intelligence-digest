type SlackText = {
  type: "mrkdwn" | "plain_text";
  text: string;
};

type SlackSectionBlock = {
  type: "section";
  text: SlackText;
};

type SlackDividerBlock = {
  type: "divider";
};

export type SlackBlock = SlackSectionBlock | SlackDividerBlock;

interface SlackApiError extends Error {
  code?: string;
}

interface SlackPostMessageResponse {
  ok: boolean;
  ts?: string;
  error?: string;
}

interface SlackAuthTestResponse {
  ok: boolean;
  user_id?: string;
  bot_id?: string;
  error?: string;
}

interface SlackUploadUrlResponse {
  ok: boolean;
  upload_url?: string;
  file_id?: string;
  error?: string;
}

interface SlackCompleteUploadResponse {
  ok: boolean;
  error?: string;
}

interface SlackHistoryMessage {
  type?: string;
  subtype?: string;
  text?: string;
  ts: string;
  user?: string;
  bot_id?: string;
  app_id?: string;
  thread_ts?: string;
  reply_count?: number;
}

interface SlackHistoryResponse {
  ok: boolean;
  messages?: SlackHistoryMessage[];
  error?: string;
  response_metadata?: {
    next_cursor?: string;
  };
}

interface SlackRepliesResponse {
  ok: boolean;
  messages?: SlackHistoryMessage[];
  error?: string;
}

interface SlackDeleteResponse {
  ok: boolean;
  error?: string;
}

function makeError(message: string, code?: string): SlackApiError {
  const err = new Error(message) as SlackApiError;
  err.code = code;
  return err;
}

async function slackJsonPost<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as T;
  return data;
}

async function slackGet<T>(
  token: string,
  method: string,
  query?: Record<string, string | number | undefined>
): Promise<T> {
  const url = new URL(`https://slack.com/api/${method}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v == null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = (await res.json()) as T;
  return data;
}

async function slackFormPost<T>(
  token: string,
  method: string,
  params: URLSearchParams
): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = (await res.json()) as T;
  return data;
}

export async function postSlackMessage(params: {
  token: string;
  channelId: string;
  text: string;
  blocks?: SlackBlock[];
  threadTs?: string;
  metadata?: {
    event_type: string;
    event_payload: Record<string, string>;
  };
}): Promise<{ ts: string }> {
  const data = await slackJsonPost<SlackPostMessageResponse>(
    params.token,
    "chat.postMessage",
    {
      channel: params.channelId,
      text: params.text,
      blocks: params.blocks,
      thread_ts: params.threadTs,
      metadata: params.metadata,
      unfurl_links: false,
      unfurl_media: false,
    }
  );
  if (!data.ok || !data.ts) {
    throw makeError(
      `Slack chat.postMessage failed: ${data.error ?? "unknown_error"}`,
      data.error
    );
  }
  return { ts: data.ts };
}

export async function uploadSlackFileToThread(params: {
  token: string;
  channelId: string;
  threadTs: string;
  filename: string;
  title: string;
  content: Buffer;
}): Promise<void> {
  const uploadMeta = await slackFormPost<SlackUploadUrlResponse>(
    params.token,
    "files.getUploadURLExternal",
    new URLSearchParams({
      filename: params.filename,
      length: String(params.content.byteLength),
      alt_text: params.title,
    })
  );

  if (!uploadMeta.ok || !uploadMeta.upload_url || !uploadMeta.file_id) {
    throw makeError(
      `Slack files.getUploadURLExternal failed: ${uploadMeta.error ?? "unknown_error"}`,
      uploadMeta.error
    );
  }

  const uploadRes = await fetch(uploadMeta.upload_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
    },
    body: new Uint8Array(params.content),
  });
  if (!uploadRes.ok) {
    throw makeError(`Slack upload URL request failed with HTTP ${uploadRes.status}`);
  }

  const complete = await slackJsonPost<SlackCompleteUploadResponse>(
    params.token,
    "files.completeUploadExternal",
    {
      files: [{ id: uploadMeta.file_id, title: params.title }],
      channel_id: params.channelId,
      thread_ts: params.threadTs,
      initial_comment: "PDF attachment",
    }
  );
  if (!complete.ok) {
    throw makeError(
      `Slack files.completeUploadExternal failed: ${complete.error ?? "unknown_error"}`,
      complete.error
    );
  }
}

export async function getSlackIdentity(params: {
  token: string;
}): Promise<{ userId?: string; botId?: string }> {
  const data = await slackGet<SlackAuthTestResponse>(params.token, "auth.test");
  if (!data.ok) {
    throw makeError(`Slack auth.test failed: ${data.error ?? "unknown_error"}`, data.error);
  }
  return { userId: data.user_id, botId: data.bot_id };
}

export async function listSlackChannelMessages(params: {
  token: string;
  channelId: string;
  oldest?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ messages: SlackHistoryMessage[]; nextCursor?: string }> {
  const data = await slackGet<SlackHistoryResponse>(params.token, "conversations.history", {
    channel: params.channelId,
    oldest: params.oldest,
    cursor: params.cursor,
    limit: params.limit ?? 200,
    inclusive: 1,
  });
  if (!data.ok) {
    throw makeError(
      `Slack conversations.history failed: ${data.error ?? "unknown_error"}`,
      data.error
    );
  }
  return {
    messages: data.messages ?? [],
    nextCursor: data.response_metadata?.next_cursor,
  };
}

export async function listSlackThreadReplies(params: {
  token: string;
  channelId: string;
  threadTs: string;
}): Promise<SlackHistoryMessage[]> {
  const data = await slackGet<SlackRepliesResponse>(params.token, "conversations.replies", {
    channel: params.channelId,
    ts: params.threadTs,
    limit: 200,
    inclusive: 1,
  });
  if (!data.ok) {
    throw makeError(
      `Slack conversations.replies failed: ${data.error ?? "unknown_error"}`,
      data.error
    );
  }
  return data.messages ?? [];
}

export async function deleteSlackMessage(params: {
  token: string;
  channelId: string;
  ts: string;
}): Promise<void> {
  const data = await slackJsonPost<SlackDeleteResponse>(
    params.token,
    "chat.delete",
    {
      channel: params.channelId,
      ts: params.ts,
    }
  );
  if (!data.ok) {
    throw makeError(`Slack chat.delete failed: ${data.error ?? "unknown_error"}`, data.error);
  }
}

export function extractTakeawaysAndLinks(markdown: string): {
  takeaways: string[];
  links: { title: string; url: string }[];
} {
  const lines = markdown.split(/\r?\n/);
  const prioritized: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    const rich = line.match(
      /^[-*+]\s+\*\*(Why it matters|Sourcegraph opportunity|Sourcegraph integration play|Summary|Actionability):\*\*\s*(.*)$/i
    );
    if (rich?.[2]) {
      prioritized.push(`${rich[1]}: ${rich[2].trim()}`);
    }
  }

  const headingIdx = lines.findIndex((line) =>
    /^##?\s+/.test(line) &&
    /(takeaways?|highlights?|summary|executive)/i.test(line)
  );

  const fromSection: string[] = [];
  if (headingIdx >= 0) {
    for (let i = headingIdx + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (/^##?\s+/.test(line)) break;
      const bullet = line.match(/^[-*+]\s+(.*)$/);
      if (bullet?.[1]) fromSection.push(bullet[1].trim());
    }
  }

  const anyBullets = lines
    .map((line) => line.trim().match(/^[-*+]\s+(.*)$/)?.[1]?.trim() ?? "")
    .filter(Boolean);

  const takeawaySource =
    prioritized.length > 0 ? prioritized : fromSection.length > 0 ? fromSection : anyBullets;

  const takeaways = takeawaySource
    .map((line) => line.replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, "$1"))
    .map((line) => line.replace(/[`*_>#]/g, "").trim())
    .filter(Boolean)
    .slice(0, 5);

  const links: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  const markdownLinkRe = /\[([^\]]{1,120})\]\((https?:\/\/[^\s)]+)\)/g;
  const bareUrlRe = /(https?:\/\/[^\s)]+)/g;
  const sourceHostRe =
    /^[-*+]\s+\*\*Date\/Source:\*\*\s*[^·\n]+·\s*([A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
  const linkLineRe = /^[-*+]\s+\*\*Link:\*\*\s*(https?:\/\/[^\s)]+)/i;

  for (const line of lines) {
    let m: RegExpExecArray | null;
    while ((m = markdownLinkRe.exec(line)) !== null) {
      const title = m[1].trim();
      const url = m[2].trim();
      if (!seen.has(url)) {
        seen.add(url);
        links.push({ title, url });
      }
    }
    if (links.length >= 8) break;
  }

  // Structured competitor-intel line pairs:
  // - **Date/Source:** ... · hostname
  // - **Link:** https://...
  if (links.length < 8) {
    for (let i = 0; i < lines.length; i += 1) {
      const linkLine = lines[i].trim();
      const lm = linkLine.match(linkLineRe);
      if (!lm?.[1]) continue;
      const url = lm[1].trim();
      if (seen.has(url)) continue;

      let title = "";
      for (let j = i - 1; j >= Math.max(0, i - 5); j -= 1) {
        const src = lines[j].trim().match(sourceHostRe);
        if (src?.[1]) {
          title = src[1].trim();
          break;
        }
      }
      if (!title) {
        try {
          title = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          title = "Source";
        }
      }
      seen.add(url);
      links.push({ title, url });
      if (links.length >= 8) break;
    }
  }

  if (links.length < 8) {
    for (const line of lines) {
      let m: RegExpExecArray | null;
      while ((m = bareUrlRe.exec(line)) !== null) {
        const url = m[1].trim();
        if (!seen.has(url)) {
          seen.add(url);
          let title = "Source";
          try {
            title = new URL(url).hostname.replace(/^www\./, "");
          } catch {
            // keep default
          }
          links.push({ title, url });
        }
      }
      if (links.length >= 8) break;
    }
  }

  return {
    takeaways,
    links: links.slice(0, 8),
  };
}

export function markdownToSlackMrkdwn(markdown: string): string {
  return markdown
    .replace(/^###\s+(.*)$/gm, "*$1*")
    .replace(/^##\s+(.*)$/gm, "*$1*")
    .replace(/^#\s+(.*)$/gm, "*$1*")
    .replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>")
    .replace(/\*\*(.*?)\*\*/g, "*$1*")
    .replace(/`([^`]+)`/g, "`$1`");
}

export function chunkSlackText(text: string, maxChars = 3200): string[] {
  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    const withNl = current.length > 0 ? `${current}\n${line}` : line;
    if (withNl.length <= maxChars) {
      current = withNl;
      continue;
    }
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
    if (line.length <= maxChars) {
      current = line;
      continue;
    }
    let start = 0;
    while (start < line.length) {
      chunks.push(line.slice(start, start + maxChars));
      start += maxChars;
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [text];
}
