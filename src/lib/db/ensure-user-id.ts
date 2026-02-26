/**
 * Ensures user_id column exists on saved_items, digest_items, user_cache.
 * Safe to run on every connection; used by driver (Postgres) and index (init).
 * No imports from index/driver to avoid circular dependencies.
 */

import { logger } from "../logger";

export interface ClientWithRun {
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

export async function ensurePostgresUserIdColumns(
  client: ClientWithRun
): Promise<void> {
  for (const table of ["saved_items", "digest_items", "user_cache"]) {
    try {
      await client.run(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT 'legacy'`
      );
      await client.run(
        `UPDATE ${table} SET user_id = 'legacy' WHERE user_id IS NULL`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("already exists") || msg.includes("duplicate column")) {
        continue;
      }
      if (msg.includes("does not exist")) {
        continue;
      }
      logger.warn(`Migration ${table}.user_id failed`, { error: msg });
      throw e;
    }
  }
  // Ensure digest_items has unique (user_id, item_id) so ON CONFLICT works (for DBs created before UNIQUE was in schema)
  try {
    await client.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_digest_items_user_item ON digest_items(user_id, item_id)"
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("already exists")) {
      logger.warn("Ensure digest_items unique index failed", { error: msg });
    }
  }
  // Drop legacy UNIQUE(item_id) so multiple users can add the same item (per-user digest)
  try {
    await client.run(
      "ALTER TABLE digest_items DROP CONSTRAINT IF EXISTS digest_items_item_id_key"
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("does not exist")) {
      logger.warn("Drop digest_items item_id constraint failed", { error: msg });
    }
  }
}
