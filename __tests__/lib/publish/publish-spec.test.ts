import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parsePublishBody,
  buildPublishSpec,
  resolveAudioFile,
  slugify,
} from '@/src/lib/publish/publish-spec';

const minimalBody = {
  kind: 'newsletter',
  cadence: 'weekly',
  title: 'Weekly Digest',
  summary: 'A summary',
  bodyMarkdown: '# Hello',
};

describe('parsePublishBody', () => {
  it('accepts a minimal valid body', () => {
    const result = parsePublishBody(minimalBody);
    expect(result.ok).toBe(true);
  });

  it('rejects non-object bodies', () => {
    expect(parsePublishBody(null).ok).toBe(false);
    expect(parsePublishBody('str').ok).toBe(false);
  });

  it('rejects invalid kind and cadence', () => {
    expect(parsePublishBody({ ...minimalBody, kind: 'blog' }).ok).toBe(false);
    expect(parsePublishBody({ ...minimalBody, cadence: 'hourly' }).ok).toBe(false);
  });

  it('rejects missing or blank required strings', () => {
    expect(parsePublishBody({ ...minimalBody, title: '' }).ok).toBe(false);
    expect(parsePublishBody({ ...minimalBody, summary: '   ' }).ok).toBe(false);
    const { bodyMarkdown: _omitted, ...withoutBody } = minimalBody;
    expect(parsePublishBody(withoutBody).ok).toBe(false);
  });

  it('rejects malformed dates (including traversal-shaped strings)', () => {
    expect(parsePublishBody({ ...minimalBody, date: '2026/06/09' }).ok).toBe(false);
    expect(parsePublishBody({ ...minimalBody, date: '../../etc' }).ok).toBe(false);
    expect(parsePublishBody({ ...minimalBody, date: '2026-13-99' }).ok).toBe(false);
    expect(parsePublishBody({ ...minimalBody, date: '2026-06-09' }).ok).toBe(true);
  });

  it('rejects wrongly typed optional fields', () => {
    expect(parsePublishBody({ ...minimalBody, push: 'yes' }).ok).toBe(false);
    expect(parsePublishBody({ ...minimalBody, durationSec: '120' }).ok).toBe(false);
    expect(parsePublishBody({ ...minimalBody, durationSec: -5 }).ok).toBe(false);
    expect(parsePublishBody({ ...minimalBody, items: [{ title: 'x' }] }).ok).toBe(false);
    expect(
      parsePublishBody({ ...minimalBody, items: [{ title: 'x', url: 'not-a-url' }] }).ok
    ).toBe(false);
    expect(
      parsePublishBody({ ...minimalBody, items: [{ title: 'x', url: 'https://a.com' }] }).ok
    ).toBe(true);
  });

  it('enforces size caps', () => {
    expect(parsePublishBody({ ...minimalBody, bodyMarkdown: 'x'.repeat(1_000_001) }).ok).toBe(
      false
    );
    expect(parsePublishBody({ ...minimalBody, title: 'x'.repeat(301) }).ok).toBe(false);
    expect(
      parsePublishBody({ ...minimalBody, topics: Array.from({ length: 31 }, (_, i) => `t${i}`) })
        .ok
    ).toBe(false);
  });
});

describe('slugify', () => {
  it('lowercases and collapses non-alphanumerics', () => {
    expect(slugify('Hello, World! 42')).toBe('hello-world-42');
    expect(slugify('--Edge--')).toBe('edge');
  });
});

describe('buildPublishSpec', () => {
  it('uses cadence-date slug for scheduled cadences', () => {
    const parsed = parsePublishBody({ ...minimalBody, date: '2026-06-09' });
    if (!parsed.ok) throw new Error('expected ok');
    const { slug } = buildPublishSpec(parsed.value, '2026-06-09');
    expect(slug).toBe('weekly-2026-06-09');
  });

  it('uses slugified title for manual cadence', () => {
    const parsed = parsePublishBody({ ...minimalBody, cadence: 'manual' });
    if (!parsed.ok) throw new Error('expected ok');
    const { slug } = buildPublishSpec(parsed.value, '2026-06-09');
    expect(slug).toBe('manual-weekly-digest');
  });

  it('dedupes and slugifies topics', () => {
    const parsed = parsePublishBody({
      ...minimalBody,
      topics: ['AI Agents', 'ai-agents', 'Code Search'],
    });
    if (!parsed.ok) throw new Error('expected ok');
    const { spec } = buildPublishSpec(parsed.value, '2026-06-09');
    expect(spec.topics).toEqual(['ai-agents', 'code-search']);
  });
});

describe('resolveAudioFile', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'audio-test-'));
  const audioDir = path.join(base, 'audio');
  mkdirSync(audioDir);
  writeFileSync(path.join(audioDir, 'episode.mp3'), 'fake');
  // Sibling dir sharing the audio dir as a name prefix (startsWith-attack target)
  mkdirSync(`${audioDir}-evil`);
  writeFileSync(path.join(`${audioDir}-evil`, 'episode.mp3'), 'evil');

  it('resolves a valid served audio URL to its file', async () => {
    const file = await resolveAudioFile('/api/audio/episode.mp3', audioDir);
    expect(file).toBe(path.join(audioDir, 'episode.mp3'));
  });

  it('rejects URLs outside the audio prefix', async () => {
    expect(await resolveAudioFile('/etc/passwd', audioDir)).toBeNull();
  });

  it('rejects path traversal', async () => {
    expect(await resolveAudioFile('/api/audio/../audio-evil/episode.mp3', audioDir)).toBeNull();
    expect(await resolveAudioFile('/api/audio/../../etc/passwd', audioDir)).toBeNull();
  });

  it('rejects prefix-sibling directories (startsWith attack)', async () => {
    expect(await resolveAudioFile('/api/audio/../audio-evil/episode.mp3', audioDir)).toBeNull();
  });

  it('returns null for missing files', async () => {
    expect(await resolveAudioFile('/api/audio/nope.mp3', audioDir)).toBeNull();
  });
});
