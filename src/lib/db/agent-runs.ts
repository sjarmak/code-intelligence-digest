/**
 * Agent run outputs: store and list results from GTM/marketing workflow jobs.
 */

import { randomUUID } from "crypto";
import { getSqlite } from "./index";
import { getDbClient, detectDriver } from "./driver";
import type { AgentId, JobId } from "../../config/agent-jobs";

export interface AgentRunRecord {
  id: string;
  agentId: AgentId;
  jobId: JobId;
  title: string;
  outputMarkdown: string | null;
  outputMetadata: string | null;
  createdAt: number;
}

export async function saveAgentRun(
  agentId: AgentId,
  jobId: JobId,
  title: string,
  outputMarkdown: string | null,
  outputMetadata?: Record<string, unknown> | null
): Promise<string> {
  const id = randomUUID();
  const driver = detectDriver();
  const now = Math.floor(Date.now() / 1000);
  const metadataStr =
    outputMetadata != null ? JSON.stringify(outputMetadata) : null;

  if (driver === "postgres") {
    const client = await getDbClient();
    await client.run(
      `INSERT INTO agent_runs (id, agent_id, job_id, title, output_markdown, output_metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, agentId, jobId, title, outputMarkdown, metadataStr, now]
    );
  } else {
    const sqlite = getSqlite();
    sqlite
      .prepare(
        `INSERT INTO agent_runs (id, agent_id, job_id, title, output_markdown, output_metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, agentId, jobId, title, outputMarkdown, metadataStr, now);
  }
  return id;
}

export async function listAgentRuns(
  options?: { agentId?: AgentId; jobId?: JobId; limit?: number }
): Promise<AgentRunRecord[]> {
  const limit = options?.limit ?? 50;
  const driver = detectDriver();

  if (driver === "postgres") {
    const client = await getDbClient();
    let sql = `SELECT id, agent_id, job_id, title, output_markdown, output_metadata, created_at
       FROM agent_runs`;
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (options?.agentId) {
      conditions.push(`agent_id = $${params.length + 1}`);
      params.push(options.agentId);
    }
    if (options?.jobId) {
      conditions.push(`job_id = $${params.length + 1}`);
      params.push(options.jobId);
    }
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await client.query(sql, params);
    return (result.rows as unknown as RawRow[]).map((r: RawRow) => rowToRecord(r));
  }

  const sqlite = getSqlite();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options?.agentId) {
    conditions.push("agent_id = ?");
    params.push(options.agentId);
  }
  if (options?.jobId) {
    conditions.push("job_id = ?");
    params.push(options.jobId);
  }
  let sql = `SELECT id, agent_id, job_id, title, output_markdown, output_metadata, created_at
     FROM agent_runs`;
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const rows = sqlite.prepare(sql).all(...params) as RawRow[];
  return rows.map(rowToRecord);
}

export async function getAgentRun(id: string): Promise<AgentRunRecord | null> {
  const driver = detectDriver();

  if (driver === "postgres") {
    const client = await getDbClient();
    const result = await client.query(
      `SELECT id, agent_id, job_id, title, output_markdown, output_metadata, created_at
       FROM agent_runs WHERE id = $1 LIMIT 1`,
      [id]
    );
    const r = result.rows[0] as unknown as RawRow | undefined;
    return r ? rowToRecord(r) : null;
  }

  const sqlite = getSqlite();
  const r = sqlite
    .prepare(
      `SELECT id, agent_id, job_id, title, output_markdown, output_metadata, created_at
       FROM agent_runs WHERE id = ? LIMIT 1`
    )
    .get(id) as RawRow | undefined;
  return r ? rowToRecord(r) : null;
}

interface RawRow {
  id: string;
  agent_id: string;
  job_id: string;
  title: string;
  output_markdown: string | null;
  output_metadata: string | null;
  created_at: number;
}

function rowToRecord(r: RawRow): AgentRunRecord {
  return {
    id: r.id,
    agentId: r.agent_id as AgentId,
    jobId: r.job_id as JobId,
    title: r.title,
    outputMarkdown: r.output_markdown,
    outputMetadata: r.output_metadata,
    createdAt: r.created_at,
  };
}
