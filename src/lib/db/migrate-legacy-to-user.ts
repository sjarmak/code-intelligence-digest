/**
 * One-time migration: copy legacy digest/saved items to a signed-in user when they have none.
 * Use case: user added items while on legacy (e.g. before signing in with Google); first time
 * they fetch as that user we copy legacy → user so items are retained.
 */

import { getDbClient, detectDriver } from "./driver";
import { LEGACY_USER_ID } from "./constants";
import { getDigestItems, getDigestItemsCount, addToDigestItems, removeMultipleFromDigestItems } from "./digestItems";
import { getSavedItems, getSavedItemsCount, addToSavedItems, removeMultipleFromSavedItems } from "./savedItems";
import { logger } from "../logger";

const MIGRATED_KEY_PREFIX = "legacy_migrated_";

function migrationCacheKey(userId: string): string {
  return MIGRATED_KEY_PREFIX + userId.replace(/[^a-zA-Z0-9\-_.]/g, "_");
}

async function hasMigrated(userId: string): Promise<boolean> {
  const driver = detectDriver();
  const key = migrationCacheKey(userId);
  if (driver === "postgres") {
    const client = await getDbClient();
    const result = await client.query(
      "SELECT 1 FROM user_cache WHERE key = ? LIMIT 1",
      [key]
    );
    return result.rows.length > 0;
  }
  const { getSqlite } = await import("./index");
  const row = getSqlite().prepare("SELECT 1 FROM user_cache WHERE key = ? LIMIT 1").get(key);
  return !!row;
}

async function setMigrated(userId: string): Promise<void> {
  const driver = detectDriver();
  const key = migrationCacheKey(userId);
  const now = Math.floor(Date.now() / 1000);
  if (driver === "postgres") {
    const client = await getDbClient();
    await client.run(
      "INSERT INTO user_cache (key, user_id, cached_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET user_id = EXCLUDED.user_id, cached_at = EXCLUDED.cached_at",
      [key, userId, now]
    );
  } else {
    const { getSqlite } = await import("./index");
    getSqlite()
      .prepare("INSERT OR REPLACE INTO user_cache (key, user_id, cached_at) VALUES (?, ?, ?)")
      .run(key, userId, now);
  }
}

/**
 * If the signed-in user has no digest/saved items and legacy has some, copy legacy → user once.
 * Idempotent per user (uses user_cache to remember we already migrated).
 */
export async function migrateLegacyToUserIfEmpty(userId: string): Promise<void> {
  if (userId === LEGACY_USER_ID) return;
  if (await hasMigrated(userId)) return;

  const [userDigestCount, userSavedCount, legacyDigestCount, legacySavedCount] = await Promise.all([
    getDigestItemsCount(userId),
    getSavedItemsCount(userId),
    getDigestItemsCount(LEGACY_USER_ID),
    getSavedItemsCount(LEGACY_USER_ID),
  ]);

  if (userDigestCount > 0 || userSavedCount > 0) return;
  if (legacyDigestCount === 0 && legacySavedCount === 0) return;

  try {
    if (legacyDigestCount > 0) {
      const legacyDigest = await getDigestItems(500, 0, LEGACY_USER_ID);
      const itemIds = legacyDigest.map((i) => i.id);
      for (const itemId of itemIds) {
        try {
          await addToDigestItems(itemId, userId);
        } catch (e) {
          logger.warn("Migrate legacy digest item failed", { itemId, userId, error: e });
        }
      }
      if (itemIds.length > 0) {
        await removeMultipleFromDigestItems(itemIds, LEGACY_USER_ID);
      }
      logger.info("Migrated legacy digest items to user", { userId, count: itemIds.length });
    }
    if (legacySavedCount > 0) {
      const legacySaved = await getSavedItems(500, 0, LEGACY_USER_ID);
      const itemIds = legacySaved.map((i) => i.id);
      for (const itemId of itemIds) {
        try {
          await addToSavedItems(itemId, userId);
        } catch (e) {
          logger.warn("Migrate legacy saved item failed", { itemId, userId, error: e });
        }
      }
      if (itemIds.length > 0) {
        await removeMultipleFromSavedItems(itemIds, LEGACY_USER_ID);
      }
      logger.info("Migrated legacy saved items to user", { userId, count: itemIds.length });
    }
    await setMigrated(userId);
  } catch (error) {
    logger.error("Legacy→user migration failed", { userId, error });
    throw error;
  }
}
