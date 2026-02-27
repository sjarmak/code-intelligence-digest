/**
 * Agent report persistence: Postgres when DATABASE_URL is set (production).
 * When not set, callers use filesystem (.data/agent-reports/).
 */

import { getDbClient, getDatabaseUrl } from "../db/driver";

const VALID_GOALS = ["content_ideas", "market_brief", "competitor_intel"] as const;

export function useReportDb(): boolean {
  return !!getDatabaseUrl()?.startsWith("postgres");
}

export interface ReportRow {
  goal: string;
  id: string;
  generatedAt: string;
}

/** Save report to DB (goal, id, content, generatedAt as ISO string). */
export async function saveReport(
  goal: string,
  id: string,
  content: string,
  generatedAt: string
): Promise<void> {
  if (!useReportDb() || !VALID_GOALS.includes(goal as (typeof VALID_GOALS)[number])) return;
  const client = await getDbClient();
  const generatedAtEpoch = Math.floor(new Date(generatedAt).getTime() / 1000);
  await client.run(
    "INSERT INTO agent_reports (goal, id, content, generated_at) VALUES (?, ?, ?, ?)",
    [goal, id, content, generatedAtEpoch]
  );
}

/** List all reports from DB, sorted by generated_at desc. */
export async function listReports(): Promise<ReportRow[]> {
  if (!useReportDb()) return [];
  const client = await getDbClient();
  const result = await client.query(
    "SELECT goal, id, generated_at FROM agent_reports ORDER BY generated_at DESC"
  );
  return (result.rows || []).map((r: Record<string, unknown>) => ({
    goal: String(r.goal),
    id: String(r.id),
    generatedAt: new Date(Number(r.generated_at) * 1000).toISOString(),
  }));
}

/** Get one report by goal and id; or latest for goal if id not given. */
export async function getReport(
  goal: string,
  id?: string
): Promise<{ goal: string; id: string; generatedAt: string; content: string } | null> {
  if (!useReportDb() || !VALID_GOALS.includes(goal as (typeof VALID_GOALS)[number])) return null;
  const client = await getDbClient();
  let row: Record<string, unknown> | undefined;
  if (id && id !== "latest") {
    const result = await client.query(
      "SELECT goal, id, content, generated_at FROM agent_reports WHERE goal = ? AND id = ?",
      [goal, id]
    );
    row = result.rows?.[0] as Record<string, unknown> | undefined;
  } else {
    const result = await client.query(
      "SELECT goal, id, content, generated_at FROM agent_reports WHERE goal = ? ORDER BY generated_at DESC LIMIT 1",
      [goal]
    );
    row = result.rows?.[0] as Record<string, unknown> | undefined;
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
export async function deleteReport(goal: string, id: string): Promise<boolean> {
  if (!useReportDb() || !VALID_GOALS.includes(goal as (typeof VALID_GOALS)[number])) return false;
  if (!id || id === "latest") return false;
  const client = await getDbClient();
  const result = await client.run(
    "DELETE FROM agent_reports WHERE goal = ? AND id = ?",
    [goal, id]
  );
  return (result.changes ?? 0) > 0;
}
