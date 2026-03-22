/**
 * Per-user generated newsletters: store, list, delete
 */

import { getDbClient } from "./driver";
import { LEGACY_USER_ID } from "./constants";

export interface GeneratedNewsletterRecord {
  id: string;
  userId: string;
  title: string;
  markdown: string | null;
  html: string | null;
  createdAt: number;
}

export async function saveGeneratedNewsletter(
  id: string,
  userId: string,
  title: string,
  markdown: string | null,
  html: string | null
): Promise<void> {
  const uid = userId || LEGACY_USER_ID;
  const now = Math.floor(Date.now() / 1000);

  const client = await getDbClient();
  await client.run(
    `INSERT INTO generated_newsletters (id, user_id, title, markdown, html, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, markdown = EXCLUDED.markdown, html = EXCLUDED.html`,
    [id, uid, title, markdown, html, now]
  );
}

export async function listGeneratedNewsletters(
  userId: string = LEGACY_USER_ID,
  limit = 50
): Promise<GeneratedNewsletterRecord[]> {
  const uid = userId || LEGACY_USER_ID;

  const client = await getDbClient();
  const result = await client.query(
    `SELECT id, user_id, title, markdown, html, created_at
     FROM generated_newsletters
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [uid, limit]
  );
  return (
    result.rows as unknown as Array<{
      id: string;
      user_id: string;
      title: string;
      markdown: string | null;
      html: string | null;
      created_at: number;
    }>
  ).map((r) => ({
    id: r.id,
    userId: r.user_id,
    title: r.title,
    markdown: r.markdown,
    html: r.html,
    createdAt: r.created_at,
  }));
}

export async function getGeneratedNewsletter(
  id: string,
  userId: string = LEGACY_USER_ID
): Promise<GeneratedNewsletterRecord | null> {
  const uid = userId || LEGACY_USER_ID;

  const client = await getDbClient();
  const result = await client.query(
    `SELECT id, user_id, title, markdown, html, created_at
     FROM generated_newsletters
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [id, uid]
  );
  const r = result.rows[0] as
    | { id: string; user_id: string; title: string; markdown: string | null; html: string | null; created_at: number }
    | undefined;
  if (!r) return null;
  return { id: r.id, userId: r.user_id, title: r.title, markdown: r.markdown, html: r.html, createdAt: r.created_at };
}

export async function deleteGeneratedNewsletter(
  id: string,
  userId: string = LEGACY_USER_ID
): Promise<boolean> {
  const uid = userId || LEGACY_USER_ID;

  const client = await getDbClient();
  const result = await client.run(`DELETE FROM generated_newsletters WHERE id = $1 AND user_id = $2`, [id, uid]);
  return result.changes > 0;
}
