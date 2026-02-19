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
}
