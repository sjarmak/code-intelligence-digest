import { describe, it, expect } from 'vitest';
import {
  parseCuratedHandoffBody,
  buildCuratedHandoff,
  DIGEST_TRACKS,
} from '@/src/lib/publish/curated-handoff';
import type { FeedItem } from '@/src/lib/model';

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'item-1',
    streamId: 'feed/https://example.com/rss',
    sourceTitle: 'Example Blog',
    title: 'An article',
    url: 'https://example.com/a',
    publishedAt: new Date('2026-07-19T12:00:00.000Z'),
    categories: [],
    category: 'agentic-coding' as FeedItem['category'],
    raw: {},
    ...overrides,
  };
}

describe('parseCuratedHandoffBody', () => {
  it('defaults to the specialized track when no body is sent', () => {
    // The "Send to website" button posts without a body.
    expect(parseCuratedHandoffBody(undefined).track).toBe('specialized');
    expect(parseCuratedHandoffBody('').track).toBe('specialized');
    expect(parseCuratedHandoffBody({}).track).toBe('specialized');
  });

  it('accepts every declared track', () => {
    for (const track of DIGEST_TRACKS) {
      expect(parseCuratedHandoffBody({ track }).track).toBe(track);
    }
  });

  it('rejects an unknown track instead of silently defaulting', () => {
    expect(() => parseCuratedHandoffBody({ track: 'General' })).toThrow();
    expect(() => parseCuratedHandoffBody({ track: 'roundup' })).toThrow();
  });

  it('rejects unrecognized keys rather than dropping them silently', () => {
    // A non-strict schema is how track went missing on the sibling publish path:
    // the client got ok:true and the field was stripped before the spec was written.
    expect(() => parseCuratedHandoffBody({ track: 'general', cadence: 'weekly' })).toThrow();
  });
});

describe('buildCuratedHandoff', () => {
  it('states the track explicitly in the handoff', () => {
    const handoff = buildCuratedHandoff([feedItem()], 'general');
    expect(handoff.track).toBe('general');
  });

  it('carries the track the curator picked, not the schema default', () => {
    // The regression: the curated path could only ever produce 'specialized',
    // because the handoff carried no track and publish-digest.mjs defaults it.
    expect(buildCuratedHandoff([feedItem()], 'general').track).not.toBe('specialized');
  });

  it('shapes items as generate-curated.md expects', () => {
    const handoff = buildCuratedHandoff(
      [feedItem({ summary: 'A summary', fullText: 'Full text' })],
      'specialized',
    );
    expect(handoff.items).toEqual([
      {
        title: 'An article',
        url: 'https://example.com/a',
        source: 'Example Blog',
        category: 'agentic-coding',
        summary: 'A summary',
        publishedAt: '2026-07-19T12:00:00.000Z',
        fullText: 'Full text',
      },
    ]);
  });

  it('falls back to the content snippet, then empty, for a missing summary', () => {
    const withSnippet = buildCuratedHandoff(
      [feedItem({ summary: undefined, contentSnippet: 'Snippet' })],
      'specialized',
    );
    expect(withSnippet.items[0].summary).toBe('Snippet');

    const withNeither = buildCuratedHandoff(
      [feedItem({ summary: undefined, contentSnippet: undefined })],
      'specialized',
    );
    expect(withNeither.items[0].summary).toBe('');
    expect(withNeither.items[0].fullText).toBe('');
  });

  it('serializes publishedAt as ISO so the generator can derive cadence', () => {
    const handoff = buildCuratedHandoff(
      [feedItem({ publishedAt: new Date('2026-01-02T03:04:05.000Z') })],
      'specialized',
    );
    expect(handoff.items[0].publishedAt).toBe('2026-01-02T03:04:05.000Z');
  });
});
