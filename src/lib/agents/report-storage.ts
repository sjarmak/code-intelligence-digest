/**
 * Agent report persistence: Postgres when DATABASE_URL is set (production).
 * When not set, callers use filesystem (.data/agent-reports/).
 */

import { getDbClient, getDatabaseUrl } from "../db/driver";

const VALID_GOALS = ["content_ideas", "market_brief", "competitor_intel"] as const;
let agentReportsUserIdEnsured = false;

/** True when Postgres is configured and agent reports should be stored in the DB. */
export function isAgentReportsDbEnabled(): boolean {
  return !!getDatabaseUrl()?.startsWith("postgres");
}

export interface ReportRow {
  goal: string;
  id: string;
  generatedAt: string;
}

const LEGACY_USER_ID = "legacy";

async function ensureAgentReportsUserIdColumn(): Promise<void> {
  if (!isAgentReportsDbEnabled() || agentReportsUserIdEnsured) return;
  const client = await getDbClient();
  try {
    await client.run(`ALTER TABLE agent_reports ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT 'legacy'`);
    await client.run(`UPDATE agent_reports SET user_id = 'legacy' WHERE user_id IS NULL`);
    await client.run(
      `CREATE INDEX IF NOT EXISTS idx_agent_reports_user_goal_generated ON agent_reports(user_id, goal, generated_at DESC)`,
    );
    agentReportsUserIdEnsured = true;
  } catch {
    // Ignore: table may not exist yet in some local setups until first write.
    // Do not mark ensured=true so fallback paths can still run.
  }
}

function isMissingUserIdColumn(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return msg.includes(`column "user_id" does not exist`) || msg.includes("column user_id does not exist");
}

/** Save report to DB (goal, id, content, generatedAt as ISO string). */
export async function saveReport(
  goal: string,
  id: string,
  content: string,
  generatedAt: string,
  userId: string = LEGACY_USER_ID,
): Promise<void> {
  if (!isAgentReportsDbEnabled() || !VALID_GOALS.includes(goal as (typeof VALID_GOALS)[number])) return;
  await ensureAgentReportsUserIdColumn();
  const client = await getDbClient();
  const generatedAtEpoch = Math.floor(new Date(generatedAt).getTime() / 1000);
  try {
    await client.run(
      "INSERT INTO agent_reports (user_id, goal, id, content, generated_at) VALUES (?, ?, ?, ?, ?)",
      [userId, goal, id, content, generatedAtEpoch]
    );
  } catch (error) {
    if (!isMissingUserIdColumn(error)) throw error;
    await client.run(
      "INSERT INTO agent_reports (goal, id, content, generated_at) VALUES (?, ?, ?, ?)",
      [goal, id, content, generatedAtEpoch]
    );
  }
}

/** List all reports from DB, sorted by generated_at desc. */
export async function listReports(userId: string = LEGACY_USER_ID): Promise<ReportRow[]> {
  if (!isAgentReportsDbEnabled()) return [];
  await ensureAgentReportsUserIdColumn();
  const client = await getDbClient();
  let result;
  try {
    result = await client.query(
      "SELECT goal, id, generated_at FROM agent_reports WHERE COALESCE(user_id, 'legacy') = ? ORDER BY generated_at DESC",
      [userId]
    );
  } catch (error) {
    if (!isMissingUserIdColumn(error)) throw error;
    result = await client.query(
      "SELECT goal, id, generated_at FROM agent_reports ORDER BY generated_at DESC"
    );
  }
  return (result.rows || []).map((r: Record<string, unknown>) => ({
    goal: String(r.goal),
    id: String(r.id),
    generatedAt: new Date(Number(r.generated_at) * 1000).toISOString(),
  }));
}

/** Get one report by goal and id; or latest for goal if id not given. */
export async function getReport(
  goal: string,
  id?: string,
  userId: string = LEGACY_USER_ID,
): Promise<{ goal: string; id: string; generatedAt: string; content: string } | null> {
  if (!isAgentReportsDbEnabled() || !VALID_GOALS.includes(goal as (typeof VALID_GOALS)[number])) return null;
  await ensureAgentReportsUserIdColumn();
  const client = await getDbClient();
  let row: Record<string, unknown> | undefined;
  if (id && id !== "latest") {
    try {
      const result = await client.query(
        "SELECT goal, id, content, generated_at FROM agent_reports WHERE COALESCE(user_id, 'legacy') = ? AND goal = ? AND id = ?",
        [userId, goal, id]
      );
      row = result.rows?.[0] as Record<string, unknown> | undefined;
    } catch (error) {
      if (!isMissingUserIdColumn(error)) throw error;
      const result = await client.query(
        "SELECT goal, id, content, generated_at FROM agent_reports WHERE goal = ? AND id = ?",
        [goal, id]
      );
      row = result.rows?.[0] as Record<string, unknown> | undefined;
    }
  } else {
    try {
      const result = await client.query(
        "SELECT goal, id, content, generated_at FROM agent_reports WHERE COALESCE(user_id, 'legacy') = ? AND goal = ? ORDER BY generated_at DESC LIMIT 1",
        [userId, goal]
      );
      row = result.rows?.[0] as Record<string, unknown> | undefined;
    } catch (error) {
      if (!isMissingUserIdColumn(error)) throw error;
      const result = await client.query(
        "SELECT goal, id, content, generated_at FROM agent_reports WHERE goal = ? ORDER BY generated_at DESC LIMIT 1",
        [goal]
      );
      row = result.rows?.[0] as Record<string, unknown> | undefined;
    }
  }
  if (!row) return null;
  return {
    goal: String(row.goal),
    id: String(row.id),
    generatedAt: new Date(Number(row.generated_at) * 1000).toISOString(),
    content: String(row.content),
  };
}

/** Delete one report by goal and id. */
export async function deleteReport(
  goal: string,
  id: string,
  userId: string = LEGACY_USER_ID,
): Promise<boolean> {
  if (!isAgentReportsDbEnabled() || !VALID_GOALS.includes(goal as (typeof VALID_GOALS)[number])) return false;
  if (!id || id === "latest") return false;
  await ensureAgentReportsUserIdColumn();
  const client = await getDbClient();
  try {
    const result = await client.run(
      "DELETE FROM agent_reports WHERE COALESCE(user_id, 'legacy') = ? AND goal = ? AND id = ?",
      [userId, goal, id]
    );
    return (result.changes ?? 0) > 0;
  } catch (error) {
    if (!isMissingUserIdColumn(error)) throw error;
    const result = await client.run(
      "DELETE FROM agent_reports WHERE goal = ? AND id = ?",
      [goal, id]
    );
    return (result.changes ?? 0) > 0;
  }
}
