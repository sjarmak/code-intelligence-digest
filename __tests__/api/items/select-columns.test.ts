import { describe, it, expect } from 'vitest';
import { itemsListSelectColumns } from '@/app/api/items/select-columns';

describe('itemsListSelectColumns (GET /api/items column projection)', () => {
  const NON_RESEARCH = [
    'newsletters',
    'tech_articles',
    'ai_dev',
    'community',
    'product_news',
  ];

  it('omits the heavy full_text blob for non-research categories (OOM spike fix, bd code-intel-digest-n0m)', () => {
    for (const category of NON_RESEARCH) {
      const cols = itemsListSelectColumns(category);
      // Never project a wildcard (would pull full_text) and never name full_text*.
      expect(cols).not.toBe('*');
      expect(cols).not.toContain('full_text');
    }
  });

  it('projects every column the list mapping reads', () => {
    const cols = itemsListSelectColumns('newsletters').split(', ');
    for (const required of [
      'id',
      'stream_id',
      'source_title',
      'title',
      'url',
      'author',
      'published_at',
      'created_at',
      'summary',
      'content_snippet',
      'categories',
      'category',
      'extracted_url',
    ]) {
      expect(cols).toContain(required);
    }
  });

  it('keeps full_text (and its fetch metadata) for research so the view can flag papers with full text', () => {
    const cols = itemsListSelectColumns('research');
    expect(cols).toContain('full_text');
    expect(cols).toContain('full_text_fetched_at');
    expect(cols).toContain('full_text_source');
  });
});
