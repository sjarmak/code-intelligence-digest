/**
 * CopilotDbContext implementation backed by the local production mirror.
 *
 * Connects to LOCAL_DATABASE_URL (never DATABASE_URL). Refuses to open the
 * connection if the host is non-local — this is a belt-and-braces guard
 * against the copilot accidentally running against prod.
 *
 * Hot-path queries lean on indexes the mirror bootstrap puts in place:
 *   items.search_vector (GIN)       — for free-text search
 *   items.created_at, items.updated_at — for recency + watermark filters
 *   mirror_watermarks.last_synced_at — for freshness reporting
 */

import { Pool, type PoolClient } from 'pg';
import type { Category, FeedItem } from '../model';
import type {
  AggregateBucket,
  AggregateDimension,
  AggregateItemsOptions,
  CopilotDbContext,
  MirrorStatus,
  SearchItemsOptions,
} from './db-context';

const AGGREGATE_COL: Record<AggregateDimension, string> = {
  source: 'source_title',
  author: 'author',
  category: 'category',
};

const EMBEDDING_DIM = 1536;

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 20;

function assertLocalUrl(url: string): void {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  if (!isLocal) {
    throw new Error(
      `Copilot refuses to connect: LOCAL_DATABASE_URL host "${host}" is not local.`
    );
  }
}

interface ItemRow {
  id: string;
  stream_id: string;
  source_title: string;
  title: string;
  url: string;
  author: string | null;
  published_at: number | null;
  created_at: number | null;
  summary: string | null;
  content_snippet: string | null;
  categories: string[] | null;
  category: Category;
  full_text: string | null;
}

function rowToFeedItem(row: ItemRow): FeedItem {
  return {
    id: row.id,
    streamId: row.stream_id,
    sourceTitle: row.source_title,
    title: row.title,
    url: row.url,
    author: row.author ?? undefined,
    publishedAt: new Date((row.published_at ?? 0) * 1000),
    createdAt: row.created_at != null ? new Date(row.created_at * 1000) : undefined,
    summary: row.summary ?? undefined,
    contentSnippet: row.content_snippet ?? undefined,
    categories: row.categories ?? [],
    category: row.category,
    raw: null,
    fullText: row.full_text ?? undefined,
  };
}

const ITEM_COLUMNS = [
  'id',
  'stream_id',
  'source_title',
  'title',
  'url',
  'author',
  'published_at',
  'created_at',
  'summary',
  'content_snippet',
  'categories',
  'category',
  'full_text',
].join(', ');

export class MirrorCopilotDbContext implements CopilotDbContext {
  constructor(private readonly pool: Pool) {}

  async getItemById(id: string): Promise<FeedItem | null> {
    const r = await this.pool.query<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM items WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows.length ? rowToFeedItem(r.rows[0]) : null;
  }

  async searchItems(opts: SearchItemsOptions): Promise<FeedItem[]> {
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = opts.offset ?? 0;

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (opts.category) {
      params.push(opts.category);
      clauses.push(`category = $${params.length}`);
    }
    if (opts.since != null) {
      params.push(opts.since);
      clauses.push(`created_at >= $${params.length}`);
    }
    if (opts.until != null) {
      params.push(opts.until);
      clauses.push(`created_at < $${params.length}`);
    }

    const orderBy = opts.query
      ? `ts_rank(search_vector, q) DESC, created_at DESC`
      : `created_at DESC`;

    let sql: string;
    if (opts.query) {
      params.push(opts.query);
      const qIdx = params.length;
      clauses.push(`search_vector @@ q`);
      const where = clauses.join(' AND ');
      params.push(limit, offset);
      sql = `
        SELECT ${ITEM_COLUMNS}
        FROM items, websearch_to_tsquery('english', $${qIdx}) q
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `;
    } else {
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(limit, offset);
      sql = `
        SELECT ${ITEM_COLUMNS}
        FROM items
        ${where}
        ORDER BY ${orderBy}
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `;
    }

    const r = await this.pool.query<ItemRow>(sql, params);
    return r.rows.map(rowToFeedItem);
  }

  async semanticSearchByVector(vec: number[], limit: number): Promise<FeedItem[]> {
    if (vec.length !== EMBEDDING_DIM) {
      throw new Error(
        `semanticSearchByVector expects ${EMBEDDING_DIM}-dim vector, got ${vec.length}`
      );
    }
    const capped = Math.min(Math.max(limit, 1), MAX_LIMIT);
    // pgvector literal is "[0.1,0.2,...]" cast to ::vector.
    const vecStr = `[${vec.join(',')}]`;
    const r = await this.pool.query<ItemRow>(
      `SELECT ${ITEM_COLUMNS.split(', ').map((c) => `i.${c}`).join(', ')}
       FROM item_embeddings e
       JOIN items i ON i.id = e.item_id
       ORDER BY e.embedding <=> $1::vector
       LIMIT $2`,
      [vecStr, capped]
    );
    return r.rows.map(rowToFeedItem);
  }

  async aggregateItems(opts: AggregateItemsOptions): Promise<AggregateBucket[]> {
    const { groupBy, since, until, category } = opts;
    const limit = Math.min(opts.limit ?? 20, MAX_LIMIT);

    const col = AGGREGATE_COL[groupBy];
    const clauses: string[] = [`${col} IS NOT NULL`, `${col} <> ''`];
    const params: unknown[] = [];

    if (since != null) {
      params.push(since);
      clauses.push(`i.created_at >= $${params.length}`);
    }
    if (until != null) {
      params.push(until);
      clauses.push(`i.created_at < $${params.length}`);
    }
    if (category && groupBy !== 'category') {
      params.push(category);
      clauses.push(`i.category = $${params.length}`);
    }

    params.push(limit);
    const sql = `
      SELECT
        i.${col}                          AS group_val,
        COUNT(*)::INT                     AS count,
        AVG(s.final_score)::FLOAT         AS avg_final_score,
        MIN(i.published_at)::BIGINT       AS earliest,
        MAX(i.published_at)::BIGINT       AS latest
      FROM items i
      LEFT JOIN LATERAL (
        SELECT final_score FROM item_scores
        WHERE item_id = i.id
        ORDER BY scored_at DESC LIMIT 1
      ) s ON TRUE
      WHERE ${clauses.join(' AND ')}
      GROUP BY i.${col}
      ORDER BY count DESC
      LIMIT $${params.length}
    `;

    const r = await this.pool.query<{
      group_val: string;
      count: number;
      avg_final_score: number | null;
      earliest: number | null;
      latest: number | null;
    }>(sql, params);

    return r.rows.map((row) => ({
      group: row.group_val,
      count: Number(row.count),
      avgFinalScore: row.avg_final_score != null ? Number(row.avg_final_score) : null,
      earliest: new Date((row.earliest ?? 0) * 1000).toISOString(),
      latest: new Date((row.latest ?? 0) * 1000).toISOString(),
    }));
  }

  async getMirrorStatus(): Promise<MirrorStatus> {
    // mirror_watermarks is created by the mirror script on first run. If
    // the table doesn't exist yet, report "never synced".
    const tableExists = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name='mirror_watermarks'
       ) AS exists`
    );
    if (!tableExists.rows[0]?.exists) {
      return {
        lastSyncedAt: null,
        staleMinutes: null,
        tablesTracked: 0,
        totalRowsSynced: 0,
      };
    }

    const r = await this.pool.query<{
      max_synced: number | null;
      tables: number;
      total_rows: number;
    }>(
      `SELECT
         MAX(last_synced_at)::BIGINT AS max_synced,
         COUNT(*)::INT              AS tables,
         COALESCE(SUM(rows_synced), 0)::BIGINT AS total_rows
       FROM mirror_watermarks`
    );

    const row = r.rows[0];
    const maxSynced = row?.max_synced ? Number(row.max_synced) : null;
    const lastSyncedAt = maxSynced ? new Date(maxSynced * 1000).toISOString() : null;
    const staleMinutes =
      maxSynced ? Math.floor((Date.now() / 1000 - maxSynced) / 60) : null;

    return {
      lastSyncedAt,
      staleMinutes,
      tablesTracked: Number(row?.tables ?? 0),
      totalRowsSynced: Number(row?.total_rows ?? 0),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createMirrorCopilotDbContext(): CopilotDbContext {
  const url = process.env.LOCAL_DATABASE_URL;
  if (!url) {
    throw new Error(
      'LOCAL_DATABASE_URL is not set; the copilot requires a local mirror.'
    );
  }
  assertLocalUrl(url);

  const pool = new Pool({
    connectionString: url,
    ssl: false,
    max: 4,
    idleTimeoutMillis: 30_000,
  });

  return new MirrorCopilotDbContext(pool);
}

export { MirrorCopilotDbContext as _MirrorCopilotDbContextForTests };
export { assertLocalUrl as _assertLocalUrlForTests };
// Use `createMirrorCopilotDbContext()` for normal usage. The underscore
// exports exist solely for targeted unit tests (they let tests bypass the
// env-var plumbing and supply their own pg.Pool / URL).
export { type PoolClient };
