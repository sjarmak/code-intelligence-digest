/**
 * Database schema using Drizzle ORM
 */

import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Feeds table: stores subscription info from Inoreader
 */
export const feeds = sqliteTable("feeds", {
  id: text("id").primaryKey(),
  streamId: text("stream_id").notNull().unique(),
  canonicalName: text("canonical_name").notNull(),
  defaultCategory: text("default_category").notNull(),
  vendor: text("vendor"),
  tags: text("tags"), // JSON array stringified
  createdAt: integer("created_at").default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at").default(sql`(strftime('%s', 'now'))`),
});

/**
 * Items table: all fetched items from feeds
 */
export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  streamId: text("stream_id").notNull(),
  sourceTitle: text("source_title").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  author: text("author"),
  publishedAt: integer("published_at").notNull(), // Unix timestamp
  summary: text("summary"),
  contentSnippet: text("content_snippet"),
  categories: text("categories"), // JSON array stringified
  category: text("category").notNull(),
  createdAt: integer("created_at").default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at").default(sql`(strftime('%s', 'now'))`),
});

/**
 * Item scores table: stores all ranking scores for an item
 * Allows tracking score history and A/B testing different algorithms
 */
export const itemScores = sqliteTable(
  "item_scores",
  {
    itemId: text("item_id").notNull(),
    category: text("category").notNull(),
    bm25Score: real("bm25_score").notNull(),
    llmRelevance: integer("llm_relevance").notNull(), // 0-10
    llmUsefulness: integer("llm_usefulness").notNull(), // 0-10
    llmTags: text("llm_tags"), // JSON array stringified
    recencyScore: real("recency_score").notNull(),
    engagementScore: real("engagement_score"),
    finalScore: real("final_score").notNull(),
    reasoning: text("reasoning"),
    scoredAt: integer("scored_at").default(sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.itemId, table.scoredAt] }),
  })
);

/**
 * Cache metadata: track when feeds/items were last fetched/refreshed
 */
export const cacheMetadata = sqliteTable("cache_metadata", {
  key: text("key").primaryKey(),
  lastRefreshAt: integer("last_refresh_at"),
  count: integer("count"), // Number of items/feeds cached
  expiresAt: integer("expires_at"),
});

/**
 * Digest selections: track which items made it into final digests
 * Useful for analytics and understanding selection decisions
 */
export const digestSelections = sqliteTable("digest_selections", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull(),
  category: text("category").notNull(),
  period: text("period").notNull(), // "week" or "month"
  rank: integer("rank").notNull(), // Position in final digest
  diversityReason: text("diversity_reason"), // Why it was selected/rejected
  selectedAt: integer("selected_at").default(sql`(strftime('%s', 'now'))`),
});

/**
 * Sync state: track progress for resumable syncs
 * Allows resuming interrupted syncs without losing progress
 */
export const syncState = sqliteTable("sync_state", {
  id: text("id").primaryKey(), // e.g., "daily-sync"
  continuationToken: text("continuation_token"), // Resume point for pagination
  itemsProcessed: integer("items_processed").default(0),
  callsUsed: integer("calls_used").default(0),
  startedAt: integer("started_at").notNull(),
  lastUpdatedAt: integer("last_updated_at").default(sql`(strftime('%s', 'now'))`),
  status: text("status").notNull(), // "in_progress", "completed", "paused"
  error: text("error"), // If paused due to error
});
