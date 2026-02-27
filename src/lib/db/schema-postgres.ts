/**
 * PostgreSQL Schema Definitions
 * 
 * PostgreSQL-compatible schema with:
 * - pgvector for embeddings
 * - tsvector for full-text search
 * - Proper timestamp handling
 */

/**
 * Enable required extensions
 */
export const EXTENSIONS_SQL = `
-- Enable pgvector for embedding similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pg_trgm for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;
`;

/**
 * Core tables schema
 */
export const TABLES_SQL = `
-- Feeds table
CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL UNIQUE,
  canonical_name TEXT NOT NULL,
  default_category TEXT NOT NULL,
  vendor TEXT,
  tags TEXT,
  source_relevance INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- Items table with full-text search vector (nullable + trigger for PG 11 compatibility, GENERATED STORED requires PG 12+)
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT,
  published_at INTEGER NOT NULL,
  summary TEXT,
  content_snippet TEXT,
  full_text TEXT,
  full_text_fetched_at INTEGER,
  full_text_source TEXT,
  extracted_url TEXT,
  categories TEXT,
  category TEXT NOT NULL,
  search_vector tsvector,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- Item scores table
CREATE TABLE IF NOT EXISTS item_scores (
  item_id TEXT NOT NULL,
  category TEXT NOT NULL,
  bm25_score REAL NOT NULL,
  llm_relevance INTEGER NOT NULL,
  llm_usefulness INTEGER NOT NULL,
  llm_tags TEXT,
  recency_score REAL NOT NULL,
  engagement_score REAL,
  final_score REAL NOT NULL,
  reasoning TEXT,
  scored_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  PRIMARY KEY (item_id, scored_at)
);

-- Cache metadata table
CREATE TABLE IF NOT EXISTS cache_metadata (
  key TEXT PRIMARY KEY,
  last_refresh_at INTEGER,
  count INTEGER,
  expires_at INTEGER
);

-- Digest selections table
CREATE TABLE IF NOT EXISTS digest_selections (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  category TEXT NOT NULL,
  period TEXT NOT NULL,
  rank INTEGER NOT NULL,
  diversity_reason TEXT,
  selected_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- Item embeddings table with pgvector
CREATE TABLE IF NOT EXISTS item_embeddings (
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,  -- OpenAI ada-002 / text-embedding-3-small dimension
  embedding_model TEXT DEFAULT 'text-embedding-3-small',
  generated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- Sync state table for resumable syncs
CREATE TABLE IF NOT EXISTS sync_state (
  id TEXT PRIMARY KEY,
  continuation_token TEXT,
  items_processed INTEGER DEFAULT 0,
  calls_used INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL,
  last_updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  status TEXT NOT NULL,
  error TEXT
);

-- Global API budget table
CREATE TABLE IF NOT EXISTS global_api_budget (
  date TEXT PRIMARY KEY,
  calls_used INTEGER DEFAULT 0,
  last_updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  quota_limit INTEGER DEFAULT 100
);

-- User cache table
CREATE TABLE IF NOT EXISTS user_cache (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  cached_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- Starred items table
CREATE TABLE IF NOT EXISTS starred_items (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  inoreader_item_id TEXT NOT NULL UNIQUE,
  relevance_rating INTEGER,
  notes TEXT,
  starred_at INTEGER NOT NULL,
  rated_at INTEGER,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- Item relevance table
CREATE TABLE IF NOT EXISTS item_relevance (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  relevance_rating INTEGER,
  notes TEXT,
  rated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- Admin settings table
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- Generated podcast audio table (quote name so "generated" is not parsed as keyword)
CREATE TABLE IF NOT EXISTS "generated_podcast_audio" (
  id TEXT PRIMARY KEY,
  podcast_id TEXT,
  title TEXT,
  transcript_hash TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  voice TEXT,
  format TEXT NOT NULL,
  duration TEXT,
  duration_seconds INTEGER,
  audio_url TEXT NOT NULL,
  segment_audio TEXT,
  bytes INTEGER NOT NULL,
  generated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- Saved items (per-user bookmark library)
CREATE TABLE IF NOT EXISTS saved_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'legacy',
  item_id TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  UNIQUE(user_id, item_id)
);

-- Digest items (per-user digest library)
CREATE TABLE IF NOT EXISTS digest_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'legacy',
  item_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  UNIQUE(user_id, item_id)
);

-- Generated newsletters (per-user, store past newsletters for list/delete)
CREATE TABLE IF NOT EXISTS "generated_newsletters" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'legacy',
  title TEXT NOT NULL,
  markdown TEXT,
  html TEXT,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- Agent run outputs (GTM/marketing workflow jobs)
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  title TEXT NOT NULL,
  output_markdown TEXT,
  output_metadata TEXT,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- User's podcast audio list (per-user, links user to generated_podcast_audio for list/delete)
CREATE TABLE IF NOT EXISTS user_podcast_audio (
  user_id TEXT NOT NULL DEFAULT 'legacy',
  audio_id TEXT NOT NULL REFERENCES "generated_podcast_audio"(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  PRIMARY KEY (user_id, audio_id)
);

-- Per-user paper bookmarks (research "favorites")
CREATE TABLE IF NOT EXISTS user_paper_favorites (
  user_id TEXT NOT NULL DEFAULT 'legacy',
  bibcode TEXT NOT NULL,
  favorited_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, bibcode)
);

-- Agent reports (content_ideas, market_brief, competitor_intel) for persistence in production
CREATE TABLE IF NOT EXISTS agent_reports (
  goal TEXT NOT NULL,
  id TEXT NOT NULL,
  content TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  PRIMARY KEY (goal, id)
);
`;

/**
 * Indexes for performance
 */
export const INDEXES_SQL = `
-- Items indexes
CREATE INDEX IF NOT EXISTS idx_items_stream_id ON items(stream_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_published_at ON items(published_at);

-- Full-text search index (GIN on tsvector, partial so nulls are not indexed)
CREATE INDEX IF NOT EXISTS idx_items_search ON items USING GIN(search_vector) WHERE search_vector IS NOT NULL;

-- Trigram index for fuzzy matching on title
CREATE INDEX IF NOT EXISTS idx_items_title_trgm ON items USING GIN(title gin_trgm_ops);

-- Item scores indexes
CREATE INDEX IF NOT EXISTS idx_item_scores_item_id ON item_scores(item_id);
CREATE INDEX IF NOT EXISTS idx_item_scores_category ON item_scores(category);

-- Digest selections indexes
CREATE INDEX IF NOT EXISTS idx_digest_selections_category ON digest_selections(category);
CREATE INDEX IF NOT EXISTS idx_digest_selections_period ON digest_selections(period);

-- Starred items indexes
CREATE INDEX IF NOT EXISTS idx_starred_items_item_id ON starred_items(item_id);
CREATE INDEX IF NOT EXISTS idx_starred_items_inoreader_id ON starred_items(inoreader_item_id);
CREATE INDEX IF NOT EXISTS idx_starred_items_rating ON starred_items(relevance_rating);

-- Item relevance indexes
CREATE INDEX IF NOT EXISTS idx_item_relevance_item_id ON item_relevance(item_id);
CREATE INDEX IF NOT EXISTS idx_item_relevance_rating ON item_relevance(relevance_rating);

-- Podcast audio indexes
CREATE INDEX IF NOT EXISTS idx_podcast_audio_hash ON "generated_podcast_audio"(transcript_hash);
CREATE INDEX IF NOT EXISTS idx_podcast_audio_created_at ON "generated_podcast_audio"(created_at);

-- Embeddings index for vector similarity search (IVFFlat for speed)
-- Note: Run this after populating embeddings for better index quality
-- CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON item_embeddings 
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- HNSW index alternative (faster queries, slower builds)
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON item_embeddings 
  USING hnsw (embedding vector_cosine_ops);

-- Saved/digest items indexes
CREATE INDEX IF NOT EXISTS idx_saved_items_user_id ON saved_items(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_items_item_id ON saved_items(item_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_digest_items_user_item ON digest_items(user_id, item_id);
CREATE INDEX IF NOT EXISTS idx_digest_items_user_id ON digest_items(user_id);
CREATE INDEX IF NOT EXISTS idx_digest_items_item_id ON digest_items(item_id);

-- Per-user generated content indexes
CREATE INDEX IF NOT EXISTS idx_generated_newsletters_user_id ON "generated_newsletters"(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_newsletters_created_at ON "generated_newsletters"(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_job_id ON agent_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON agent_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_user_podcast_audio_user_id ON user_podcast_audio(user_id);
CREATE INDEX IF NOT EXISTS idx_user_podcast_audio_created_at ON user_podcast_audio(created_at);
CREATE INDEX IF NOT EXISTS idx_user_paper_favorites_user_id ON user_paper_favorites(user_id);

-- Agent reports list by goal and recency
CREATE INDEX IF NOT EXISTS idx_agent_reports_goal_generated ON agent_reports(goal, generated_at DESC);
`;

/**
 * Full PostgreSQL schema initialization
 */
export function getPostgresSchema(): string {
  return `
${EXTENSIONS_SQL}
${TABLES_SQL}
${INDEXES_SQL}
  `.trim();
}

/** Run items search_vector trigger (must run after tables; not included in exec() because function body contains ";"). */
export const ITEMS_SEARCH_TRIGGER_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION items_search_vector_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.content_snippet, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.full_text, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
`.trim();

export const ITEMS_SEARCH_TRIGGER_DROP_SQL = `DROP TRIGGER IF EXISTS items_search_vector_trigger ON items`;
export const ITEMS_SEARCH_TRIGGER_CREATE_SQL = `
CREATE TRIGGER items_search_vector_trigger
  BEFORE INSERT OR UPDATE ON items
  FOR EACH ROW
  EXECUTE PROCEDURE items_search_vector_trigger()
`.trim();
