import { logger } from "@/src/lib/logger";

type SyncResult = {
  ok: boolean;
  daysBack: number;
  itemsSynced: number;
  scoresSynced: number;
  skippedReason?: string;
};

function isProbablyLocalHost(hostname: string | null): boolean {
  if (!hostname) return false;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".local");
}

function safeParseUrl(url: string): { host: string | null; port: string | null; db: string | null } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port || null,
      db: u.pathname ? u.pathname.replace(/^\//, "") : null,
    };
  } catch {
    return { host: null, port: null, db: null };
  }
}

/**
 * Sync recent items + item_scores from production Postgres into local Postgres.
 * This avoids needing Inoreader tokens for local freshness.
 *
 * Requirements:
 * - LOCAL_DATABASE_URL must point to localhost (dev)
 * - PRODUCTION_DATABASE_URL (preferred) or DATABASE_URL must point to production (non-localhost)
 *
 * Writes: ONLY to local DB.
 * Reads: ONLY from production DB.
 */
export async function syncProdToLocalPostgres(daysBack: number): Promise<SyncResult> {
  const localUrl = process.env.LOCAL_DATABASE_URL;
  const prodUrl = process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL;

  if (!localUrl?.startsWith("postgres")) {
    return { ok: false, daysBack, itemsSynced: 0, scoresSynced: 0, skippedReason: "LOCAL_DATABASE_URL missing" };
  }
  if (!prodUrl?.startsWith("postgres")) {
    return { ok: false, daysBack, itemsSynced: 0, scoresSynced: 0, skippedReason: "PRODUCTION_DATABASE_URL/DATABASE_URL missing" };
  }

  const localParsed = safeParseUrl(localUrl);
  const prodParsed = safeParseUrl(prodUrl);

  // Safety: never write to non-localhost target
  if (!isProbablyLocalHost(localParsed.host)) {
    return {
      ok: false,
      daysBack,
      itemsSynced: 0,
      scoresSynced: 0,
      skippedReason: `LOCAL_DATABASE_URL is not localhost (${localParsed.host ?? "unknown"})`,
    };
  }
  // Safety: never treat localhost as production
  if (isProbablyLocalHost(prodParsed.host)) {
    return {
      ok: false,
      daysBack,
      itemsSynced: 0,
      scoresSynced: 0,
      skippedReason: "PRODUCTION_DATABASE_URL/DATABASE_URL appears to be localhost (refusing)",
    };
  }
  if (prodUrl === localUrl) {
    return { ok: false, daysBack, itemsSynced: 0, scoresSynced: 0, skippedReason: "prodUrl === localUrl (refusing)" };
  }

  const { Pool } = await import("pg");
  const cutoffTime = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000);

  const prodPool = new Pool({
    connectionString: prodUrl,
    ssl: { rejectUnauthorized: false },
  });

  const localPool = new Pool({
    connectionString: localUrl,
    ssl: false,
  });

  let itemsSynced = 0;
  let scoresSynced = 0;

  try {
    logger.info("[PROD->LOCAL] Sync starting", {
      daysBack,
      cutoffTime,
      prodHost: prodParsed.host,
      prodDb: prodParsed.db,
      localHost: localParsed.host,
      localDb: localParsed.db,
    });

    // Sync items (recent window)
    const itemsResult = await prodPool.query(
      `
      SELECT * FROM items
      WHERE created_at >= $1
      ORDER BY created_at DESC
    `,
      [cutoffTime]
    );

    if (itemsResult.rows.length > 0) {
      // Replace local window
      await localPool.query(`DELETE FROM items WHERE created_at >= $1`, [cutoffTime]);

      for (const item of itemsResult.rows) {
        const urlStr = typeof item.url === "string" ? item.url : "";
        const sourceTitleStr =
          typeof item.source_title === "string" ? item.source_title : "";
        const isTwitterFeedSource =
          (urlStr.includes("twitter.com/") || urlStr.includes("x.com/")) &&
          sourceTitleStr.toLowerCase().includes("twitter");
        const finalCategory = isTwitterFeedSource ? "community" : item.category;
        await localPool.query(
          `
          INSERT INTO items (
            id, stream_id, source_title, title, url, author, published_at,
            summary, content_snippet, full_text, full_text_fetched_at, full_text_source,
            extracted_url, categories, category, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          ON CONFLICT(id) DO UPDATE SET
            stream_id = EXCLUDED.stream_id,
            source_title = EXCLUDED.source_title,
            title = EXCLUDED.title,
            url = EXCLUDED.url,
            author = EXCLUDED.author,
            published_at = EXCLUDED.published_at,
            summary = EXCLUDED.summary,
            content_snippet = EXCLUDED.content_snippet,
            full_text = EXCLUDED.full_text,
            full_text_fetched_at = EXCLUDED.full_text_fetched_at,
            full_text_source = EXCLUDED.full_text_source,
            extracted_url = EXCLUDED.extracted_url,
            categories = EXCLUDED.categories,
            category = EXCLUDED.category,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
        `,
          [
            item.id,
            item.stream_id,
            item.source_title,
            item.title,
            item.url,
            item.author,
            item.published_at,
            item.summary,
            item.content_snippet,
            item.full_text,
            item.full_text_fetched_at,
            item.full_text_source,
            item.extracted_url,
            item.categories,
            finalCategory,
            item.created_at,
            item.updated_at,
          ]
        );
      }

      itemsSynced = itemsResult.rows.length;
    }

    // Sync scores for those items
    const scoresResult = await prodPool.query(
      `
      SELECT s.* FROM item_scores s
      INNER JOIN items i ON s.item_id = i.id
      WHERE i.created_at >= $1
      ORDER BY s.scored_at DESC
    `,
      [cutoffTime]
    );

    if (scoresResult.rows.length > 0) {
      await localPool.query(
        `
        DELETE FROM item_scores
        WHERE item_id IN (SELECT id FROM items WHERE created_at >= $1)
      `,
        [cutoffTime]
      );

      for (const score of scoresResult.rows) {
        await localPool.query(
          `
          INSERT INTO item_scores (
            item_id, category, bm25_score, llm_relevance, llm_usefulness,
            llm_tags, recency_score, engagement_score, final_score, reasoning, scored_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT(item_id, scored_at) DO UPDATE SET
            category = EXCLUDED.category,
            bm25_score = EXCLUDED.bm25_score,
            llm_relevance = EXCLUDED.llm_relevance,
            llm_usefulness = EXCLUDED.llm_usefulness,
            llm_tags = EXCLUDED.llm_tags,
            recency_score = EXCLUDED.recency_score,
            engagement_score = EXCLUDED.engagement_score,
            final_score = EXCLUDED.final_score,
            reasoning = EXCLUDED.reasoning
        `,
          [
            score.item_id,
            score.category,
            score.bm25_score,
            score.llm_relevance,
            score.llm_usefulness,
            score.llm_tags,
            score.recency_score,
            score.engagement_score,
            score.final_score,
            score.reasoning,
            score.scored_at,
          ]
        );
      }

      scoresSynced = scoresResult.rows.length;
    }

    logger.info("[PROD->LOCAL] Sync finished", { daysBack, itemsSynced, scoresSynced });
    return { ok: true, daysBack, itemsSynced, scoresSynced };
  } catch (error) {
    logger.error("[PROD->LOCAL] Sync failed", { error });
    return { ok: false, daysBack, itemsSynced, scoresSynced, skippedReason: error instanceof Error ? error.message : String(error) };
  } finally {
    await prodPool.end().catch(() => {});
    await localPool.end().catch(() => {});
  }
}

