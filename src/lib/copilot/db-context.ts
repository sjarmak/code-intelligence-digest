/**
 * Read-only database context for the market-intel copilot.
 *
 * The copilot reads from the hourly-refreshed local mirror of production
 * Postgres (see scripts/mirror-from-production.ts). This module defines
 * the narrow surface the copilot is allowed to touch — keeps the copilot
 * decoupled from the full app DB layer, and makes it easy to swap the
 * backing store later (e.g. to a direct prod read-replica).
 *
 * This file is a STUB in the sense that it defines the seam; the copilot
 * feature will grow new methods here as it needs them. Do not bloat this
 * interface preemptively.
 */

import type { Category, FeedItem } from '../model';

export interface SearchItemsOptions {
  /** Free-text query; matched against items.search_vector (title/summary/snippet/full_text). */
  query?: string;
  /** Restrict to one category (e.g. 'ai_news'). */
  category?: Category;
  /** Earliest created_at (epoch seconds, inclusive). */
  since?: number;
  /** Latest created_at (epoch seconds, exclusive). */
  until?: number;
  /** Max rows to return. Default 20, hard cap 200. */
  limit?: number;
  /** Pagination offset. Default 0. */
  offset?: number;
}

export interface MirrorStatus {
  /**
   * ISO timestamp of the most recent successful sync across all tables,
   * or null if the mirror has not been bootstrapped.
   */
  lastSyncedAt: string | null;
  /** Minutes elapsed since lastSyncedAt, or null if never synced. */
  staleMinutes: number | null;
  /** How many mirrored tables have at least one successful sync recorded. */
  tablesTracked: number;
  /** Cumulative rows ever synced (lifetime counter across runs). */
  totalRowsSynced: number;
}

export interface CopilotDbContext {
  /** Fetch a single item by primary key, or null if not present locally. */
  getItemById(id: string): Promise<FeedItem | null>;

  /**
   * Find items matching the options. Uses the items.search_vector column
   * for free-text; otherwise just filters + orders by created_at DESC.
   */
  searchItems(opts: SearchItemsOptions): Promise<FeedItem[]>;

  /**
   * Freshness snapshot of the mirror. Surface this to users so they know
   * how stale their answers might be.
   */
  getMirrorStatus(): Promise<MirrorStatus>;

  /** Release any pooled connections. */
  close(): Promise<void>;
}
