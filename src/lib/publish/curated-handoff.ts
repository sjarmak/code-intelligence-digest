/**
 * Curated handoff validation and assembly
 *
 * POST /api/send-to-website writes a JSON handoff that the website repo's
 * `scripts/digest/run.sh curated <handoff>` reads. Shaping it here keeps the
 * route thin and makes the contract unit-testable, mirroring publish-spec.ts.
 *
 * The website's digest collection has two editorial tracks. `specialized` goes
 * deep on the site's core topics; `general` is a field-wide roundup. The curated
 * run cannot derive this the way it derives cadence from the item date spread:
 * a hand-picked set carries no signal about which lane it belongs to. So track
 * is an input from the curator, threaded through the handoff.
 */

import { z } from 'zod';
import type { FeedItem } from '../model';

export const DIGEST_TRACKS = ['specialized', 'general'] as const;

export type DigestTrack = (typeof DIGEST_TRACKS)[number];

/**
 * The request body. Strict: an unrecognized key is a client bug worth surfacing
 * rather than silently dropping, which is how track went missing on the sibling
 * publish path. The whole body is optional — the button posts without one — but
 * anything present must typecheck.
 */
export const curatedHandoffBodySchema = z
  .object({
    track: z.enum(DIGEST_TRACKS).default('specialized'),
  })
  .strict();

export type CuratedHandoffBody = z.infer<typeof curatedHandoffBodySchema>;

export interface CuratedHandoffItem {
  title: string;
  url: string;
  source: string;
  category: string;
  summary: string;
  publishedAt: string;
  fullText: string;
}

export interface CuratedHandoff {
  track: DigestTrack;
  items: CuratedHandoffItem[];
}

/**
 * Parse a `POST /api/send-to-website` body into validated options.
 *
 * The existing caller sends no body at all, so an absent or empty body is
 * valid and yields the defaults. Malformed JSON is a client error and throws.
 */
export function parseCuratedHandoffBody(raw: unknown): CuratedHandoffBody {
  if (raw === undefined || raw === null || raw === '') {
    return curatedHandoffBodySchema.parse({});
  }
  return curatedHandoffBodySchema.parse(raw);
}

/** Shape tagged digest items into the handoff the curated generator expects. */
export function buildCuratedHandoff(items: FeedItem[], track: DigestTrack): CuratedHandoff {
  return {
    track,
    items: items.map((it) => ({
      title: it.title,
      url: it.url,
      source: it.sourceTitle,
      category: it.category,
      summary: it.summary ?? it.contentSnippet ?? '',
      // publishedAt lets the curated generator derive the issue's cadence
      // (daily/weekly/monthly) from the date spread of the picked items.
      publishedAt: it.publishedAt.toISOString(),
      fullText: it.fullText ?? '',
    })),
  };
}
