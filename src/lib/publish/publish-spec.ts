/**
 * Publish-digest spec validation and assembly
 *
 * Everything that flows from a publish request into the website repo's
 * publish-digest.mjs subprocess is validated and shaped here, so the route
 * handler stays thin and the security-relevant logic is unit-testable.
 */

import { z } from 'zod';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

const AUDIO_URL_PREFIX = '/api/audio/';

const publishItemSchema = z.object({
  title: z.string().min(1).max(500),
  url: z.url().max(2048),
  source: z.string().max(300).optional(),
  category: z.string().max(100).optional(),
});

const publishBodySchema = z.object({
  kind: z.enum(['newsletter', 'podcast']),
  cadence: z.enum(['daily', 'weekly', 'manual']),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(10_000),
  bodyMarkdown: z.string().trim().min(1).max(1_000_000),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .refine((d) => !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()), 'invalid date')
    .optional(),
  topics: z.array(z.string().max(100)).max(30).optional(),
  items: z.array(publishItemSchema).max(200).optional(),
  highlights: z.array(z.string().max(1000)).max(50).optional(),
  audioUrl: z.string().max(2048).nullable().optional(),
  durationSec: z.number().finite().positive().max(86_400).optional(),
  push: z.boolean().optional(),
});

export type PublishBody = z.infer<typeof publishBodySchema>;

export interface PublishSpec {
  slug: string;
  title: string;
  cadence: PublishBody['cadence'];
  origin: 'manual';
  date: string;
  summary: string;
  topics: string[];
  items: NonNullable<PublishBody['items']>;
  highlights: string[];
  body: string;
  audioFile?: string;
  audioUrl?: string;
  durationSec?: number;
}

export function parsePublishBody(
  body: unknown
): { ok: true; value: PublishBody } | { ok: false; error: string } {
  const result = publishBodySchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: `${issue.path.join('.') || 'body'}: ${issue.message}` };
  }
  return { ok: true, value: result.data };
}

/** Mechanical slug: lowercase, non-alphanumerics to hyphens, collapse. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Assemble the spec handed to the website repo's publish script. Pure —
 * audio resolution happens separately via resolveAudioFile.
 */
export function buildPublishSpec(
  body: PublishBody,
  fallbackDate: string
): { slug: string; spec: PublishSpec } {
  const date = body.date ?? fallbackDate;
  const slug =
    body.cadence === 'manual' ? `manual-${slugify(body.title)}` : `${body.cadence}-${date}`;
  const topics = [...new Set((body.topics ?? []).map(slugify).filter(Boolean))];

  return {
    slug,
    spec: {
      slug,
      title: body.title,
      cadence: body.cadence,
      origin: 'manual',
      date,
      summary: body.summary,
      topics,
      items: body.items ?? [],
      highlights: body.highlights ?? [],
      body: body.bodyMarkdown,
      ...(body.durationSec ? { durationSec: body.durationSec } : {}),
    },
  };
}

/**
 * Map a served audio URL (/api/audio/...) back to its file on disk, if it
 * exists. Containment check uses path.relative — a plain startsWith prefix
 * check would accept sibling directories like `${audioDir}-evil`.
 */
export async function resolveAudioFile(
  audioUrl: string,
  audioDir: string
): Promise<string | null> {
  if (!audioUrl.startsWith(AUDIO_URL_PREFIX)) return null;
  const rel = audioUrl.slice(AUDIO_URL_PREFIX.length);
  const file = path.resolve(audioDir, rel);
  const relToBase = path.relative(audioDir, file);
  if (relToBase.startsWith('..') || path.isAbsolute(relToBase)) return null;
  try {
    await access(file, fsConstants.R_OK);
    return file;
  } catch {
    return null;
  }
}
