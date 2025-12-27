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
  sourceRelevance: integer("source_relevance").default(1), // 0-3 scale, default 1 (neutral)
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
  fullText: text("full_text"), // Full article text (fetched on demand)
  fullTextFetchedAt: integer("full_text_fetched_at"), // When full text was fetched
  fullTextSource: text("full_text_source"), // "web_scrape" | "arxiv" | "error"
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

/**
 * Starred items table: tracks items marked as starred/important in Inoreader
 * Used for targeted curation and relevance tuning
 */
export const starredItems = sqliteTable("starred_items", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().unique(), // Reference to items table
  inoreaderItemId: text("inoreader_item_id").notNull().unique(), // Original Inoreader ID
  relevanceRating: integer("relevance_rating"), // 0-3: unset, low, medium, high
  notes: text("notes"), // User notes about why it's relevant
  starredAt: integer("starred_at").notNull(), // When marked as starred in Inoreader
  ratedAt: integer("rated_at"), // When relevance was assigned
  createdAt: integer("created_at").default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at").default(sql`(strftime('%s', 'now'))`),
});

/**
 * ADS papers table: stores paper metadata fetched from ADS API
 * Allows local caching of paper details for LLM processing and research
 */
export const adsPapers = sqliteTable("ads_papers", {
  bibcode: text("bibcode").primaryKey(), // e.g., "2025arXiv251212730D"
  title: text("title"), // Paper title
  authors: text("authors"), // JSON array of author names
  pubdate: text("pubdate"), // Publication date
  abstract: text("abstract"), // Paper abstract
  year: integer("year"), // Publication year
  journal: text("journal"), // Journal abbreviation from bibcode
  adsUrl: text("ads_url"), // URL to ADS abstract page
  arxivUrl: text("arxiv_url"), // URL to arXiv if available
  fullText: text("full_text"), // Optional: cached full text or PDF content
  fulltextSource: text("fulltext_source"), // Where full text came from (e.g., "arxiv_api", "manual_upload")
  htmlContent: text("html_content"), // Cached ar5iv HTML for reader
  htmlFetchedAt: integer("html_fetched_at"), // When HTML was cached
  paperNotes: text("paper_notes"), // Paper-level notes
  fetchedAt: integer("fetched_at").default(sql`(strftime('%s', 'now'))`),
  createdAt: integer("created_at").default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at").default(sql`(strftime('%s', 'now'))`),
});

/**
 * ADS library papers junction table: links papers to libraries
 * Allows tracking which papers appear in which user libraries
 */
export const adsLibraryPapers = sqliteTable(
  "ads_library_papers",
  {
    libraryId: text("library_id").notNull(),
    bibcode: text("bibcode").notNull(),
    addedAt: integer("added_at").default(sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.libraryId, table.bibcode] }),
  })
);

/**
 * ADS libraries metadata table: stores user's library info from ADS
 * Caches library metadata for faster access
 */
export const adsLibraries = sqliteTable("ads_libraries", {
  id: text("id").primaryKey(), // ADS library ID
  name: text("name").notNull(),
  description: text("description"),
  numDocuments: integer("num_documents").notNull().default(0),
  isPublic: integer("is_public").notNull().default(0), // Boolean stored as int
  fetchedAt: integer("fetched_at").default(sql`(strftime('%s', 'now'))`),
  createdAt: integer("created_at").default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at").default(sql`(strftime('%s', 'now'))`),
});

/**
 * Generated podcast audio table: stores metadata for rendered podcast audio
 * Allows caching and tracking of audio generation
 */
export const generatedPodcastAudio = sqliteTable("generated_podcast_audio", {
  id: text("id").primaryKey(), // e.g., "aud-uuid"
  podcastId: text("podcast_id"), // Reference to podcast, if stored
  transcriptHash: text("transcript_hash").notNull().unique(), // sha256 of sanitized transcript + config
  provider: text("provider").notNull(), // "openai" | "elevenlabs" | "nemo"
  voice: text("voice"), // Voice ID/name used
  format: text("format").notNull(), // "mp3" | "wav"
  duration: text("duration"), // "MM:SS" format
  durationSeconds: integer("duration_seconds"), // Seconds
  audioUrl: text("audio_url").notNull(), // Public/signed URL
  segmentAudio: text("segment_audio"), // JSON array of segment metadata
  bytes: integer("bytes").notNull(), // File size in bytes
  generatedAt: integer("generated_at").default(sql`(strftime('%s', 'now'))`),
  createdAt: integer("created_at").default(sql`(strftime('%s', 'now'))`),
});

/**
 * Paper annotations table: stores highlights and notes for papers
 * Allows users to annotate papers with highlights and notes
 */
export const paperAnnotations = sqliteTable("paper_annotations", {
  id: text("id").primaryKey(), // UUID
  bibcode: text("bibcode").notNull(), // Reference to adsPapers
  type: text("type").notNull(), // 'note' | 'highlight'
  content: text("content").notNull(), // Note text or highlighted text
  note: text("note"), // Note attached to highlight (for type='highlight')
  startOffset: integer("start_offset"), // Character position for highlights
  endOffset: integer("end_offset"), // Character position for highlights
  sectionId: text("section_id"), // Section identifier (e.g., "abstract", "section-3")
  createdAt: integer("created_at").default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at").default(sql`(strftime('%s', 'now'))`),
});

/**
 * Paper tags table: stores custom tags for organizing papers
 */
export const paperTags = sqliteTable("paper_tags", {
  id: text("id").primaryKey(), // UUID
  name: text("name").notNull().unique(), // Tag name (e.g., "to-read", "important")
  color: text("color"), // Optional hex color for UI
  createdAt: integer("created_at").default(sql`(strftime('%s', 'now'))`),
});

/**
 * Paper tag links table: junction table linking papers to tags
 */
export const paperTagLinks = sqliteTable(
  "paper_tag_links",
  {
    bibcode: text("bibcode").notNull(),
    tagId: text("tag_id").notNull(),
    createdAt: integer("created_at").default(sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.bibcode, table.tagId] }),
  })
);
