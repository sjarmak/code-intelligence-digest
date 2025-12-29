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

-- Items table with full-text search vector
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
  -- Full-text search vector (auto-generated)
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content_snippet, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(full_text, '')), 'D')
  ) STORED,
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
  quota_limit INTEGER DEFAULT 1000
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

-- Generated podcast audio table
CREATE TABLE IF NOT EXISTS generated_podcast_audio (
  id TEXT PRIMARY KEY,
  podcast_id TEXT,
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

-- Usage quota table for rate limiting
CREATE TABLE IF NOT EXISTS usage_quota (
  key TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  client_ip TEXT NOT NULL,
  window_type TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  reset_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- ADS papers table
CREATE TABLE IF NOT EXISTS ads_papers (
  bibcode TEXT PRIMARY KEY,
  title TEXT,
  authors TEXT,
  pubdate TEXT,
  abstract TEXT,
  body TEXT,
  year INTEGER,
  journal TEXT,
  ads_url TEXT,
  arxiv_url TEXT,
  fulltext_source TEXT,
  html_content TEXT,
  html_fetched_at INTEGER,
  html_sections TEXT,
  html_figures TEXT,
  paper_notes TEXT,
  fetched_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- Paper sections table for section-based retrieval
CREATE TABLE IF NOT EXISTS paper_sections (
  id TEXT PRIMARY KEY,
  bibcode TEXT NOT NULL REFERENCES ads_papers(bibcode) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  section_title TEXT NOT NULL,
  level INTEGER NOT NULL,
  summary TEXT NOT NULL,
  full_text TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  embedding vector(1536), -- pgvector for semantic search
  created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  updated_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
  UNIQUE(bibcode, section_id)
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

-- Full-text search index (GIN for tsvector)
CREATE INDEX IF NOT EXISTS idx_items_search ON items USING GIN(search_vector);

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
CREATE INDEX IF NOT EXISTS idx_podcast_audio_hash ON generated_podcast_audio(transcript_hash);
CREATE INDEX IF NOT EXISTS idx_podcast_audio_created_at ON generated_podcast_audio(created_at);

-- Embeddings index for vector similarity search (IVFFlat for speed)
-- Note: Run this after populating embeddings for better index quality
-- CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON item_embeddings
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- HNSW index alternative (faster queries, slower builds)
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON item_embeddings
  USING hnsw (embedding vector_cosine_ops);

-- Usage quota indexes
CREATE INDEX IF NOT EXISTS idx_usage_quota_endpoint ON usage_quota(endpoint, client_ip);
CREATE INDEX IF NOT EXISTS idx_usage_quota_reset ON usage_quota(reset_at);

-- ADS papers indexes
CREATE INDEX IF NOT EXISTS idx_ads_papers_year ON ads_papers(year);
CREATE INDEX IF NOT EXISTS idx_ads_papers_journal ON ads_papers(journal);

-- Paper sections indexes
CREATE INDEX IF NOT EXISTS idx_paper_sections_bibcode ON paper_sections(bibcode);
-- Vector similarity index for section embeddings
CREATE INDEX IF NOT EXISTS idx_paper_sections_embedding ON paper_sections
  USING hnsw (embedding vector_cosine_ops);
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
