/**
 * Public entry point for the market-intel copilot's database layer.
 *
 * Typical usage:
 *
 *   import { createMirrorCopilotDbContext } from '@/src/lib/copilot';
 *   const db = createMirrorCopilotDbContext();
 *   const status = await db.getMirrorStatus();
 *   const items = await db.searchItems({ query: 'anthropic', limit: 10 });
 *   await db.close();
 *
 * The context reads from the hourly-refreshed local mirror of production
 * (see scripts/mirror-from-production.ts). It refuses to connect to a
 * non-local database.
 */

export type {
  CopilotDbContext,
  SearchItemsOptions,
  MirrorStatus,
} from './db-context';
export {
  createMirrorCopilotDbContext,
  createDirectCopilotDbContext,
  resolveCopilotDbContext,
  MirrorCopilotDbContext,
} from './mirror-context';
export type { CopilotDbMode } from './mirror-context';
