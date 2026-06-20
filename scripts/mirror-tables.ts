/**
 * Table manifest for the production → local mirror (mirror-from-production.ts).
 *
 * Extracted into its own side-effect-free module so it can be imported and
 * asserted by tests without triggering the migration's top-level main().
 *
 * Ordering matters: parent tables before FK-dependent children so upserts in a
 * fresh mirror can satisfy constraints row-by-row.
 */

export type Strategy = 'incremental' | 'snapshot';

export interface MirrorTable {
  name: string;
  strategy: Strategy;
  pk: string[];
  watermarkCol?: string;
}

export const MIRROR_TABLES: MirrorTable[] = [
  // Parents (no incoming FKs from mirrored tables)
  { name: 'feeds', strategy: 'snapshot', pk: ['id'] },
  { name: 'items', strategy: 'incremental', pk: ['id'], watermarkCol: 'updated_at' },
  { name: 'ads_papers', strategy: 'incremental', pk: ['bibcode'], watermarkCol: 'updated_at' },
  { name: 'paper_sections', strategy: 'incremental', pk: ['id'], watermarkCol: 'updated_at' },
  { name: 'paper_tags', strategy: 'snapshot', pk: ['id'] },
  { name: 'ads_libraries', strategy: 'snapshot', pk: ['id'] },
  { name: 'agent_runs', strategy: 'incremental', pk: ['id'], watermarkCol: 'created_at' },
  { name: 'generated_newsletters', strategy: 'incremental', pk: ['id'], watermarkCol: 'created_at' },
  { name: 'generated_podcast_audio', strategy: 'incremental', pk: ['id'], watermarkCol: 'created_at' },
  { name: 'agent_reports', strategy: 'incremental', pk: ['goal', 'id'], watermarkCol: 'generated_at' },
  // Small snapshot tables
  { name: 'usage_quota', strategy: 'snapshot', pk: ['key'] },
  { name: 'digest_selections', strategy: 'snapshot', pk: ['id'] },
  { name: 'global_api_budget', strategy: 'snapshot', pk: ['date'] },
  { name: 'sync_state', strategy: 'snapshot', pk: ['id'] },
  { name: 'admin_settings', strategy: 'snapshot', pk: ['key'] },
  // Children (depend on parents above)
  { name: 'item_embeddings', strategy: 'incremental', pk: ['item_id'], watermarkCol: 'generated_at' },
  // nomic 768d store (dv0.5) — the load-bearing asset of the local-primary
  // migration. Composite PK (item_id, model_name); generated_at watermark.
  { name: 'item_model_embeddings', strategy: 'incremental', pk: ['item_id', 'model_name'], watermarkCol: 'generated_at' },
  { name: 'item_scores', strategy: 'incremental', pk: ['item_id', 'scored_at'], watermarkCol: 'scored_at' },
  { name: 'digest_items', strategy: 'incremental', pk: ['id'], watermarkCol: 'updated_at' },
  { name: 'paper_annotations', strategy: 'incremental', pk: ['id'], watermarkCol: 'updated_at' },
  { name: 'paper_tag_links', strategy: 'snapshot', pk: ['bibcode', 'tag_id'] },
  { name: 'ads_library_papers', strategy: 'snapshot', pk: ['library_id', 'bibcode'] },
];

// Defensive: never touch user-written or cache tables.
export const PROTECTED_TABLES = new Set<string>([
  'starred_items',
  'saved_items',
  'item_relevance',
  'user_paper_favorites',
  'user_podcast_audio',
  'cache_metadata',
  'user_cache',
  'mirror_watermarks', // state owned by mirror-from-production.ts
]);
